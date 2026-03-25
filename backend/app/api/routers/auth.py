from fastapi import APIRouter

from app.schemas import ActionMessageRead, AuthSessionRead
from app.services.auth_service import (
	get_auth_session,
	update_user_email,
)
from app.services.agent_service import (
	create_agent_token_for_current_session,
	list_agent_tokens,
	revoke_agent_token,
)
from app.schemas import AgentTokenIssueRead, AgentTokenRead

router = APIRouter()

router.add_api_route("/api/auth/session", get_auth_session, methods=["GET"], response_model=AuthSessionRead)
router.add_api_route(
	"/api/auth/email",
	update_user_email,
	methods=["PATCH"],
	response_model=AuthSessionRead,
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
