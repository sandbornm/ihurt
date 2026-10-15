from enum import StrEnum
from math import dist
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class Region(StrEnum):
    neck = "neck"
    chest = "chest"
    upper_back = "upper_back"
    lower_back = "lower_back"
    abdomen = "abdomen"
    left_shoulder = "left_shoulder"
    right_shoulder = "right_shoulder"
    left_elbow = "left_elbow"
    right_elbow = "right_elbow"
    left_wrist = "left_wrist"
    right_wrist = "right_wrist"
    left_hip = "left_hip"
    right_hip = "right_hip"
    left_thigh = "left_thigh"
    right_thigh = "right_thigh"
    left_knee = "left_knee"
    right_knee = "right_knee"
    left_calf = "left_calf"
    right_calf = "right_calf"
    left_ankle = "left_ankle"
    right_ankle = "right_ankle"
    left_foot = "left_foot"
    right_foot = "right_foot"


class Question(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: Literal["location", "quality", "intensity", "duration", "activity", "spread"]
    prompt: str = Field(max_length=240)
    options: list[str] = Field(max_length=5)


class HurtMap(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(max_length=80)
    summary: str = Field(max_length=1000)
    regions: list[Region] = Field(max_length=10)
    quality: str = Field(max_length=80)
    intensity: int | None = Field(ge=0, le=10)
    activity: str = Field(max_length=120)
    duration: str = Field(max_length=120)
    question: Question | None
    urgent: bool
    safety_message: str | None = Field(max_length=500)


class Answer(BaseModel):
    key: Literal["location", "quality", "intensity", "duration", "activity", "spread"]
    text: str = Field(min_length=1, max_length=500)


class SurfaceArea(BaseModel):
    model_config = ConfigDict(extra="forbid")
    path: list[tuple[float, float, float]] = Field(min_length=2, max_length=48)
    radius: float = Field(ge=0.03, le=0.25, allow_inf_nan=False)

    @model_validator(mode="after")
    def bound_path(self):
        if any(not -4 <= n <= 4 for point in self.path for n in point):
            raise ValueError("Highlighted area lies outside the body atlas.")
        if any(dist(a, b) > 0.5 for a, b in zip(self.path, self.path[1:])):
            raise ValueError("Highlighted area has a gap.")
        return self


class PointObservation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[a-f0-9-]{36}$")
    region: Region
    position: tuple[float, float, float]
    structure: str = Field(max_length=150)
    comment: str = Field(default="", max_length=1000)
    area: SurfaceArea | None = None

    @model_validator(mode="after")
    def bound_position(self):
        if any(not -4 <= value <= 4 for value in self.position):
            raise ValueError("Point lies outside the body atlas.")
        if self.area and self.area.path[0] != self.position:
            raise ValueError("Highlighted area must start at its pin.")
        return self


class MapRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str = Field(pattern=r"^[a-f0-9-]{36}$")
    activity_id: str | None = Field(default=None, pattern=r"^[a-f0-9-]{36}$")
    note: str = Field(min_length=3, max_length=3000)
    selected_region: Region | None = None
    points: list[PointObservation] = Field(default_factory=list, max_length=10)
    answers: list[Answer] = Field(default_factory=list, max_length=5)
    consent: bool = False
    provider: Literal["demo", "openai", "anthropic", "grok", "local"] = "demo"
    challenge_token: str = Field(default="", max_length=2048)

    @model_validator(mode="after")
    def bound_content(self):
        if len(self.model_dump_json().encode()) > 18000:
            raise ValueError("Your note is too long. Please shorten it.")
        if len({p.id for p in self.points}) != len(self.points):
            raise ValueError("Each pin must have a unique ID.")
        if len({a.key for a in self.answers}) != len(self.answers):
            raise ValueError("Each follow-up can be answered once.")
        return self


class PainRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str = Field(pattern=r"^[a-f0-9-]{36}$")
    text: str = Field(min_length=3, max_length=3000)
    consent: bool = False
    challenge_token: str = Field(default="", max_length=2048)


class PainLabel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[a-z][a-z0-9_]{0,40}$")
    label: str = Field(max_length=80)
    confidence: float = Field(ge=0, le=1)


class PainSubLocation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[a-z][a-z0-9_]{0,40}$")
    label: str = Field(max_length=80)
    confidence: float = Field(ge=0, le=1)


class PainRegionHit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[a-z][a-z0-9_]{0,40}$")
    anatomy_id: Region
    side: Literal["left", "right"] | None
    name: str = Field(max_length=80)
    confidence: float = Field(ge=0, le=1)
    sub_location: PainSubLocation | None = None


# Band id -> (label, representative 0-10). The model picks a band. The number is assigned here.
# Stated 0-10 numbers use PAIN_LEVEL_CRITERIA ranges: 0 none, 1-3 mild, 4-5 moderate, 6-7 severe, 8-10 very_severe.
PAIN_LEVEL_BANDS: dict[str, tuple[str, int]] = {
    "none": ("None", 0),
    "mild": ("Mild (2-3)", 2),
    "moderate": ("Moderate (4-5)", 4),
    "severe": ("Severe (6-7)", 6),
    "very_severe": ("Very severe (8-10)", 9),
}


def band_for_pain_value(value: int) -> str | None:
    if type(value) is not int or not 0 <= value <= 10:
        return None
    if value == 0:
        return "none"
    if value <= 3:
        return "mild"
    if value <= 5:
        return "moderate"
    if value <= 7:
        return "severe"
    return "very_severe"


class PainLevel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    band: Literal["none", "mild", "moderate", "severe", "very_severe"]
    label: str = Field(max_length=80)
    value: int = Field(ge=0, le=10)
    confidence: float = Field(ge=0, le=1)
    source: Literal["stated", "model"] = "model"

    @model_validator(mode="after")
    def matches_band(self):
        label, number = PAIN_LEVEL_BANDS[self.band]
        if self.label != label:
            raise ValueError("Pain level does not match its band.")
        if self.source == "stated":
            if band_for_pain_value(self.value) != self.band:
                raise ValueError("Pain level does not match its band.")
        elif self.value != number:
            raise ValueError("Pain level does not match its band.")
        return self


class PainSide(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: Literal["left", "right", "both", "midline", "unspecified"]
    label: str = Field(max_length=80)
    confidence: float = Field(ge=0, le=1)


class PainRadiation(BaseModel):
    """A yes answer. Destinations are catalog regions. A no answer is omitted."""

    model_config = ConfigDict(extra="forbid")
    present: Literal[True]
    confidence: float = Field(ge=0, le=1)
    regions: list[PainRegionHit] | None


class PainSuggestion(BaseModel):
    """Structured suggestion. Region ids are catalog entries, never pin coordinates."""

    model_config = ConfigDict(extra="forbid")
    regions: list[PainRegionHit] | None
    side: PainSide | None
    pain_type: PainLabel | None
    severity: PainLabel | None
    pain_level: PainLevel | None
    radiation: PainRadiation | None
    triggers: list[PainLabel] | None
    red_flags: list[PainLabel] | None
    model: str = Field(pattern=r"^[A-Za-z0-9._-]{1,40}$")
