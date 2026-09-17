"""Launch an optional stdio server with a user-selected export allowlist."""

import argparse
from importlib.metadata import version
from pathlib import Path

from ihurt_mcp.catalog import Catalog, ExportError
from ihurt_mcp.server import create_server


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Read selected iHurt exports over local MCP stdio."
    )
    parser.add_argument("--version", action="version", version=version("ihurt-mcp"))
    parser.add_argument(
        "--file",
        type=Path,
        action="append",
        required=True,
        help="An .ihm or JSON export the connected AI host may read; repeat as needed.",
    )
    parser.add_argument("--check", action="store_true", help="Validate selected exports and exit.")
    args = parser.parse_args()
    try:
        catalog = Catalog(args.file)
    except ExportError as error:
        parser.error(str(error))
    if args.check:
        print(f"Valid: {catalog.export_count} exports, {len(catalog.entries)} entries")
        return
    create_server(catalog).run(transport="stdio")
