# iHurt MCP

An optional local MCP server for selected `.ihm` and JSON exports. It lists entries, reads their observations and pins, and compares recorded context across two entries. It makes no model calls, opens no network listener, and does not modify journals.

Use Python 3.12+ and uv 0.12.15+:

```sh
uv sync --frozen
uv run --frozen ihurt-mcp --file /absolute/path/to/your-export.json
```

Your MCP host starts this command and communicates over standard input/output. The process waits for that host; it is not a chat interface. Repeat `--file` for each export you choose to share. There is no default folder scan or browser-storage access.

The server snapshots the selected files at startup. Restart it to load a revised export or change which files are available. Everything in an allowed export can be read by the connected host; use iHurt's sharing controls to omit fields before exporting. A cloud AI host can send those observations to its provider under its own data policy.

See [the setup guide](https://github.com/sandbornm/ihurt/blob/main/docs/MCP.md) for host configuration, tools, limits, and development checks. This package has not been published to a package registry; install it from this repository or a locally built wheel.
