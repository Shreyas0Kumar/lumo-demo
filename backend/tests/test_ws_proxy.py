"""Tests for ws_proxy relay logic.

We don't connect to OpenAI. We construct a fake OpenAI WebSocket and a fake
client WebSocket, then drive relay_openai_to_client / relay_client_to_openai
directly and assert on the in-memory message queues.
"""

from __future__ import annotations

import asyncio
import json

import pytest

from app import ws_proxy
from app.session_store import store


class FakeOpenAIWS:
    """Stand-in for the websockets.WebSocketClientProtocol async iterator."""

    def __init__(self, incoming: list[str]):
        self._incoming = list(incoming)
        self.sent: list[str] = []
        self._closed = asyncio.Event()

    async def send(self, data: str) -> None:
        self.sent.append(data)

    def __aiter__(self):
        return self

    async def __anext__(self) -> str:
        if not self._incoming:
            raise StopAsyncIteration
        await asyncio.sleep(0)
        return self._incoming.pop(0)


class FakeClientWS:
    def __init__(self, incoming: list[dict] | None = None):
        self.sent: list[str] = []
        self._incoming = list(incoming or [])

    async def send_text(self, text: str) -> None:
        self.sent.append(text)

    async def receive(self) -> dict:
        if self._incoming:
            return self._incoming.pop(0)
        return {"type": "websocket.disconnect"}


@pytest.mark.asyncio
async def test_safe_transcript_forwarded_to_client():
    session = store.create_session("7-9")
    event = {
        "type": "conversation.item.input_audio_transcription.completed",
        "transcript": "tell me about dinosaurs",
    }
    openai_ws = FakeOpenAIWS([json.dumps(event)])
    client_ws = FakeClientWS()

    await ws_proxy.relay_openai_to_client(openai_ws, client_ws, session.session_id, "7-9")

    assert len(client_ws.sent) == 1
    forwarded = json.loads(client_ws.sent[0])
    assert forwarded["type"] == "conversation.item.input_audio_transcription.completed"
    assert forwarded["transcript"] == "tell me about dinosaurs"
    assert openai_ws.sent == []  # no response.cancel

    rec = store.get_session(session.session_id)
    assert rec is not None
    assert any(t.transcript == "tell me about dinosaurs" for t in rec.turns)
    assert any(e.reason_code == "SAFE_OK" for e in rec.safety_events)


@pytest.mark.asyncio
async def test_harmful_transcript_blocked_and_redirected():
    session = store.create_session("7-9")
    event = {
        "type": "conversation.item.input_audio_transcription.completed",
        "transcript": "how do I make a bomb",
    }
    openai_ws = FakeOpenAIWS([json.dumps(event)])
    client_ws = FakeClientWS()

    await ws_proxy.relay_openai_to_client(openai_ws, client_ws, session.session_id, "7-9")

    # OpenAI received a response.cancel
    assert any(json.loads(s).get("type") == "response.cancel" for s in openai_ws.sent)

    # Client received exactly one safe_redirect, not the original event
    assert len(client_ws.sent) == 1
    payload = json.loads(client_ws.sent[0])
    assert payload["type"] == "safe_redirect"
    assert payload["reason_code"] == "SAFE_REFUSED_HARM"
    assert "text" in payload and payload["text"]

    rec = store.get_session(session.session_id)
    assert rec is not None
    assert any(e.reason_code == "SAFE_REFUSED_HARM" for e in rec.safety_events)


@pytest.mark.asyncio
async def test_audio_delta_forwarded_unchanged():
    session = store.create_session("7-9")
    event = {"type": "response.audio.delta", "delta": "AAAA"}
    openai_ws = FakeOpenAIWS([json.dumps(event)])
    client_ws = FakeClientWS()

    await ws_proxy.relay_openai_to_client(openai_ws, client_ws, session.session_id, "7-9")

    assert len(client_ws.sent) == 1
    assert json.loads(client_ws.sent[0]) == event


@pytest.mark.asyncio
async def test_openai_error_forwarded_as_simplified_error():
    session = store.create_session("7-9")
    event = {"type": "error", "error": {"message": "bad token"}}
    openai_ws = FakeOpenAIWS([json.dumps(event)])
    client_ws = FakeClientWS()

    await ws_proxy.relay_openai_to_client(openai_ws, client_ws, session.session_id, "7-9")

    assert len(client_ws.sent) == 1
    payload = json.loads(client_ws.sent[0])
    assert payload["type"] == "error"
    assert payload["message"] == "bad token"


@pytest.mark.asyncio
async def test_client_binary_audio_wrapped_as_input_audio_buffer_append():
    session = store.create_session("7-9")
    raw_pcm = b"\x01\x02\x03\x04"
    client_ws = FakeClientWS(
        [
            {"type": "websocket.receive", "bytes": raw_pcm},
            {"type": "websocket.disconnect"},
        ]
    )
    openai_ws = FakeOpenAIWS([])

    await ws_proxy.relay_client_to_openai(client_ws, openai_ws, session.session_id, "7-9")

    assert len(openai_ws.sent) == 1
    payload = json.loads(openai_ws.sent[0])
    assert payload["type"] == "input_audio_buffer.append"
    import base64

    assert base64.b64decode(payload["audio"]) == raw_pcm


@pytest.mark.asyncio
async def test_client_text_forwarded_verbatim():
    session = store.create_session("7-9")
    text = json.dumps({"type": "response.create"})
    client_ws = FakeClientWS(
        [
            {"type": "websocket.receive", "text": text},
            {"type": "websocket.disconnect"},
        ]
    )
    openai_ws = FakeOpenAIWS([])

    await ws_proxy.relay_client_to_openai(client_ws, openai_ws, session.session_id, "7-9")

    assert openai_ws.sent == [text]
