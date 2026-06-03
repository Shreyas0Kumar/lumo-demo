from __future__ import annotations

from app.session_store import SessionRecord

from . import reason_codes as rc


def format_summary(session: SessionRecord) -> dict:
    total = len(session.turns) or 1
    safe_ok_count = sum(
        1
        for e in session.safety_events
        if e.reason_code == rc.SAFE_OK
    )

    flagged_turn_ids = {e.turn_id for e in session.safety_events if e.reason_code != rc.SAFE_OK}
    safe_turns = max(0, len(session.turns) - len(flagged_turn_ids))
    safe_turns_pct = round((safe_turns / total) * 100, 1)

    escalations = []
    for e in session.safety_events:
        if e.reason_code == rc.SAFE_ESCALATE_PARENT:
            turn = next((t for t in session.turns if t.turn_id == e.turn_id), None)
            escalations.append(
                {
                    "turn_id": e.turn_id,
                    "transcript": turn.transcript if turn else None,
                    "timestamp": e.timestamp.isoformat(),
                }
            )

    highlights = []
    for t in session.turns[:5]:
        if t.role == "user":
            highlights.append(
                {
                    "turn_id": t.turn_id,
                    "snippet": t.transcript[:120],
                    "timestamp": t.timestamp.isoformat(),
                }
            )

    return {
        "session_id": session.session_id,
        "age_band": session.age_band,
        "highlights": highlights,
        "escalations": escalations,
        "safe_turns_pct": safe_turns_pct,
        "total_turns": len(session.turns),
        "safe_ok_count": safe_ok_count,
    }
