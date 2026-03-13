from __future__ import annotations

import logging
from typing import Annotated

from fastapi import Depends
from sqlmodel import Session

from app.database import get_session
from app import runtime_state
from app.services.cache import RedisBackedTTLCache, TTLCache
from app.services.market_data import MarketDataClient
from app.settings import get_settings

SessionDependency = Annotated[Session, Depends(get_session)]
settings = get_settings()
market_data_client = MarketDataClient(
	quote_cache=RedisBackedTTLCache(
		runtime_state.redis_client,
		"asset-tracker:runtime:market-quotes",
	),
	search_cache=TTLCache(),
	fx_cache=RedisBackedTTLCache(
		runtime_state.redis_client,
		"asset-tracker:runtime:market-fx",
	),
)
logger = logging.getLogger(__name__)

__all__ = [
	"SessionDependency",
	"logger",
	"market_data_client",
	"settings",
]
