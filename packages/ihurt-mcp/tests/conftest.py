import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
EXAMPLE = ROOT / "docs/examples/neck-tennis.json"


@pytest.fixture
def document():
    return json.loads(EXAMPLE.read_text())


@pytest.fixture
def export_file(tmp_path, document):
    path = tmp_path / "example.json"
    path.write_text(json.dumps(document))
    return path


@pytest.fixture
def anyio_backend():
    return "asyncio"
