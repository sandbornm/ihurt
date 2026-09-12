import json
from pathlib import Path
from urllib.parse import urlparse


def test_curated_references_have_valid_publishers_and_provenance():
    catalog = json.loads(Path("config/reading-library.json").read_text())
    sources = {s["id"]: s for s in catalog["sources"]}
    assert len(sources) == len(catalog["sources"])
    assert any(s["recommended"] for s in sources.values())
    ids = set()
    for item in catalog["resources"]:
        assert item["id"] not in ids
        ids.add(item["id"])
        assert item["source"] in sources
        url = urlparse(item["url"])
        assert url.scheme == "https"
        assert url.hostname in sources[item["source"]]["hosts"]
        assert item["regions"] and item["checked"] and item["title"]
