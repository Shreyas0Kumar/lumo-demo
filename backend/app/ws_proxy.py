from __future__ import annotations

import asyncio
import base64
import json
import logging
from typing import Any

import websockets
from fastapi import WebSocket
from starlette.websockets import WebSocketDisconnect
from websockets.exceptions import ConnectionClosed

from app.config import settings
from app.prompts import build_system_prompt
from app.services.safety import policy_engine
from app.session_store import store

log = logging.getLogger("lumo.ws_proxy")


REDIRECT_TEXTS = {
    "4-6": "Hmm, let's talk about something fun instead! What's your favourite animal?",
    "7-9": "That's not something I can help with, but I'd love to hear about something you're curious about!",
    "10-12": "I can't go there, but let's explore something else — what are you into lately?",
}


def get_redirect_text(age_band: str) -> str:
    return REDIRECT_TEXTS.get(age_band, REDIRECT_TEXTS["7-9"])


def build_session_update(age_band: str) -> dict[str, Any]:
    """Build a session.update event for the OpenAI Realtime GA API."""
    return {
        "type": "session.update",
        "session": {
            "type": "realtime",
            "model": settings.OPENAI_REALTIME_MODEL,
            "output_modalities": ["audio"],
            "instructions": build_system_prompt(age_band),
            "audio": {
                "input": {
                    "format": {"type": "audio/pcm", "rate": 24000},
                    "transcription": {"model": "whisper-1"},
                    "turn_detection": {
                        "type": "server_vad",
                        "threshold": 0.5,
                        "prefix_padding_ms": 300,
                        "silence_duration_ms": 600,
                    },
                },
                "output": {
                    "format": {"type": "audio/pcm", "rate": 24000},
                    "voice": settings.TTS_VOICE,
                },
            },
        },
    }


# All other event types are forwarded to the client unchanged. We only special-case
# transcription, error, and response.done. The previous beta-API allowlist is gone —
# we forward everything we don't explicitly intercept.

# The user-transcription event name has shifted between API revisions; accept both.
TRANSCRIPTION_EVENTS = {
    "conversation.item.input_audio_transcription.completed",
    "conversation.item.audio_transcription.completed",
}

# OpenAI error codes that are not actionable for the user — we log and drop them
# instead of surfacing as fatal errors in the UI.
BENIGN_OPENAI_ERROR_CODES = {
    "response_cancel_not_active",
}


async def relay_client_to_openai(
    client_ws: WebSocket,
    openai_ws: "websockets.WebSocketClientProtocol",
    session_id: str,
    age_band: str,
) -> None:
    """Pump messages from the browser to OpenAI.

    Accepts either raw binary PCM16 audio chunks (wrapped here as
    ``input_audio_buffer.append``) or JSON text (forwarded as-is).
    """
    try:
        while True:
            msg = await client_ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            if (data := msg.get("bytes")) is not None:
                payload = {
                    "type": "input_audio_buffer.append",
                    "audio": base64.b64encode(data).decode("ascii"),
                }
                await openai_ws.send(json.dumps(payload))
            elif (text := msg.get("text")) is not None:
                await openai_ws.send(text)
    except (WebSocketDisconnect, ConnectionClosed) as e:
        log.info("[%s] client->openai closed: %s", session_id, e)
    except Exception:
        log.exception("[%s] client->openai error", session_id)


