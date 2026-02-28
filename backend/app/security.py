from __future__ import annotations

from typing import Annotated

from fastapi import Header, HTTPException

from app.settings import get_settings


def verify_api_token(
	x_api_key: Annotated[str | None, Header(alias="X-API-Key")] = None,
) -> None:
	"""Require a shared secret when one is configured."""
	settings = get_settings()
	if not settings.api_token:
		return

	if x_api_key != settings.api_token:
		raise HTTPException(status_code=401, detail="Invalid API token.")
