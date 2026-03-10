from fastapi import APIRouter

from app.api.routers import (
	accounts,
	agent,
	auth,
	cash_transfers,
	dashboard,
	feedback,
	holding_transactions,
	holdings,
	release_notes,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(feedback.router)
api_router.include_router(release_notes.router)
api_router.include_router(accounts.router)
api_router.include_router(cash_transfers.router)
api_router.include_router(holdings.router)
api_router.include_router(holding_transactions.router)
api_router.include_router(dashboard.router)
api_router.include_router(agent.router)
