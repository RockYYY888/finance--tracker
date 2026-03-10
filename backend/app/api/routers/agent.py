from fastapi import APIRouter

from app.schemas import AgentContextRead, AgentTaskRead
from app.services.agent_service import create_agent_task, get_agent_context, list_agent_tasks

router = APIRouter()

router.add_api_route("/api/agent/context", get_agent_context, methods=["GET"], response_model=AgentContextRead)
router.add_api_route("/api/agent/tasks", list_agent_tasks, methods=["GET"], response_model=list[AgentTaskRead])
router.add_api_route(
	"/api/agent/tasks",
	create_agent_task,
	methods=["POST"],
	response_model=AgentTaskRead,
	status_code=201,
)
