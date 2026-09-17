"""Validated observations from the existing ihurt.notebook v2 contract."""

import json
import math
from datetime import datetime
from importlib.resources import files
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictInt,
    StrictStr,
    field_validator,
    model_validator,
)

REFERENCE = json.loads(files("ihurt_mcp").joinpath("anatomy.json").read_text())
REGIONS = {region["id"]: region["label"] for region in REFERENCE["regions"]}
Text = Annotated[StrictStr, Field(max_length=10000)]
ShortText = Annotated[StrictStr, Field(max_length=200)]
Identifier = Annotated[StrictStr, Field(min_length=1, max_length=100)]
Coordinate = Annotated[float, Field(strict=True, ge=-10, le=10, allow_inf_nan=False)]
Position = tuple[Coordinate, Coordinate, Coordinate]


class Record(BaseModel):
    model_config = ConfigDict(extra="ignore", allow_inf_nan=False)


def checked_date(value: str) -> str:
    datetime.fromisoformat(value.replace("Z", "+00:00"))
    return value


class Region(Record):
    id: StrictStr
    label: ShortText = ""

    @field_validator("id")
    @classmethod
    def known_region(cls, value: str) -> str:
        if value not in REGIONS:
            raise ValueError("Unknown body region")
        return value


class Context(Record):
    quality: ShortText
    activity: ShortText
    duration: ShortText
    intensity: Annotated[float, Field(strict=True, ge=0, le=10)] | None


class Source(Record):
    atlas: Literal["z-anatomy-v1", "schematic-v1"]
    layer: Literal["muscle", "bone"]
    asset: Literal["muscular.glb", "skeleton.glb"] | None = None
    node_index: Annotated[StrictInt, Field(ge=0, le=100000)] | None = None
    mesh_name: Annotated[StrictStr, Field(max_length=300)] | None = None


class Area(Record):
    path: Annotated[list[Position], Field(min_length=2, max_length=48)]
    radius: Annotated[float, Field(strict=True, ge=0.03, le=0.25)]

    @model_validator(mode="after")
    def continuous_path(self):
        if any(math.dist(a, b) > 0.5 for a, b in zip(self.path, self.path[1:], strict=False)):
            raise ValueError("Highlighted area has a gap")
        return self


class Pin(Record):
    id: Identifier
    region: StrictStr
    structure: Annotated[StrictStr, Field(max_length=300)]
    position: Position
    comment: Annotated[StrictStr, Field(max_length=1000)] | None = None
    source: Source | None = None
    area: Area | None = None

    @model_validator(mode="after")
    def valid_location(self):
        if self.region not in REGIONS:
            raise ValueError("Unknown body region")
        if self.area and self.area.path[0] != self.position:
            raise ValueError("Area must start at its pin")
        return self


class Reference(Record):
    title: Annotated[StrictStr, Field(max_length=500)]
    publisher: Annotated[StrictStr, Field(max_length=300)]
    url: Annotated[StrictStr, Field(max_length=2000)]
    checked: Annotated[StrictStr, Field(max_length=50)]
    kind: Literal["video", "article"] | None = None
    context_url: Annotated[StrictStr, Field(max_length=2000)] | None = None

    @field_validator("url", "context_url")
    @classmethod
    def https_without_credentials(cls, value: str | None):
        if value is not None:
            parsed = urlsplit(value)
            if (
                parsed.scheme != "https"
                or not parsed.hostname
                or parsed.username
                or parsed.password
            ):
                raise ValueError("Expected an HTTPS reference without credentials")
        return value


References = Annotated[list[Reference], Field(max_length=100)]


class Research(Record):
    activity: ShortText
    description: Annotated[StrictStr, Field(max_length=4000)] | None = None
    regions: Annotated[list[StrictStr], Field(max_length=23)]
    checked: Annotated[StrictStr, Field(max_length=50)]
    references: References

    @model_validator(mode="after")
    def valid_research(self):
        checked_date(self.checked)
        if not set(self.regions) <= REGIONS.keys():
            raise ValueError("Unknown body region")
        return self


