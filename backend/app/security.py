from __future__ import annotations

from typing import Annotated

from fastapi import Header, HTTPException, Request

from app.settings import get_settings


def verify_api_token(
	request: Request,
	x_api_key: Annotated[str | None, Header(alias="X-API-Key")] = None,
) -> None:
	"""Enforce origin checks and require a shared secret when configured."""
	settings = get_settings()
	origin = request.headers.get("origin")
	if origin and not settings.is_allowed_origin(origin):
		raise HTTPException(status_code=403, detail="Origin not allowed.")

	expected_token = settings.api_token_value()
	if expected_token is None:
		if settings.require_api_token:
			raise HTTPException(
				status_code=503,
				detail="API token is required by the current server configuration.",
			)
		return

	if x_api_key is None:
		raise HTTPException(status_code=401, detail="Missing API token.")

	if x_api_key.strip() != expected_token:
		raise HTTPException(status_code=401, detail="Invalid API token.")
