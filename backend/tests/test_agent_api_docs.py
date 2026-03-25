from __future__ import annotations

from pathlib import Path
import re
from typing import Annotated, Any, get_args, get_origin, get_type_hints

from fastapi.params import Depends
from fastapi.routing import APIRoute

from app.main import app
from app.services.auth_service import get_current_user

FORBIDDEN_CASUAL_PHRASES = {
	"For the current phase",
	"You do not need MCP first",
	"Right now the faster path is",
}

DOC_PATH = Path(__file__).resolve().parents[2] / "docs" / "agent-api.md"


def _load_agent_api_doc() -> str:
	return DOC_PATH.read_text(encoding="utf-8")


def _extract_documented_routes(markdown: str) -> set[tuple[str, str]]:
	pattern = re.compile(
		r"`?(GET|POST|PUT|PATCH|DELETE)`?(?:\s*\|\s*|\s+)`?(/api/[^\s`|)]+)`?",
	)
	routes: set[tuple[str, str]] = set()
	for method, path in pattern.findall(markdown):
		routes.add((method, path.split("?", 1)[0]))
	return routes


def _annotation_depends_on_current_user(annotation: Any) -> bool:
	if get_origin(annotation) is not Annotated:
		return False

	for metadata in get_args(annotation)[1:]:
		if isinstance(metadata, Depends) and metadata.dependency is get_current_user:
			return True
	return False


def _route_supports_agent_runtime(route: APIRoute) -> bool:
	if route.path == "/api/health" or route.path.startswith("/api/agent/tokens"):
		return True

	type_hints = get_type_hints(
		route.endpoint,
		globalns=route.endpoint.__globals__,
		include_extras=True,
	)
	return any(
		_annotation_depends_on_current_user(annotation)
		for annotation in type_hints.values()
	)


def _derive_supported_agent_routes() -> set[tuple[str, str]]:
	routes: set[tuple[str, str]] = set()
	for route in app.routes:
		if not isinstance(route, APIRoute) or not route.path.startswith("/api/"):
			continue
		if not _route_supports_agent_runtime(route):
			continue

		for method in route.methods - {"HEAD", "OPTIONS"}:
			routes.add((method, route.path))
	return routes


def test_agent_api_doc_covers_all_supported_agent_routes() -> None:
	documented_routes = _extract_documented_routes(_load_agent_api_doc())
	assert _derive_supported_agent_routes() <= documented_routes


def test_agent_api_doc_uses_reference_style_language() -> None:
	markdown = _load_agent_api_doc()
	for phrase in FORBIDDEN_CASUAL_PHRASES:
		assert phrase not in markdown


def test_agent_api_doc_contains_parameter_tables_and_examples() -> None:
	markdown = _load_agent_api_doc()
	assert "| Header | Required | Applies To | Description |" in markdown
	assert "| Field | Type | Required | Description |" in markdown
	assert "| Endpoint | Parameter | Type | Required | Default | Description |" in markdown
	assert "### Submit A System Feedback Message" in markdown
	assert "### Publish A Changelog-Backed Release Note" in markdown
	assert "X-API-Key" not in markdown
	assert "/api/agent/tokens/issue" not in markdown
