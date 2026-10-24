import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
from backend.config import Settings
from backend.limits import Limits
from backend.models import HurtMap, MapRequest
from backend.providers import AnthropicProvider, CompatibleProvider, OpenAIProvider
from backend.spend_gate import SpendGate


def request():
    return MapRequest(request_id="00000000-0000-0000-0000-000000000000", note="Right knee aches", consent=True)


def gate_for(tmp_path, **kwargs):
    settings = Settings(_env_file=None, database_path=tmp_path / "quota.sqlite3", session_secret="test-secret-" * 4, **kwargs)
    return settings, SpendGate(settings, Limits(settings))


def run_map(gate, provider, req, paid):
    async def invoke():
        with gate.guard(owner="tester", ip="tester-ip", request_id=req.request_id, activity_id=None, kind="analysis", paid=paid):
            return await provider.map(req)
    try:
        return asyncio.run(invoke())
    finally:
        asyncio.run(gate.aclose())


def result():
    return HurtMap(title="Right knee", summary="Reported right knee ache.", regions=["right_knee"], quality="Aching", intensity=None, activity="Not described yet", duration="Not described yet", question=None, urgent=False, safety_message=None)


def test_openai_structured_mapping_disables_storage_and_limits_output(tmp_path):
    settings, gate = gate_for(tmp_path, openai_api_key="test")
    provider = OpenAIProvider(settings, gate)
    mock = AsyncMock(return_value=SimpleNamespace(output_parsed=result()))
    gate.openai_client().responses.parse = mock
    mapped = run_map(gate, provider, request(), paid=True)
    assert mapped.regions == ["right_knee"]
    kwargs = mock.call_args.kwargs
    assert kwargs["store"] is False
    assert kwargs["max_output_tokens"] == 2000
    assert kwargs["text_format"] is HurtMap
    assert "request_id" not in json.loads(kwargs["input"])


def test_anthropic_uses_sdk_schema_transform(tmp_path):
    settings, gate = gate_for(tmp_path, anthropic_api_key="test")
    provider = AnthropicProvider(settings, gate)
    mock = AsyncMock(return_value=SimpleNamespace(parsed_output=result(), stop_reason="end_turn"))
    gate.anthropic_client().messages.parse = mock
    assert run_map(gate, provider, request(), paid=True).intensity is None
    assert mock.call_args.kwargs["output_format"] is HurtMap
    assert mock.call_args.kwargs["max_tokens"] == 2000


def test_local_adapter_uses_configured_endpoint_and_validates_json(tmp_path):
    settings, gate = gate_for(tmp_path, local_model="my-model", local_base_url="http://127.0.0.1:1234/v1")
    provider = CompatibleProvider(settings, gate, local=True)
    mock = AsyncMock(return_value=SimpleNamespace(choices=[SimpleNamespace(finish_reason="stop", message=SimpleNamespace(content=result().model_dump_json()))]))
    gate.local_client().chat.completions.create = mock
    assert str(gate.local_client().base_url) == "http://127.0.0.1:1234/v1/"
    assert run_map(gate, provider, request(), paid=False).title == "Right knee"
    assert mock.call_args.kwargs["model"] == "my-model"
    assert mock.call_args.kwargs["response_format"] == {"type": "json_object"}


def test_grok_uses_fixed_provider_endpoint_and_strict_schema(tmp_path):
    settings, gate = gate_for(tmp_path, xai_api_key="test")
    provider = CompatibleProvider(settings, gate)
    mock = AsyncMock(return_value=SimpleNamespace(choices=[SimpleNamespace(finish_reason="stop", message=SimpleNamespace(content=result().model_dump_json()))]))
    gate.grok_client().chat.completions.create = mock
    assert str(gate.grok_client().base_url) == "https://api.x.ai/v1/"
    assert run_map(gate, provider, request(), paid=True).title == "Right knee"
    assert mock.call_args.kwargs["response_format"]["json_schema"]["strict"] is True
