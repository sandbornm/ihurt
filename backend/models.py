from enum import StrEnum
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
    regions: list[Region] = Field(max_length=6)
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


class PointObservation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[a-f0-9-]{36}$")
    region: Region
    position: tuple[float, float, float]
    structure: str = Field(max_length=150)

    @model_validator(mode="after")
    def bound_position(self):
        if any(not -4 <= value <= 4 for value in self.position):
            raise ValueError("Point lies outside the body atlas.")
        return self


class MapRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str = Field(pattern=r"^[a-f0-9-]{36}$")
    activity_id: str | None = Field(default=None, pattern=r"^[a-f0-9-]{36}$")
    note: str = Field(min_length=3, max_length=3000)
    selected_region: Region | None = None
    points: list[PointObservation] = Field(default_factory=list, max_length=6)
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
