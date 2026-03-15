# encoding: utf-8
"""
htnd_client.py — Adapted from HoosatNetwork/htn-rest-server's HtndThread.py and HtndClient.py.

The key pattern that keeps the bidi gRPC stream alive:
  - yield_cmd is an async generator that yields one request message, then
    awaits self.__queue.get() to block indefinitely, keeping the send-side open
  - HTND can then push responses back over the same stream for as long as needed
"""
import asyncio
import logging

import grpc
from google.protobuf import json_format
from grpc._channel import _MultiThreadedRendezvous

from .htnd import messages_pb2_grpc
from .htnd.messages_pb2 import KaspadMessage

logger = logging.getLogger(__name__)

MAX_MESSAGE_LENGTH = 1024 * 1024 * 1024  # 1 GB


class HtndCommunicationError(Exception):
    pass


class HtndClient:
    """
    Wraps a single async gRPC channel to an HTND node.

    Usage:
        client = HtndClient("localhost", 42420)
        info = await client.request("getInfoRequest")
        await client.notify("notifyBlockAddedRequest", callback=my_callback)
    """

    def __init__(self, htnd_host: str, htnd_port: int):
        self.htnd_host = htnd_host
        self.htnd_port = htnd_port
        self.server_version: str | None = None
        self.is_synced: bool | None = None
        self._channel: grpc.aio.Channel | None = None
        self._stub: messages_pb2_grpc.RPCStub | None = None

    def _get_stub(self) -> messages_pb2_grpc.RPCStub:
        if self._channel is None:
            self._channel = grpc.aio.insecure_channel(
                f"{self.htnd_host}:{self.htnd_port}",
                compression=grpc.Compression.Gzip,
                options=[
                    ("grpc.max_send_message_length", MAX_MESSAGE_LENGTH),
                    ("grpc.max_receive_message_length", MAX_MESSAGE_LENGTH),
                ],
            )
            self._stub = messages_pb2_grpc.RPCStub(self._channel)
        return self._stub  # type: ignore[return-value]

    async def close(self):
        if self._channel is not None:
            await self._channel.close()
            self._channel = None
            self._stub = None

    async def _yield_cmd(self, cmd: str, params=None):
        """
        Async generator that yields a single KaspadMessage request, then blocks
        on a queue.get() to keep the gRPC send-side open indefinitely.
        This is the critical pattern from htn-rest-server's HtndThread:
        the queue is intentionally never written to, so await queue.get()
        suspends the generator forever — keeping the client → server stream
        half-open so HTND continues pushing responses.
        """
        # This queue is never written to; await get() blocks indefinitely,
        # which is what keeps the gRPC bidi-stream send-side open.
        _keepalive = asyncio.Queue()
        msg = KaspadMessage()
        msg2 = getattr(msg, cmd)
        if params:
            if isinstance(params, dict):
                json_format.ParseDict(params, msg2)
            elif isinstance(params, str):
                json_format.Parse(params, msg2)
        msg2.SetInParent()
        yield msg
        await _keepalive.get()  # blocks forever, keeping the stream open

    async def request(self, command: str, params=None, timeout: int = 30) -> dict:
        """Send a single command and return the first response as a dict."""
        stub = self._get_stub()
        # Use a per-request queue so unary calls can signal completion
        done_queue: asyncio.Queue = asyncio.Queue()

        async def _yield_once():
            msg = KaspadMessage()
            msg2 = getattr(msg, command)
            if params:
                if isinstance(params, dict):
                    json_format.ParseDict(params, msg2)
                elif isinstance(params, str):
                    json_format.Parse(params, msg2)
            msg2.SetInParent()
            yield msg
            await done_queue.get()  # unblocked below after first response

        try:
            async for resp in stub.MessageStream(_yield_once(), timeout=timeout):
                done_queue.put_nowait("done")
                return json_format.MessageToDict(resp)
        except grpc.aio._call.AioRpcError as e:
            raise HtndCommunicationError(str(e)) from e
        return {}

    async def notify(self, command: str, params=None, callback=None):
        """
        Subscribe to a notification stream.  Calls `callback(dict)` for every
        response message.  Runs until the stream ends or raises.
        """
        stub = self._get_stub()
        try:
            async for resp in stub.MessageStream(self._yield_cmd(command, params)):
                if callback:
                    await callback(json_format.MessageToDict(resp))
            logger.debug("notify stream ended for %s", command)
        except (grpc.aio._call.AioRpcError, _MultiThreadedRendezvous) as e:
            raise HtndCommunicationError(str(e)) from e

    async def ping(self) -> bool:
        """Quick connectivity check.  Returns True if the node is reachable."""
        try:
            info = await self.request("getInfoRequest")
            resp = info.get("getInfoResponse", {})
            self.server_version = resp.get("serverVersion")
            self.is_synced = resp.get("isSynced")
            return bool(self.server_version)
        except Exception as exc:
            logger.error("ping failed: %s", exc)
            return False
