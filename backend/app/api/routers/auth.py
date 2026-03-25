from fastapi import APIRouter

from app.schemas import ActionMessageRead, AgentTokenIssueRead, AgentTokenRead, AuthSessionRead
from app.services.auth_service import (
	get_auth_session,
	login_user,
	logout_user,
	register_user,
	reset_password_with_email,
	update_user_email,
)
from app.services.agent_service import (
	create_agent_token_for_current_session,
	issue_agent_token_with_password,
	list_agent_tokens,
	revoke_agent_token,
)

router = APIRouter()

router.add_api_route("/api/auth/session", get_auth_session, methods=["GET"], response_model=AuthSessionRead)
router.add_api_route(
	"/api/auth/register",
	register_user,
	methods=["POST"],
	response_model=AuthSessionRead,
	status_code=201,
)
router.add_api_route("/api/auth/login", login_user, methods=["POST"], response_model=AuthSessionRead)
router.add_api_route(
	"/api/auth/reset-password",
	reset_password_with_email,
	methods=["POST"],
	response_model=ActionMessageRead,
)
router.add_api_route(
	"/api/auth/email",
	update_user_email,
	methods=["PATCH"],
	response_model=AuthSessionRead,
)
router.add_api_route("/api/auth/logout", logout_user, methods=["POST"], status_code=204)
router.add_api_route(
	"/api/agent/tokens/issue",
	issue_agent_token_with_password,
	methods=["POST"],
	response_model=AgentTokenIssueRead,
	status_code=201,
)
router.add_api_route(
	"/api/agent/tokens",
	create_agent_token_for_current_session,
	methods=["POST"],
	response_model=AgentTokenIssueRead,
	status_code=201,
)
router.add_api_route(
	"/api/agent/tokens",
	list_agent_tokens,
	methods=["GET"],
	response_model=list[AgentTokenRead],
)
router.add_api_route(
	"/api/agent/tokens/{token_id}",
	revoke_agent_token,
	methods=["DELETE"],
	response_model=ActionMessageRead,
)
