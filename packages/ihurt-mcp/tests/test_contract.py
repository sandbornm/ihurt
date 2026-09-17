import copy
import json
import subprocess

import pytest
from conftest import EXAMPLE, ROOT
from pydantic import ValidationError

from ihurt_mcp.models import REFERENCE, parse_notebook


@pytest.mark.parametrize("path", sorted((ROOT / "docs/examples").glob("*.json")))
def test_documented_examples(path):
    assert parse_notebook(path.read_bytes()).entries


def test_example_and_current_app_exports():
    assert parse_notebook(EXAMPLE.read_bytes()).entries[0].id == "neck-and-tennis-example"
    script = """
    import { anatomyReference } from './src/notebook-data.ts';
    import { regions } from './src/types.ts';
    import { exampleEntry } from './src/example.ts';
    import { stringifyIhm } from './src/export.ts';
    console.log(JSON.stringify({
      reference: {
        anatomy: anatomyReference, regions: regions.map(({id,name}) => ({id,label:name}))
      },
      bundle: JSON.parse(stringifyIhm(exampleEntry()))
    }));
    """
    result = subprocess.run(
        ["node", "--experimental-strip-types", "--input-type=module", "-e", script],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    app = json.loads(result.stdout)
    assert app["reference"] == REFERENCE
    assert len(parse_notebook(json.dumps(app["bundle"]).encode()).entries) == 1


@pytest.mark.parametrize(
    "change",
    [
        lambda d: d.update(schema_version=3),
        lambda d: d["anatomy"]["coordinates"].update(id="other-coordinates"),
        lambda d: d["anatomy"]["models"][0].update(sha256="other-model"),
        lambda d: d["entries"].append(copy.deepcopy(d["entries"][0])),
        lambda d: d["entries"][0]["highlights"].append(d["entries"][0]["highlights"][0]),
        lambda d: d["entries"][0]["highlights"][0].update(position=[True, 0, 0]),
        lambda d: d["entries"][0]["highlights"][0].update(region="unknown-region"),
        lambda d: d["entries"][0]["related_reading"][0].update(url="http://example.org"),
        lambda d: d["entries"][0]["context"].update(intensity=11),
        lambda d: d["entries"][0].update(created="not-a-date"),
    ],
)
def test_rejects_invalid_contract(document, change):
    change(document)
    with pytest.raises((ValueError, ValidationError)):
        parse_notebook(json.dumps(document).encode())


@pytest.mark.parametrize("data", [b'{"a":1,"a":2}', b'{"a":NaN}', b'{"a":Infinity}'])
def test_rejects_non_json_or_ambiguous_data(data):
    with pytest.raises(ValueError):
        parse_notebook(data)


def test_extra_bundle_fields_are_not_exposed(document):
    document["bundle"] = {"kind": "ihurt.map", "version": 1}
    document["review_request"] = "Example attached text"
    document["attachments"] = [{"name": "example.txt", "data": "Example attachment"}]
    result = parse_notebook(json.dumps(document).encode()).model_dump()
    assert "review_request" not in result
    assert "attachments" not in result


def test_area_coordinates_are_retained_and_checked(document):
    pin = document["entries"][0]["highlights"][0]
    start = pin["position"]
    end = [start[0] + 0.1, *start[1:]]
    pin["area"] = {"path": [start, end], "radius": 0.12}
    result = parse_notebook(json.dumps(document).encode())
    assert result.entries[0].highlights[0].area.path[-1] == tuple(end)
    pin["area"]["path"][0] = [0, 0, 0]
    with pytest.raises(ValueError):
        parse_notebook(json.dumps(document).encode())
