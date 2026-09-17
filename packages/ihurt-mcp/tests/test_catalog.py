import copy
import json

import pytest

from ihurt_mcp.catalog import Catalog, ExportError


def test_snapshot_is_fixed_and_selectors_distinguish_files(export_file):
    catalog = Catalog([export_file, export_file])
    export_file.unlink()
    first = catalog.listing(0, 1)
    assert first["total"] == 2
    assert first["next_offset"] == 1
    assert first["entries"][0]["entry_id"] == "entry-1-1"
    assert catalog.listing(1, 1)["entries"][0]["entry_id"] == "entry-2-1"
    assert catalog.read("entry-1-1", 0, 1, False)["entry"]["note"]
    with pytest.raises(ExportError, match="not in the selected exports"):
        catalog.read("unknown", 0, 1, False)


def test_all_pins_can_be_paged(document, export_file):
    template = document["entries"][0]["highlights"][0]
    document["entries"][0]["highlights"] = [
        {**template, "id": f"example-{index}"} for index in range(605)
    ]
    export_file.write_text(json.dumps(document))
    catalog = Catalog([export_file])
    offset, pins = 0, []
    while offset is not None:
        page = catalog.read("entry-1-1", offset, 100, False)
        assert page["total_pins"] == 605
        pins.extend(page["entry"]["highlights"])
        offset = page["next_pin_offset"]
    assert len({pin["id"] for pin in pins}) == 605


def test_ai_requires_opt_in_and_stays_separate(document, export_file):
    entry = document["entries"][0]
    entry["ai_notes"] = {
        "provider": "Example AI",
        "created": entry["created"],
        "based_on": "Example note",
        "answers": [{"key": "activity", "text": "Tennis"}],
        "map": {
            **entry["context"],
            "title": "Example interpretation",
            "summary": "Example AI text",
            "regions": ["neck"],
            "urgent": True,
            "safety_message": "Example caution",
        },
    }
    export_file.write_text(json.dumps(document))
    catalog = Catalog([export_file])
    assert "ai_notes" not in catalog.read("entry-1-1", 0, 50, False)["entry"]
    shared = catalog.read("entry-1-1", 0, 50, True)["entry"]
    assert shared["note"] == entry["note"]
    assert shared["ai_notes"]["map"]["safety_message"] == "Example caution"
    assert shared["ai_notes"]["answers"][0]["text"] == "Tennis"


def test_comparison_preserves_zero_and_missing_intensity(document, export_file):
    earlier = document["entries"][0]
    earlier["context"]["intensity"] = 0
    later = copy.deepcopy(earlier)
    later.update(id="example-later", created="2026-09-14T12:00:00+00:00")
    later["context"]["intensity"] = 3
    document["entries"].append(later)
    export_file.write_text(json.dumps(document))
    catalog = Catalog([export_file])
    assert catalog.compare("entry-1-1", "entry-1-2")["reported_intensity_change"] == 3
    with pytest.raises(ExportError, match="earlier recorded entry first"):
        catalog.compare("entry-1-2", "entry-1-1")
    later["context"]["intensity"] = None
    export_file.write_text(json.dumps(document))
    assert (
        Catalog([export_file]).compare("entry-1-1", "entry-1-2")["reported_intensity_change"]
        is None
    )


def test_invalid_export_error_does_not_echo_contents(export_file):
    export_file.write_text('{"format":"Example personal text"}')
    with pytest.raises(ExportError) as error:
        Catalog([export_file])
    assert str(error.value) == "Export 1: invalid or unsupported iHurt export"


def test_file_selection_limits(export_file, tmp_path, monkeypatch):
    with pytest.raises(ExportError, match="between 1 and 128"):
        Catalog([])
    link = tmp_path / "link.json"
    link.symlink_to(export_file)
    with pytest.raises(ExportError, match="symbolic link"):
        Catalog([link])
    directory = tmp_path / "directory.json"
    directory.mkdir()
    with pytest.raises(ExportError):
        Catalog([directory])
    monkeypatch.setattr("ihurt_mcp.catalog.MAX_TOTAL_BYTES", export_file.stat().st_size)
    with pytest.raises(ExportError, match="64 MB in total"):
        Catalog([export_file, export_file])
    monkeypatch.setattr("ihurt_mcp.catalog.MAX_FILE_BYTES", 10)
    with pytest.raises(ExportError, match="exceeds 10 MB"):
        Catalog([export_file])
