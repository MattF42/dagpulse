# DAGPulse Bridge

A Python WebSocket bridge that sits between browser clients and the HTND gRPC node.

## Why this exists

HTND's `RPC.MessageStream` is a **true bidi-streaming** gRPC call. Browsers cannot
make native gRPC/HTTP2 connections, and gRPC-web proxies (grpcwebproxy / Envoy) cannot
proxy bidi-streaming reliably. This bridge solves the problem by:

1. Holding a persistent native gRPC connection to HTND (Python `grpc.aio`)
2. Exposing a plain **WebSocket** endpoint (`/ws`) that any browser can connect to

## Architecture

```
Browser (WebSocket ws://host/ws)
    ↕
nginx :443  (TLS termination, serves dist/, proxies /ws → bridge)
    ↕
dagpulse bridge  :8765  (FastAPI + grpc.aio)
    ↕
HTND :42420  (native gRPC / HTTP2)
```

## Quick start

```bash
cd bridge
pip install -r requirements.txt
python main.py
```

## Configuration

| Variable         | Default     | Description                                          |
|------------------|-------------|------------------------------------------------------|
| `HTND_HOST`      | `localhost` | gRPC host of the HTND node                           |
| `HTND_PORT`      | `42420`     | gRPC port of the HTND node                           |
| `BRIDGE_PORT`    | `8765`      | Port this bridge server listens on                   |
| `STATS_INTERVAL` | `10`        | Seconds between periodic stats broadcasts            |

## WebSocket message format

All messages are JSON.

```json
// Sent once on connect: initial snapshot
{"type": "snapshot", "info": {...}, "dagInfo": {...}, "blocks": [...]}

// Sent for each new block from HTND
{"type": "block", "block": {...}}

// Sent on connect and on gRPC reconnect
{"type": "status", "connected": true, "serverVersion": "1.6.10", "isSynced": true}

// Sent periodically (every STATS_INTERVAL seconds)
{"type": "stats", "blueScore": 91200000, "daaScore": 148784020, "hashrate": 12500000}

// Sent on gRPC error
{"type": "error", "message": "..."}

// Keepalive ping/pong
{"type": "ping"}
{"type": "pong"}
```

## REST endpoints

- `GET /health` — returns bridge status and connected client count

## Docker

```bash
docker build -t dagpulse-bridge .
docker run -e HTND_HOST=your-node -p 8765:8765 dagpulse-bridge
```

Or via docker compose (see `../docker-compose.yml`).
