from dataclasses import dataclass, field


@dataclass(frozen=True)
class AgeBandConfig:
    vocabulary_level: str  # "simple" | "moderate" | "advanced"
    max_response_sentences: int
    topics_to_redirect: tuple[str, ...]
    system_prompt_tone: str


_COMMON_REDIRECTS = ("weapons", "graphic violence", "adult content", "self-harm")

AGE_BAND_CONFIGS: dict[str, AgeBandConfig] = {
    "4-6": AgeBandConfig(
        vocabulary_level="simple",
        max_response_sentences=2,
        topics_to_redirect=_COMMON_REDIRECTS + ("death", "scary stories", "romance"),
        system_prompt_tone="warm, playful, very simple words, like a friendly storybook narrator",
    ),
    "7-9": AgeBandConfig(
        vocabulary_level="moderate",
        max_response_sentences=4,
        topics_to_redirect=_COMMON_REDIRECTS + ("graphic death", "romance"),
        system_prompt_tone="curious, encouraging, fun, slightly more detailed answers",
    ),
    "10-12": AgeBandConfig(
        vocabulary_level="advanced",
        max_response_sentences=6,
        topics_to_redirect=_COMMON_REDIRECTS,
        system_prompt_tone="respectful, informative, conversational but still age-appropriate",
    ),
}

VALID_AGE_BANDS = tuple(AGE_BAND_CONFIGS.keys())


def get_config(age_band: str) -> AgeBandConfig:
    if age_band not in AGE_BAND_CONFIGS:
        raise ValueError(f"Unknown age band: {age_band}")
    return AGE_BAND_CONFIGS[age_band]
