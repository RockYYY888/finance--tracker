from fastapi import APIRouter

from app.schemas import DashboardCorrectionRead, DashboardResponse
from app.services.dashboard_service import (
	create_dashboard_correction,
	delete_dashboard_correction,
	get_dashboard,
	healthcheck,
	list_dashboard_corrections,
)

router = APIRouter()

router.add_api_route("/api/health", healthcheck, methods=["GET"])
router.add_api_route(
	"/api/dashboard/corrections",
	create_dashboard_correction,
	methods=["POST"],
	response_model=DashboardCorrectionRead,
	status_code=201,
)
router.add_api_route(
	"/api/dashboard/corrections",
	list_dashboard_corrections,
	methods=["GET"],
	response_model=list[DashboardCorrectionRead],
)
router.add_api_route(
	"/api/dashboard/corrections/{correction_id}",
	delete_dashboard_correction,
	methods=["DELETE"],
	status_code=204,
)
router.add_api_route("/api/dashboard", get_dashboard, methods=["GET"], response_model=DashboardResponse)
