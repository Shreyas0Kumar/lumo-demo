from __future__ import annotations

import re
from dataclasses import dataclass

from . import reason_codes as rc
from .age_bands import get_config

HARM_KEYWORDS = (
    "kill",
    "gun",
    "shoot",
    "knife attack",
    "bomb",
    "suicide",
    "kill myself",
    "hurt myself",
    "porn",
    "sex",
    "nude",
)

ESCALATE_PARENT_KEYWORDS = (
    "i want to die",
    "nobody loves me",
    "i hate my life",
    "my parents hit",
    "being abused",
    "i'm scared at home",
    "i feel unsafe",
)

DEPENDENCY_PATTERNS = (
    r"you'?re my only friend",
    r"don'?t tell my (mom|dad|parents)",
    r"i love you (lumo|more than)",
    r"can you be my (best )?friend forever",
    r"only you understand me",
)

SENSITIVE_DISCLOSURE_PATTERNS = (
    r"my address is",
    r"my phone number is",
    r"my password is",
    r"my full name is",
    r"i live at",
)


@dataclass
class SafetyResult:
    allowed: bool
    reason_code: str
    action: str


def _contains_any(text: str, keywords) -> bool:
    return any(k in text for k in keywords)


def _matches_any(text: str, patterns) -> bool:
    return any(re.search(p, text) for p in patterns)


def check(transcript: str, age_band: str) -> SafetyResult:
    if not transcript:
        return SafetyResult(True, rc.SAFE_OK, "allow")

    text = transcript.lower().strip()

    if _contains_any(text, HARM_KEYWORDS):
        return SafetyResult(False, rc.SAFE_REFUSED_HARM, "block_and_redirect")

    if _contains_any(text, ESCALATE_PARENT_KEYWORDS):
        return SafetyResult(False, rc.SAFE_ESCALATE_PARENT, "escalate_to_parent")

    if _matches_any(text, DEPENDENCY_PATTERNS):
        return SafetyResult(
            False, rc.SAFE_BOUNDARY_DEPENDENCY_LANGUAGE, "gentle_boundary"
        )

    if _matches_any(text, SENSITIVE_DISCLOSURE_PATTERNS):
        return SafetyResult(
            False, rc.SAFE_MINIMIZED_SENSITIVE_DISCLOSURE, "minimize_and_redirect"
        )

    cfg = get_config(age_band)
    for topic in cfg.topics_to_redirect:
        if topic in text:
            return SafetyResult(False, rc.SAFE_REDIRECTED_GENERAL, "redirect_topic")

    return SafetyResult(True, rc.SAFE_OK, "allow")
