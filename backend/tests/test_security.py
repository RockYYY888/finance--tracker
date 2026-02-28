from collections.abc import Iterator
from typing import Annotated

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.security import verify_api_token
from app.settings import get_settings


@pytest.fixture(autouse=True)
def reset_settings_cache(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
	for env_name in (
		"ASSET_TRACKER_ALLOWED_HOSTS",
		"ASSET_TRACKER_ALLOWED_ORIGINS",
		"ASSET_TRACKER_API_TOKEN",
		"ASSET_TRACKER_APP_ENV",
		"ASSET_TRACKER_PUBLIC_ORIGIN",
	):
		monkeypatch.delenv(env_name, raising=False)

	get_settings.cache_clear()
	yield
	get_settings.cache_clear()


def _build_client() -> TestClient:
	app = FastAPI()

	@app.get("/protected")
	def protected(_: Annotated[None, Depends(verify_api_token)]) -> dict[str, str]:
		return {"status": "ok"}

	return TestClient(app)


def test_settings_default_to_local_development() -> None:
	settings = get_settings()

	assert settings.is_production is False
	assert settings.cors_origins() == ["http://localhost:5173", "http://127.0.0.1:5173"]
	assert settings.trusted_hosts() == ["localhost", "127.0.0.1"]


def test_settings_lock_down_same_origin_in_production(monkeypatch: pytest.MonkeyPatch) -> None:
	monkeypatch.setenv("ASSET_TRACKER_APP_ENV", "production")
	monkeypatch.setenv("ASSET_TRACKER_PUBLIC_ORIGIN", "https://finance.example.com/")
	monkeypatch.setenv("ASSET_TRACKER_API_TOKEN", "secret-token")
	settings = get_settings()

	assert settings.is_production is True
	assert settings.require_api_token is True
	assert settings.cors_origins() == ["https://finance.example.com"]
	assert settings.trusted_hosts() == ["finance.example.com"]


def test_settings_validate_runtime_rejects_incomplete_production_config(
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	monkeypatch.setenv("ASSET_TRACKER_APP_ENV", "production")
	monkeypatch.setenv("ASSET_TRACKER_PUBLIC_ORIGIN", "https://finance.example.com")

	with pytest.raises(ValueError, match="ASSET_TRACKER_API_TOKEN"):
		get_settings().validate_runtime()


def test_verify_api_token_allows_missing_token_when_not_configured() -> None:
	client = _build_client()
	response = client.get("/protected")

	assert response.status_code == 200


def test_verify_api_token_rejects_invalid_token(monkeypatch: pytest.MonkeyPatch) -> None:
	monkeypatch.setenv("ASSET_TRACKER_API_TOKEN", "secret-token")
	client = _build_client()
	response = client.get("/protected", headers={"X-API-Key": "wrong-token"})

	assert response.status_code == 401
	assert response.json() == {"detail": "Invalid API token."}


def test_verify_api_token_rejects_missing_token_when_required(monkeypatch: pytest.MonkeyPatch) -> None:
	monkeypatch.setenv("ASSET_TRACKER_API_TOKEN", "secret-token")
	client = _build_client()
	response = client.get("/protected")

	assert response.status_code == 401
	assert response.json() == {"detail": "Missing API token."}


def test_verify_api_token_rejects_disallowed_origin(monkeypatch: pytest.MonkeyPatch) -> None:
	monkeypatch.setenv("ASSET_TRACKER_API_TOKEN", "secret-token")
	client = _build_client()
	response = client.get(
		"/protected",
		headers={
			"Origin": "https://evil.example.com",
			"X-API-Key": "secret-token",
		},
	)

	assert response.status_code == 403
	assert response.json() == {"detail": "Origin not allowed."}


def test_verify_api_token_allows_same_origin_requests_in_production(
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	monkeypatch.setenv("ASSET_TRACKER_APP_ENV", "production")
	monkeypatch.setenv("ASSET_TRACKER_PUBLIC_ORIGIN", "https://finance.example.com")
	monkeypatch.setenv("ASSET_TRACKER_API_TOKEN", "secret-token")
	client = _build_client()
	response = client.get(
		"/protected",
		headers={
			"Origin": "https://finance.example.com",
			"X-API-Key": "secret-token",
		},
	)

	assert response.status_code == 200


def test_verify_api_token_rejects_production_without_server_token(
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	monkeypatch.setenv("ASSET_TRACKER_APP_ENV", "production")
	monkeypatch.setenv("ASSET_TRACKER_PUBLIC_ORIGIN", "https://finance.example.com")
	client = _build_client()
	response = client.get("/protected", headers={"Origin": "https://finance.example.com"})

	assert response.status_code == 503
	assert response.json() == {
		"detail": "API token is required by the current server configuration.",
	}
