import pytest
from fastapi import HTTPException

from app.security import verify_api_token
from app.settings import get_settings


def test_verify_api_token_allows_missing_token_when_not_configured(monkeypatch: pytest.MonkeyPatch) -> None:
	monkeypatch.setenv("ASSET_TRACKER_API_TOKEN", "")
	get_settings.cache_clear()
	verify_api_token(None)


def test_verify_api_token_rejects_invalid_token(monkeypatch: pytest.MonkeyPatch) -> None:
	monkeypatch.setenv("ASSET_TRACKER_API_TOKEN", "secret-token")
	get_settings.cache_clear()

	with pytest.raises(HTTPException) as error:
		verify_api_token("wrong-token")

	assert error.value.status_code == 401
