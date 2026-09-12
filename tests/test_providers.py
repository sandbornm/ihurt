import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
from backend.config import Settings
from backend.models import HurtMap, MapRequest
from backend.providers import AnthropicProvider, CompatibleProvider, OpenAIProvider


def request():
    return MapRequest(request_id="00000000-0000-0000-0000-000000000000", note="Right knee aches", consent=True)


def result():
    return HurtMap(title="Right knee", summary="Reported right knee ache.", regions=["right_knee"], quality="Aching", intensity=None, activity="Not described yet", duration="Not described yet", question=None, urgent=False, safety_message=None)


def test_openai_structured_mapping_disables_storage_and_limits_output():
    provider = OpenAIProvider(Settings(_env_file=None, openai_api_key="test"))
    mock = AsyncMock(return_value=SimpleNamespace(output_parsed=result()))
    provider.client.responses.parse = mock
    mapped = asyncio.run(provider.map(request()))
    assert mapped.regions == ["right_knee"]
    kwargs = mock.call_args.kwargs
    assert kwargs["store"] is False
    assert kwargs["max_output_tokens"] == 2000
    assert kwargs["text_format"] is HurtMap
    assert "request_id" not in json.loads(kwargs["input"])
    asyncio.run(provider.client.close())


def test_anthropic_uses_sdk_schema_transform():
    provider = AnthropicProvider(Settings(_env_file=None, anthropic_api_key="test"))
    mock = AsyncMock(return_value=SimpleNamespace(parsed_output=result(), stop_reason="end_turn"))
    provider.client.messages.parse = mock
    assert asyncio.run(provider.map(request())).intensity is None
    assert mock.call_args.kwargs["output_format"] is HurtMap
    assert mock.call_args.kwargs["max_tokens"] == 2000
    asyncio.run(provider.client.close())


def test_local_adapter_uses_configured_endpoint_and_validates_json():
    provider = CompatibleProvider(Settings(_env_file=None, local_model="my-model", local_base_url="http://127.0.0.1:1234/v1"), local=True)
    mock = AsyncMock(return_value=SimpleNamespace(choices=[SimpleNamespace(finish_reason="stop", message=SimpleNamespace(content=result().model_dump_json()))]))
    provider.client.chat.completions.create = mock
    assert str(provider.client.base_url) == "http://127.0.0.1:1234/v1/"
    assert asyncio.run(provider.map(request())).title == "Right knee"
    assert mock.call_args.kwargs["model"] == "my-model"
    assert mock.call_args.kwargs["response_format"] == {"type": "json_object"}
    asyncio.run(provider.client.close())


def test_grok_uses_fixed_provider_endpoint_and_strict_schema():
    provider = CompatibleProvider(Settings(_env_file=None, xai_api_key="test"))
    mock = AsyncMock(return_value=SimpleNamespace(choices=[SimpleNamespace(finish_reason="stop", message=SimpleNamespace(content=result().model_dump_json()))]))
    provider.client.chat.completions.create = mock
    assert str(provider.client.base_url) == "https://api.x.ai/v1/"
    assert asyncio.run(provider.map(request())).title == "Right knee"
    assert mock.call_args.kwargs["response_format"]["json_schema"]["strict"] is True
    asyncio.run(provider.client.close())
