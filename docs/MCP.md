# Use iHurt with an MCP host

The optional `ihurt-mcp` package lets an MCP host read journal exports you select.
It lives in this repository so its schema and anatomy metadata can be checked
against the app. It has its own Python package, dependencies, and release version.
The browser notebook still works without it.

The server uses local standard input/output (stdio). It reads a snapshot of the
selected files at startup and provides read-only tools. It does not access browser
storage, scan folders, fetch links, or call an AI provider.

## Choose what to share

In the notebook, open **Share with AI**, choose the fields to include, and review
the preview. Download the sharing JSON or `.ihm` file. Both contain the same map.
The regular **Export JSON** action exports the full entry.

Every entry and field in a selected file is available to the connected MCP host.
The host may send that data to an AI provider under its own data policy. Previous
AI interpretations require `include_ai: true` to appear in a tool response, but
this flag is not an access restriction: the host can request them if they are in
the file. Omit sensitive fields before exporting.

Restart the MCP process after changing an export or its file selection. Removing
a file does not erase the running snapshot or any data already sent to a host.

## Install and run

Use Python 3.12+ and [uv](https://docs.astral.sh/uv/) 0.12.15+.
From the repository root:

```sh
uv sync --directory packages/ihurt-mcp --frozen --no-dev
uv run --directory packages/ihurt-mcp --frozen --no-dev ihurt-mcp \
  --file /absolute/path/to/your-export.json --check
```

`--check` validates the file and prints counts. Without it, the process waits for
an MCP host. Repeat `--file` to allow additional exports.

For a host that uses `mcpServers` JSON configuration, adapt this example. Replace
both absolute paths, and use the absolute path to `uv` if the host cannot find it:

```json
{
  "mcpServers": {
    "ihurt": {
      "command": "uv",
      "args": [
        "--directory", "/absolute/path/to/ihurt/packages/ihurt-mcp",
        "run", "--frozen", "--no-dev", "ihurt-mcp",
        "--file", "/absolute/path/to/your-export.json"
      ]
    }
  }
}
```

Only hosts with local stdio MCP support can use this command. A website cannot
launch it directly. There is no hosted MCP endpoint or public package release in
this version. Do not use `uvx ihurt-mcp` assuming it installs this repository.

You can also build and install an isolated command from this checkout:

```sh
uv build --directory packages/ihurt-mcp --no-sources
uv tool install ./packages/ihurt-mcp/dist/ihurt_mcp-0.1.0-py3-none-any.whl
```

The installed command is `ihurt-mcp --file /absolute/path/to/your-export.json`.
The MCP server adds **$0 in hosted services or model calls**. Your AI host may
charge for its own usage. Dependency installation needs internet access; serving
the selected files does not.

## Tools and resources

| Name | Purpose |
| --- | --- |
| `list_entries` | Page through titles, dates, regions, and pin counts. |
| `read_entry` | Read an entry and a page of pins; prior AI text is excluded by default. |
| `compare_entries` | Compare recorded context, region lists, and pin counts for two entries. |
| `ihurt://anatomy` | Read model hashes, coordinates, region names, attribution, and licenses. |
| `ihurt://schema/notebook-v2` | Read the supported observation fields as JSON Schema. |
| `review_journal` | Get a suggested prompt for summarizing observations and preparing questions. |

Tool IDs such as `entry-1-1` refer to the startup snapshot. They are not filenames
and may change when the file selection changes. Follow `next_offset` and
`next_pin_offset` until `null` to read all entries or pins. Pages contain up to 100
items. There is no pin-count quota; each input file is limited to 10 MB, matching
the app importer. A process accepts up to 128 files, 64 MB total, and 500 entries
per file.

Comparisons use creation dates. A change in recorded intensity is the later
number minus the earlier number; missing values remain unknown, and zero stays
zero. Differences do not establish improvement, a diagnosis, or a cause. Pins
from different entries are not automatically matched.

## Format and body references

The server reads the existing `ihurt.notebook` schema version 2, including `.ihm`
bundles version 1. It verifies the coordinate identifier and model hashes as well
as field types, dates, region IDs, unique IDs, and bounded values. The JSON Schema
describes fields; runtime checks also enforce model identity and consistency
between pins and regions. Unknown bundle attachments and embedded review prompts
are ignored. The server's review prompt is defined in code.

Coordinates remain in the detailed Z-Anatomy model's normalized space. The two
outer-body reference assets are separate visual references; they do not have a
pin-transfer mapping or represent a person's measurements. This package does not
change the coordinate system. A future mapping needs explicit versioning and
migration. See [the `.ihm` format](IHM.md).

Journal text, links, labels, and AI output remain untrusted data. MCP annotations
describe these tools as read-only; a host must still treat the returned strings
as observations rather than instructions. No tool writes files, requests another
path, or fetches a supplied URL. The server makes no diagnostic claims.

## Develop the package

```sh
uv sync --directory packages/ihurt-mcp --frozen
uv run --directory packages/ihurt-mcp --frozen ruff check .
uv run --directory packages/ihurt-mcp --frozen ruff format --check .
uv run --directory packages/ihurt-mcp --frozen pytest -q
uv build --directory packages/ihurt-mcp --no-sources
```

The `src/ihurt_mcp` package separates validation (`models.py`), the selected-file
snapshot (`catalog.py`), MCP tools (`server.py`), and the command (`cli.py`).
`anatomy.json` is a packaged snapshot of the app's exported anatomy metadata and
region labels. A contract test compares it against the TypeScript source and
parses a current app-generated `.ihm` file. Tests also exercise a real stdio
handshake, pagination, omitted AI text, validation failures, and file selection.

The package uses the official Python MCP SDK and `uv_build`. Its lockfile and CI
are independent of the optional web API. CI builds a wheel and source archive
and validates an example with the installed wheel. Publish releases separately
when a registry release is needed; the web app does not install this package.
