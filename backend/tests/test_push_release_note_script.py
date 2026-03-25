from __future__ import annotations

import importlib.util
from pathlib import Path
import sys


SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))
SCRIPT_PATH = SCRIPTS_DIR / "push_release_note_from_changelog.py"
SPEC = importlib.util.spec_from_file_location("push_release_note_from_changelog", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
push_release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(push_release)


def test_publish_release_note_uses_admin_api_key(monkeypatch) -> None:
	recorded_calls: list[tuple[str, str | None]] = []

	def fake_json_request(
		*args,
		method: str,
		url: str,
		payload,
		authorization: str | None = None,
	):
		recorded_calls.append((url, authorization))
		return {"id": 1}

	monkeypatch.setattr(push_release, "_json_request", fake_json_request)

	result = push_release._publish_release_note_with_admin_api_key(
		object(),
		origin="https://example.com",
		admin_api_key="atrk_admin_key",
		payload={"version": "0.7.1"},
	)

	assert result == {"id": 1}
	assert recorded_calls == [
		(
			"https://example.com/api/admin/release-notes/publish-changelog",
			"Bearer atrk_admin_key",
		),
	]
