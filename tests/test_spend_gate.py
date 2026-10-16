import ast
import asyncio
import uuid
from decimal import Decimal
from pathlib import Path

import pytest
from fastapi import HTTPException

from backend.config import Settings
from backend.limits import Limits
from backend.spend_gate import SpendGate

ROOT = Path(__file__).resolve().parents[1]
CONSTRUCTORS = {"AsyncOpenAI", "AsyncAnthropic", "OpenAI", "Anthropic"}
CALL_SUFFIXES = (
    "responses.parse",
    "messages.parse",
    "completions.create",
    "transcriptions.create",
    "post_systemone",
)
PAID_HOSTS = (
    "api.elevenlabs.io",
    "api.typesafe.ai",
    "api.openai.com",
    "api.anthropic.com",
    "api.x.ai",
)


def _dotted(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        parent = _dotted(node.value)
        return f"{parent}.{node.attr}" if parent else node.attr
    if isinstance(node, ast.Call):
        return _dotted(node.func)
    return ""


def scan_source(source: str, path: str) -> list[str]:
    """Return provider-client constructions and calls outside the spend gate."""
    if path.endswith("backend/spend_gate.py"):
        return []
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        return [f"{path}: syntax error {exc.lineno}"]
    in_evals = path.startswith("evals/") or "/evals/" in path
    hits = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            for alias in node.names:
                if alias.name in CONSTRUCTORS or alias.asname in CONSTRUCTORS:
                    hits.append(f"{path}:{node.lineno}: imports {alias.name}")
        if isinstance(node, ast.Name) and node.id in CONSTRUCTORS:
            hits.append(f"{path}:{node.lineno}: names {node.id}")
        if isinstance(node, ast.Attribute) and node.attr in CONSTRUCTORS:
            hits.append(f"{path}:{node.lineno}: names {node.attr}")
        if isinstance(node, ast.Call):
            name = _dotted(node.func)
            tail = name.split(".")[-1]
            if tail in CONSTRUCTORS:
                hits.append(f"{path}:{node.lineno}: constructs {name}")
            for suffix in CALL_SUFFIXES:
                if name == suffix or name.endswith("." + suffix):
                    hits.append(f"{path}:{node.lineno}: calls {name}")
            if in_evals and (name == "AsyncClient" or name.endswith(".AsyncClient") or name.endswith(".Client")):
                hits.append(f"{path}:{node.lineno}: constructs {name}")
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            for host in PAID_HOSTS:
                if host in node.value:
                    hits.append(f"{path}:{node.lineno}: paid host {host}")
    return hits


def scan_tree() -> list[str]:
    hits = []
    for folder in ("backend", "evals"):
        root = ROOT / folder
        if not root.exists():
            continue
        for path in sorted(root.rglob("*.py")):
            rel = path.relative_to(ROOT).as_posix()
            hits.extend(scan_source(path.read_text(encoding="utf-8"), rel))
    return hits


def settings(tmp_path, **kwargs):
    values = dict(_env_file=None, database_path=tmp_path / "quota.sqlite3", session_secret="test-secret-" * 4)
    values.update(kwargs)
    return Settings(**values)


def test_provider_clients_are_only_used_by_the_spend_gate():
    assert scan_tree() == []


def test_scanner_flags_a_client_outside_the_gate():
    source = "from openai import AsyncOpenAI\nAsyncOpenAI(api_key='x')\n"
    assert scan_source(source, "backend/jev.py")
    assert scan_source(source, "backend/spend_gate.py") == []
    assert scan_source('url = "https://api.typesafe.ai/v1/systemone"\n', "evals/jev/run_eval.py")
    assert scan_source("await client.responses.parse(model='x')\n", "backend/providers.py")


def test_per_visitor_cap_rejects_before_the_provider_call(tmp_path):
    configured = settings(tmp_path)
    gate = SpendGate(configured, Limits(configured))
    calls = []

    async def attempt(owner, ip):
        async def call():
            calls.append(owner)
            return "ok"

        with gate.guard(owner=owner, ip=ip, request_id=str(uuid.uuid4()), activity_id=None, kind="analysis", paid=False):
            return await call()

    for index in range(3):
        assert asyncio.run(attempt("visitor", f"ip-{index}")) == "ok"
    with pytest.raises(HTTPException) as rejected:
        asyncio.run(attempt("visitor", "ip-other"))
    assert rejected.value.status_code == 429
    assert calls == ["visitor", "visitor", "visitor"]
    assert asyncio.run(attempt("someone-else", "ip-fresh")) == "ok"
    assert calls == ["visitor", "visitor", "visitor", "someone-else"]


def test_global_budget_cap_rejects_before_the_provider_call(tmp_path):
    configured = settings(tmp_path)
    configured.daily_budget_usd = Decimal("0.10")
    gate = SpendGate(configured, Limits(configured))
    calls = []

    async def attempt(owner):
        async def call():
            calls.append(owner)
            return "ok"

        with gate.guard(owner=owner, ip=owner, request_id=str(uuid.uuid4()), activity_id=None, kind="analysis", paid=True):
            return await call()

    assert asyncio.run(attempt("visitor-a")) == "ok"
    with pytest.raises(HTTPException) as rejected:
        asyncio.run(attempt("visitor-b"))
    assert rejected.value.status_code == 429
    assert calls == ["visitor-a"]


def test_unreserved_provider_call_does_not_construct_a_client(tmp_path, monkeypatch):
    def boom(*args, **kwargs):
        raise AssertionError("provider client constructed")

    monkeypatch.setattr("backend.spend_gate.AsyncOpenAI", boom)
    monkeypatch.setattr("backend.spend_gate.AsyncAnthropic", boom)
    gate = SpendGate(settings(tmp_path), Limits(settings(tmp_path)))
    with pytest.raises(HTTPException) as rejected:
        asyncio.run(gate.openai_responses_parse(model="gpt-5-mini"))
    assert rejected.value.status_code == 403


@pytest.mark.parametrize(
    "call",
    [
        lambda g: g.openai_transcription(model="m", file=b""),
        lambda g: g.anthropic_messages_parse(model="m"),
        lambda g: g.compatible_chat(local=False, model="m"),
        lambda g: g.compatible_chat(local=True, model="m"),
        lambda g: g.elevenlabs_speech(b""),
    ],
)
def test_every_unreserved_provider_method_is_rejected(tmp_path, monkeypatch, call):
    def boom(*args, **kwargs):
        raise AssertionError("provider client constructed")

    for name in ("AsyncOpenAI", "AsyncAnthropic"):
        monkeypatch.setattr(f"backend.spend_gate.{name}", boom)
    monkeypatch.setattr("backend.spend_gate.httpx.AsyncClient", boom)
    gate = SpendGate(settings(tmp_path), Limits(settings(tmp_path)))
    with pytest.raises(HTTPException) as rejected:
        asyncio.run(call(gate))
    assert rejected.value.status_code == 403
