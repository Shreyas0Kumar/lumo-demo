import os
from dataclasses import dataclass, field
from dotenv import find_dotenv, load_dotenv

load_dotenv(find_dotenv(usecwd=True))


def _bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _parse_origins(value: str | None) -> list[str]:
    if not value:
        return ["*"]
    return [o.strip() for o in value.split(",") if o.strip()]


@dataclass(frozen=True)
class Settings:
    OPENAI_API_KEY: str
    OPENAI_REALTIME_MODEL: str
    OPENAI_REALTIME_URL: str
    TTS_VOICE: str
    SESSION_MAX_DURATION_S: int
    DEBUG: bool
    ALLOWED_ORIGINS: list[str] = field(default_factory=lambda: ["*"])


settings = Settings(
    OPENAI_API_KEY=os.getenv("OPENAI_API_KEY", ""),
    OPENAI_REALTIME_MODEL=os.getenv("OPENAI_REALTIME_MODEL", "gpt-realtime-2"),
    OPENAI_REALTIME_URL=os.getenv(
        "OPENAI_REALTIME_URL", "wss://api.openai.com/v1/realtime"
    ),
    TTS_VOICE=os.getenv("TTS_VOICE", "alloy"),
    SESSION_MAX_DURATION_S=int(os.getenv("SESSION_MAX_DURATION_S", "300")),
    DEBUG=_bool(os.getenv("DEBUG"), False),
    ALLOWED_ORIGINS=_parse_origins(os.getenv("ALLOWED_ORIGINS")),
)
