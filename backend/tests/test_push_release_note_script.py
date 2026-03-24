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


def test_publish_release_note_uses_session_auth_when_available(monkeypatch) -> None:
	recorded_calls: list[tuple[str, str | None]] = []

	def fake_login(*args, **kwargs) -> None:
		recorded_calls.append(("login", None))

	def fake_json_request(
		*args,
		method: str,
		url: str,
		payload,
		api_token,
		authorization: str | None = None,
	):
		recorded_calls.append((url, authorization))
		return {"id": 1}

	def fail_issue_agent_access_token(*args, **kwargs) -> str:
		raise AssertionError("Bearer fallback should not be used when session auth succeeds.")

	monkeypatch.setattr(push_release, "_login", fake_login)
	monkeypatch.setattr(push_release, "_json_request", fake_json_request)
	monkeypatch.setattr(push_release, "_issue_agent_access_token", fail_issue_agent_access_token)

	result = push_release._publish_release_note_with_admin_auth(
		object(),
		origin="https://example.com",
		admin_user="admin",
		admin_password="secret",
		api_token=None,
		payload={"version": "0.7.1"},
	)

	assert result == {"id": 1}
	assert recorded_calls == [
		("login", None),
		("https://example.com/api/admin/release-notes/publish-changelog", None),
	]


def test_publish_release_note_falls_back_to_bearer_token_after_session_auth_failure(monkeypatch) -> None:
	recorded_calls: list[tuple[str, str | None]] = []

	def fake_login(*args, **kwargs) -> None:
		recorded_calls.append(("login", None))

	def fake_json_request(
		*args,
		method: str,
		url: str,
		payload,
		api_token,
		authorization: str | None = None,
	):
		recorded_calls.append((url, authorization))
		if authorization is None:
			raise RuntimeError('POST https://example.com/api/admin/release-notes/publish-changelog failed: 401 {"detail":"请先登录。"}')
		return {"id": 2}

	def fake_issue_agent_access_token(*args, **kwargs) -> str:
		recorded_calls.append(("issue-token", None))
		return "atrk_test_token"

	monkeypatch.setattr(push_release, "_login", fake_login)
	monkeypatch.setattr(push_release, "_json_request", fake_json_request)
	monkeypatch.setattr(push_release, "_issue_agent_access_token", fake_issue_agent_access_token)

	result = push_release._publish_release_note_with_admin_auth(
		object(),
		origin="https://example.com",
		admin_user="admin",
		admin_password="secret",
		api_token=None,
		payload={"version": "0.7.1"},
	)

	assert result == {"id": 2}
	assert recorded_calls == [
		("login", None),
		("https://example.com/api/admin/release-notes/publish-changelog", None),
		("issue-token", None),
		("https://example.com/api/admin/release-notes/publish-changelog", "Bearer atrk_test_token"),
	]
