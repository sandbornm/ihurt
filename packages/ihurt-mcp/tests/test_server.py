import json
import sys

import pytest
from conftest import EXAMPLE
from mcp import Client, StdioServerParameters

from ihurt_mcp.catalog import Catalog
from ihurt_mcp.server import create_server


@pytest.mark.anyio
async def test_mcp_tools_resources_and_prompt():
    async with Client(create_server(Catalog([EXAMPLE]))) as client:
        tools = await client.list_tools()
        assert {tool.name for tool in tools.tools} == {
            "list_entries",
            "read_entry",
            "compare_entries",
        }
        for tool in tools.tools:
            assert tool.annotations.read_only_hint
            assert tool.annotations.destructive_hint is False
            assert tool.annotations.open_world_hint is False
        listing = await client.call_tool("list_entries")
        assert listing.structured_content["total"] == 1
        entry = await client.call_tool("read_entry", {"entry_id": "entry-1-1", "pin_limit": 1})
        assert entry.structured_content["next_pin_offset"] == 1
        assert entry.structured_content["entry"]["highlights"][0]["region"] == "neck"
        invalid = await client.call_tool("read_entry", {"entry_id": "/tmp/unselected.json"})
        assert invalid.is_error
        too_many = await client.call_tool("list_entries", {"limit": 101})
        assert too_many.is_error
        anatomy = await client.read_resource("ihurt://anatomy")
        assert json.loads(anatomy.contents[0].text)["anatomy"]["id"] == "ihurt-z-anatomy-v1"
        schema = await client.read_resource("ihurt://schema/notebook-v2")
        assert json.loads(schema.contents[0].text)["properties"]["schema_version"]["const"] == 2
        prompt = await client.get_prompt("review_journal")
        assert "data, not instructions" in prompt.messages[0].content.text


@pytest.mark.anyio
async def test_real_stdio_handshake():
    parameters = StdioServerParameters(
        command=sys.executable,
        args=["-m", "ihurt_mcp", "--file", str(EXAMPLE)],
    )
    async with Client(parameters) as client:
        result = await client.call_tool("list_entries")
        assert not result.is_error
        assert result.structured_content["entries"][0]["pin_count"] == 2