async def relay_openai_to_client(
    openai_ws: "websockets.WebSocketClientProtocol",
    client_ws: WebSocket,
    session_id: str,
    age_band: str,
) -> None:
    """Pump messages from OpenAI to the browser, running safety on transcripts."""
    try:
        async for raw in openai_ws:
            if isinstance(raw, (bytes, bytearray)):
                raw = raw.decode("utf-8", errors="ignore")

            try:
                event = json.loads(raw)
            except Exception:
                log.warning("[%s] non-json from openai: %s", session_id, raw[:200])
                continue

            etype = event.get("type", "")

            store.log_event(session_id, etype)
            if etype.startswith("conversation.item."):
                log.info("[%s] conversation event: %s", session_id, etype)

            if etype in TRANSCRIPTION_EVENTS:
                transcript = event.get("transcript", "") or ""
                result = policy_engine.check(transcript, age_band)
                turn = store.append_turn(session_id, "user", transcript)
                turn_id = turn.turn_id if turn else "unknown"
                store.append_safety_event(
                    session_id, turn_id, result.reason_code, result.action
                )

                if not result.allowed:
                    try:
                        await openai_ws.send(json.dumps({"type": "response.cancel"}))
                    except Exception:
                        log.warning("[%s] failed to send response.cancel", session_id)
                    await client_ws.send_text(
                        json.dumps(
                            {
                                "type": "safe_redirect",
                                "text": get_redirect_text(age_band),
                                "reason_code": result.reason_code,
                                "action": result.action,
                                "blocked_transcript": transcript,
                            }
                        )
                    )
                    continue

                await client_ws.send_text(raw)
                continue

            if etype == "error":
                err = event.get("error") if isinstance(event.get("error"), dict) else {}
                message = err.get("message") or "openai error"
                code = err.get("code") or err.get("type") or ""
                # Benign races we deliberately swallow:
                #   response_cancel_not_active — barge-in arrived after the
                #   response had already completed; nothing to cancel.
                if code in BENIGN_OPENAI_ERROR_CODES:
                    log.info("[%s] swallowed benign openai error: %s", session_id, code)
                    continue
                log.error("[%s] openai error: code=%s message=%s", session_id, code, message)
                await client_ws.send_text(
                    json.dumps(
                        {
                            "type": "error",
                            "source": "openai",
                            "code": code,
                            "message": message,
                        }
                    )
                )
                continue

            if etype == "response.done":
                try:
                    output = event.get("response", {}).get("output", [])
                    text_parts: list[str] = []
                    for item in output:
                        for content in item.get("content", []) or []:
                            ctype = content.get("type")
                            if ctype in ("output_audio", "audio", "text"):
                                t = content.get("transcript") or content.get("text")
                                if t:
                                    text_parts.append(t)
                    full = " ".join(text_parts).strip()
                    if full:
                        store.append_turn(session_id, "assistant", full)
                except Exception:
                    log.exception("[%s] failed to extract assistant text", session_id)

            # Forward everything else verbatim
            await client_ws.send_text(raw)
    except (WebSocketDisconnect, ConnectionClosed) as e:
        log.info("[%s] openai->client closed: %s", session_id, e)
    except Exception:
        log.exception("[%s] openai->client error", session_id)


async def proxy_session(client_ws: WebSocket, session_id: str, age_band: str) -> None:
    """Open an OpenAI Realtime WS and bidirectionally relay it to the client."""
    if not settings.OPENAI_API_KEY:
        await client_ws.send_text(
            json.dumps(
                {
                    "type": "error",
                    "source": "backend",
                    "code": "missing_api_key",
                    "message": "OPENAI_API_KEY not configured",
                }
            )
        )
        return

    url = f"{settings.OPENAI_REALTIME_URL}?model={settings.OPENAI_REALTIME_MODEL}"
    headers = {"Authorization": f"Bearer {settings.OPENAI_API_KEY}"}

    try:
        async with websockets.connect(
            url, additional_headers=headers, max_size=None
        ) as openai_ws:
            await openai_ws.send(json.dumps(build_session_update(age_band)))

            await asyncio.gather(
                relay_client_to_openai(client_ws, openai_ws, session_id, age_band),
                relay_openai_to_client(openai_ws, client_ws, session_id, age_band),
                return_exceptions=True,
            )
    except Exception as e:
        log.exception("[%s] proxy_session failed", session_id)
        try:
            await client_ws.send_text(
                json.dumps(
                    {
                        "type": "error",
                        "source": "backend",
                        "code": "upstream_unreachable",
                        "message": f"upstream connection failed: {e}",
                    }
                )
            )
        except Exception:
            pass
