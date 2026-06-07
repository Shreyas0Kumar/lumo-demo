from __future__ import annotations

from collections import Counter

from fastapi import APIRouter, HTTPException, Query, Request, WebSocket, status

from app.config import settings
from app.rate_limit import limiter
from app.services.safety.age_bands import VALID_AGE_BANDS
from app.services.safety.parent_summary import format_summary
from app.session_store import store
from app.ws_proxy import proxy_session

router = APIRouter(prefix="/session", tags=["session"])


def _client_ip(request: Request) -> str:
    """Resolve the real client IP, honoring nginx / Cloudflare proxy headers."""
    cf = request.headers.get("cf-connecting-ip")
    if cf:
        return cf.strip()
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    xr = request.headers.get("x-real-ip")
    if xr:
        return xr.strip()
    return request.client.host if request.client else "unknown"


@router.post("/quota")
async def reserve_quota(request: Request):
    """Reserve one session for the caller's IP against the daily cap.

    Called by the frontend *before* opening the realtime WebSocket so a capped
    visitor gets a clean message without a mic prompt or any OpenAI cost.
    """
    limit = settings.SESSION_CAP_PER_IP_PER_DAY
    if limit <= 0:
        return {"allowed": True, "remaining": -1, "limit": 0}
    allowed, remaining = limiter.consume(_client_ip(request), limit)
    return {"allowed": allowed, "remaining": remaining, "limit": limit}


def _serialize(session) -> dict:
    return {
        "session_id": session.session_id,
        "age_band": session.age_band,
        "configured_duration_seconds": session.duration_seconds,
        "started_at": session.started_at.isoformat(),
        "ended_at": session.ended_at.isoformat() if session.ended_at else None,
        "turns": [
            {
                "turn_id": t.turn_id,
                "role": t.role,
                "transcript": t.transcript,
                "timestamp": t.timestamp.isoformat(),
            }
            for t in session.turns
        ],
        "safety_events": [
            {
                "turn_id": e.turn_id,
                "reason_code": e.reason_code,
                "action_taken": e.action_taken,
                "timestamp": e.timestamp.isoformat(),
            }
            for e in session.safety_events
        ],
    }


@router.websocket("/ws")
async def session_ws(
    ws: WebSocket,
    age_band: str = Query(...),
    duration: int = Query(300, ge=30, le=3600),
):
    if age_band not in VALID_AGE_BANDS:
        await ws.close(code=4400)
        return
    await ws.accept()
    record = store.create_session(age_band, duration_seconds=duration)
    await ws.send_text(
        f'{{"type":"session.created","session_id":"{record.session_id}"}}'
    )
    await proxy_session(ws, record.session_id, age_band)


@router.post("/{session_id}/end")
async def end_session(session_id: str):
    record = store.end_session(session_id)
    if record is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "session not found")
    return _serialize(record)


@router.get("/{session_id}/summary")
async def session_summary(session_id: str):
    record = store.get_session(session_id)
    if record is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "session not found")
    duration = (
        (record.ended_at - record.started_at).total_seconds()
        if record.ended_at
        else None
    )
    reason_counts = dict(Counter(e.reason_code for e in record.safety_events))
    return {
        **_serialize(record),
        "reason_code_counts": reason_counts,
        "duration_seconds": duration,
        "parent_summary": format_summary(record),
    }
