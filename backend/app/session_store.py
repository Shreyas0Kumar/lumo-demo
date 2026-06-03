from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional


def _now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class TurnRecord:
    turn_id: str
    role: str  # "user" | "assistant"
    transcript: str
    timestamp: datetime = field(default_factory=_now)


@dataclass
class SafetyEvent:
    turn_id: str
    reason_code: str
    action_taken: str
    timestamp: datetime = field(default_factory=_now)


@dataclass
class SessionRecord:
    session_id: str
    age_band: str
    duration_seconds: int = 300
    started_at: datetime = field(default_factory=_now)
    ended_at: Optional[datetime] = None
    turns: list[TurnRecord] = field(default_factory=list)
    safety_events: list[SafetyEvent] = field(default_factory=list)
    raw_event_log: list[dict] = field(default_factory=list)


class SessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, SessionRecord] = {}

    def create_session(self, age_band: str, duration_seconds: int = 300) -> SessionRecord:
        sid = str(uuid.uuid4())
        rec = SessionRecord(
            session_id=sid, age_band=age_band, duration_seconds=duration_seconds
        )
        self._sessions[sid] = rec
        return rec

    def get_session(self, session_id: str) -> Optional[SessionRecord]:
        return self._sessions.get(session_id)

    def append_turn(
        self, session_id: str, role: str, transcript: str
    ) -> Optional[TurnRecord]:
        rec = self._sessions.get(session_id)
        if rec is None:
            return None
        turn = TurnRecord(turn_id=str(uuid.uuid4()), role=role, transcript=transcript)
        rec.turns.append(turn)
        return turn

    def append_safety_event(
        self, session_id: str, turn_id: str, reason_code: str, action_taken: str
    ) -> Optional[SafetyEvent]:
        rec = self._sessions.get(session_id)
        if rec is None:
            return None
        evt = SafetyEvent(turn_id=turn_id, reason_code=reason_code, action_taken=action_taken)
        rec.safety_events.append(evt)
        return evt

    def log_event(self, session_id: str, event_type: str) -> None:
        rec = self._sessions.get(session_id)
        if rec is None:
            return
        rec.raw_event_log.append(
            {"type": event_type, "received_at": _now().isoformat()}
        )

    def end_session(self, session_id: str) -> Optional[SessionRecord]:
        rec = self._sessions.get(session_id)
        if rec is None:
            return None
        rec.ended_at = _now()
        return rec


store = SessionStore()
