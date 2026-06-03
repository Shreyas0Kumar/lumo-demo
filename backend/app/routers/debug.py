import json
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, WebSocket, status
from starlette.websockets import WebSocketDisconnect

from app.config import settings
from app.session_store import store

router = APIRouter(prefix="/debug", tags=["debug"])


@router.websocket("/echo-ws")
async def echo_ws(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            ts = datetime.now(timezone.utc).isoformat()
            if (text := msg.get("text")) is not None:
                await ws.send_text(
                    json.dumps({"type": "echo", "ts": ts, "kind": "text", "data": text})
                )
            elif (data := msg.get("bytes")) is not None:
                await ws.send_text(
                    json.dumps(
                        {
                            "type": "echo",
                            "ts": ts,
                            "kind": "bytes",
                            "bytes_len": len(data),
                        }
                    )
                )
    except WebSocketDisconnect:
        return


def _ensure_debug():
    if not settings.DEBUG:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not found")


@router.get("/session/{session_id}")
async def raw_session(session_id: str):
    _ensure_debug()
    rec = store.get_session(session_id)
    if rec is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "session not found")
    return {
        "session_id": rec.session_id,
        "age_band": rec.age_band,
        "started_at": rec.started_at.isoformat(),
        "ended_at": rec.ended_at.isoformat() if rec.ended_at else None,
        "turns": [t.__dict__ for t in rec.turns],
        "safety_events": [e.__dict__ for e in rec.safety_events],
        "raw_event_log": rec.raw_event_log,
    }


@router.get("/events/{session_id}")
async def events_for_session(session_id: str):
    """Ungated: chronological list of every OpenAI event type for this session."""
    rec = store.get_session(session_id)
    if rec is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "session not found")
    return {
        "session_id": session_id,
        "count": len(rec.raw_event_log),
        "events": rec.raw_event_log,
    }


@router.get("/config")
async def active_config():
    _ensure_debug()
    masked_key = (
        settings.OPENAI_API_KEY[:4] + "…" + settings.OPENAI_API_KEY[-4:]
        if len(settings.OPENAI_API_KEY) > 8
        else "***"
    )
    return {
        "OPENAI_API_KEY": masked_key,
        "OPENAI_REALTIME_MODEL": settings.OPENAI_REALTIME_MODEL,
        "OPENAI_REALTIME_URL": settings.OPENAI_REALTIME_URL,
        "TTS_VOICE": settings.TTS_VOICE,
        "SESSION_MAX_DURATION_S": settings.SESSION_MAX_DURATION_S,
        "DEBUG": settings.DEBUG,
    }