class AIMap(Record):
    title: Annotated[StrictStr, Field(max_length=500)]
    summary: Text
    quality: Annotated[StrictStr, Field(max_length=500)]
    activity: Annotated[StrictStr, Field(max_length=500)]
    duration: Annotated[StrictStr, Field(max_length=500)]
    intensity: Annotated[float, Field(strict=True, ge=0, le=10)] | None
    urgent: StrictBool = False
    safety_message: Annotated[StrictStr, Field(max_length=2000)] | None = None
    regions: Annotated[list[StrictStr], Field(max_length=23)]

    @field_validator("regions")
    @classmethod
    def known_regions(cls, values: list[str]):
        if not set(values) <= REGIONS.keys():
            raise ValueError("Unknown body region")
        return values


class Answer(Record):
    key: Literal["location", "quality", "intensity", "duration", "activity", "spread"]
    text: Annotated[StrictStr, Field(max_length=500)]


class AIInterpretation(Record):
    provider: Annotated[StrictStr, Field(max_length=100)]
    created: Annotated[StrictStr, Field(max_length=50)]
    based_on: Annotated[StrictStr, Field(max_length=30000)]
    map: AIMap
    answers: Annotated[list[Answer], Field(max_length=10)] = Field(default_factory=list)

    @field_validator("created")
    @classmethod
    def valid_date(cls, value: str):
        return checked_date(value)


class Entry(Record):
    id: Identifier
    created: Annotated[StrictStr, Field(max_length=50)]
    updated: Annotated[StrictStr, Field(max_length=50)]
    title: ShortText
    note: Text
    context: Context
    regions: Annotated[list[Region], Field(max_length=23)]
    highlights: list[Pin]
    related_reading: References = Field(default_factory=list)
    research: Research | None = None
    ai_notes: AIInterpretation | None = None

    @field_validator("created", "updated")
    @classmethod
    def valid_date(cls, value: str):
        return checked_date(value)

    @model_validator(mode="after")
    def valid_pins(self):
        ids = [pin.id for pin in self.highlights]
        if len(set(ids)) != len(ids):
            raise ValueError("Duplicate pin IDs")
        if not {pin.region for pin in self.highlights} <= {region.id for region in self.regions}:
            raise ValueError("A highlighted region is missing from the entry")
        return self


class ModelAsset(Record):
    file: StrictStr
    sha256: StrictStr


class Coordinates(Record):
    id: Literal["ihurt-normalized-v1"]


class Anatomy(Record):
    id: Literal["ihurt-z-anatomy-v1"]
    coordinates: Coordinates
    models: Annotated[list[ModelAsset], Field(min_length=2, max_length=2)]

    @model_validator(mode="after")
    def known_models(self):
        expected = {(model["file"], model["sha256"]) for model in REFERENCE["anatomy"]["models"]}
        if {(model.file, model.sha256) for model in self.models} != expected:
            raise ValueError("Anatomy model version differs")
        return self


class Bundle(Record):
    kind: Literal["ihurt.map"]
    version: Literal[1]


class Notebook(Record):
    format: Literal["ihurt.notebook"]
    schema_version: Literal[2]
    anatomy: Anatomy
    entries: Annotated[list[Entry], Field(max_length=500)]
    bundle: Bundle | None = None

    @model_validator(mode="after")
    def unique_entries(self):
        if len({entry.id for entry in self.entries}) != len(self.entries):
            raise ValueError("Duplicate entry IDs")
        return self


def parse_notebook(data: bytes) -> Notebook:
    # Reject duplicate keys and non-JSON constants instead of letting a parser pick a value.
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("Duplicate JSON key")
            result[key] = value
        return result

    def non_json(_value):
        raise ValueError("Non-JSON numeric constant")

    value = json.loads(data, object_pairs_hook=pairs, parse_constant=non_json)
    return Notebook.model_validate(value)
