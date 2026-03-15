"""
DAGPulse WebSocket Bridge — main.py

Connects to an HTND node via native gRPC (grpc.aio) and fans out live block
notifications to all connected WebSocket clients.

Configuration (environment variables):
    HTND_HOST     gRPC host for the HTND node  (default: localhost)
    HTND_PORT     gRPC port for the HTND node  (default: 42420)
    BRIDGE_PORT   Port this server listens on   (default: 8765)

Run:
    python main.py
"""

import asyncio
import json
import logging
import os
import signal

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from htnd_client import HtndClient, HtndCommunicationError

# ── Configuration ─────────────────────────────────────────────────────────────

HTND_HOST = os.environ.get("HTND_HOST", "localhost")
HTND_PORT = int(os.environ.get("HTND_PORT", "42420"))
BRIDGE_PORT = int(os.environ.get("BRIDGE_PORT", "8765"))
STATS_INTERVAL = float(os.environ.get("STATS_INTERVAL", "10"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [bridge] %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)

# ── FastAPI app ────────────────────────────────────────────────────────────────

app = FastAPI(title="DAGPulse Bridge")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Set of currently connected WebSocket clients
_clients: set[WebSocket] = set()

# Shared gRPC client (one channel, reused across all WS connections)
_htnd: HtndClient = HtndClient(HTND_HOST, HTND_PORT)

# Background task handles
_subscription_task: asyncio.Task | None = None
_stats_task: asyncio.Task | None = None


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _broadcast(msg: dict) -> None:
    """Send a JSON message to all connected WebSocket clients."""
    if not _clients:
        return
    text = json.dumps(msg)
    dead: list[WebSocket] = []
    for ws in list(_clients):
        try:
            await ws.send_text(text)
        except Exception:
            dead.append(ws)
    for ws in dead:
        _clients.discard(ws)


async def _fetch_snapshot() -> dict:
    """
    Fetch an initial snapshot: node info, DAG info, and recent blocks starting
    from the current DAG tip.
    """
    try:
        info_resp = await _htnd.request("getInfoRequest")
        info = info_resp.get("getInfoResponse", {})

        dag_resp = await _htnd.request("getBlockDagInfoRequest")
        dag_info = dag_resp.get("getBlockDagInfoResponse", {})

        blocks: list[dict] = []
        tip_hashes: list[str] = dag_info.get("tipHashes", [])
        if tip_hashes:
            # Fetch the most recent tip block with transactions
            block_resp = await _htnd.request(
                "getBlockRequest",
                {"hash": tip_hashes[0], "includeTransactions": False},
            )
            block = block_resp.get("getBlockResponse", {}).get("block")
            if block:
                blocks.append(block)

        return {"info": info, "dagInfo": dag_info, "blocks": blocks}
    except Exception as exc:
        logger.warning("snapshot fetch failed: %s", exc)
        return {"info": {}, "dagInfo": {}, "blocks": []}


# ── Block subscription loop ────────────────────────────────────────────────────

async def _run_stats_loop():
    """
    Periodic coroutine: every STATS_INTERVAL seconds fetches blueScore + hashrate
    from HTND and broadcasts a stats message to all WebSocket clients.
    """
    while True:
        try:
            dag_resp = await _htnd.request("getBlockDagInfoRequest")
            dag_info = dag_resp.get("getBlockDagInfoResponse", {})

            # Derive blue score from the tip block's verboseData
            # (virtualBlueScore is not available on the DAG info endpoint)
            blue_score = None
            tip_hashes = dag_info.get("tipHashes")
            if tip_hashes is None:
                # Some versions may use virtualParentHashes instead
                tip_hashes = dag_info.get("virtualParentHashes", [])
            elif not tip_hashes:
                logger.debug("tipHashes is empty in DAG info response")
            if tip_hashes:
                try:
                    block_resp = await _htnd.request(
                        "getBlockRequest",
                        {"hash": tip_hashes[0], "includeTransactions": False},
                    )
                    block = block_resp.get("getBlockResponse", {}).get("block", {})
                    verbose = block.get("verboseData", {})
                    blue_score = verbose.get("blueScore")
                except Exception as exc:
                    logger.debug("Could not fetch tip block for blueScore: %s", exc)

            hash_resp = await _htnd.request(
                "estimateNetworkHashesPerSecondRequest",
                {"windowSize": 1000, "startHash": None},
            )
            nhps = hash_resp.get("estimateNetworkHashesPerSecondResponse", {}).get(
                "networkHashesPerSecond", 0
            )

            await _broadcast(
                {
                    "type": "stats",
                    "blueScore": blue_score,
                    "daaScore": dag_info.get("virtualDaaScore"),
                    "hashrate": nhps,
                }
            )
        except asyncio.CancelledError:
            logger.info("Stats loop cancelled, shutting down")
            return
        except Exception as exc:
            logger.debug("Stats loop error (non-fatal): %s", exc)

        try:
            await asyncio.sleep(STATS_INTERVAL)
        except asyncio.CancelledError:
            logger.info("Stats loop cancelled during sleep, shutting down")
            return


async def _run_subscription():
    """
    Long-running coroutine: subscribes to notifyBlockAddedRequest and fans out
    every blockAddedNotification to all WebSocket clients.  Reconnects with
    exponential backoff if the stream drops.
    """
    global _stats_task

    backoff = 2.0
    while True:
        logger.info("Connecting to HTND at %s:%d …", HTND_HOST, HTND_PORT)
        try:
            # Re-create the client on each reconnect attempt so the channel is fresh
            global _htnd
            _htnd = HtndClient(HTND_HOST, HTND_PORT)

            # Probe connectivity before subscribing
            if not await _htnd.ping():
                raise HtndCommunicationError("ping returned False")

            logger.info(
                "Connected to HTND  version=%s  synced=%s",
                _htnd.server_version,
                _htnd.is_synced,
            )
            await _broadcast(
                {
                    "type": "status",
                    "connected": True,
                    "serverVersion": _htnd.server_version,
                    "isSynced": _htnd.is_synced,
                }
            )
            backoff = 2.0  # reset on successful connect

            # Start / restart the stats loop now that the connection is live
            if _stats_task is not None and not _stats_task.done():
                _stats_task.cancel()
                try:
                    await _stats_task
                except asyncio.CancelledError:
                    pass
            _stats_task = asyncio.create_task(_run_stats_loop())

            async def _on_block(msg: dict):
                notif = msg.get("blockAddedNotification")
                if notif:
                    await _broadcast({"type": "block", "block": notif.get("block", {})})
                confirm = msg.get("notifyBlockAddedResponse")
                if confirm is not None:
                    logger.info("Block-added subscription confirmed by HTND")

            await _htnd.notify("notifyBlockAddedRequest", callback=_on_block)

        except asyncio.CancelledError:
            logger.info("Subscription task cancelled, shutting down")
            if _stats_task is not None and not _stats_task.done():
                _stats_task.cancel()
            return
        except Exception as exc:
            logger.warning("HTND stream error: %s — reconnecting in %.0fs", exc, backoff)
            await _broadcast(
                {"type": "error", "message": f"HTND stream lost: {exc}. Reconnecting…"}
            )
        finally:
            await _htnd.close()

        await asyncio.sleep(backoff)
        backoff = min(backoff * 2, 30.0)


# ── Lifecycle ─────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def _startup():
    global _subscription_task
    _subscription_task = asyncio.create_task(_run_subscription())
    logger.info("Bridge started — listening on :%d, HTND at %s:%d", BRIDGE_PORT, HTND_HOST, HTND_PORT)


@app.on_event("shutdown")
async def _shutdown():
    global _stats_task
    if _stats_task:
        _stats_task.cancel()
        try:
            await _stats_task
        except asyncio.CancelledError:
            pass
    if _subscription_task:
        _subscription_task.cancel()
        try:
            await _subscription_task
        except asyncio.CancelledError:
            pass
    await _htnd.close()
    logger.info("Bridge shut down")


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "htnd_host": HTND_HOST,
        "htnd_port": HTND_PORT,
        "connected_clients": len(_clients),
        "server_version": _htnd.server_version,
        "is_synced": _htnd.is_synced,
    }


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    _clients.add(ws)
    logger.info("WebSocket client connected  (total: %d)", len(_clients))

    try:
        # Send current connection status immediately
        await ws.send_text(
            json.dumps(
                {
                    "type": "status",
                    "connected": _htnd.server_version is not None,
                    "serverVersion": _htnd.server_version,
                    "isSynced": _htnd.is_synced,
                }
            )
        )

        # Send initial DAG snapshot
        snapshot = await _fetch_snapshot()
        await ws.send_text(json.dumps({"type": "snapshot", **snapshot}))

        # Keep the WebSocket open; the subscription loop drives all further traffic
        while True:
            # Wait for client messages (ping/pong or disconnect)
            try:
                data = await asyncio.wait_for(ws.receive_text(), timeout=60)
                try:
                    msg = json.loads(data)
                    if msg.get("type") == "ping":
                        await ws.send_text(json.dumps({"type": "pong"}))
                except (json.JSONDecodeError, AttributeError):
                    pass
            except asyncio.TimeoutError:
                # Send a keepalive ping to detect dead connections
                await ws.send_text(json.dumps({"type": "ping"}))

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning("WebSocket error: %s", exc)
    finally:
        _clients.discard(ws)
        logger.info("WebSocket client disconnected  (total: %d)", len(_clients))


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=BRIDGE_PORT,
        log_level="info",
    )
