from __future__ import annotations

"""Compatibility shim for portfolio domain services.

This module preserves the historical import surface while the implementation
is split across smaller domain-focused modules.
"""

from app.services import (
	asset_entry_service as _asset_entry_service,
	cash_account_service as _cash_account_service,
	holding_projection_service as _holding_projection_service,
	holding_transaction_service as _holding_transaction_service,
	portfolio_read_service as _portfolio_read_service,
)


def _reexport(module: object) -> None:
	for name, value in vars(module).items():
		if name.startswith("__"):
			continue
		globals()[name] = value


for _module in (
	_portfolio_read_service,
	_holding_projection_service,
	_cash_account_service,
	_asset_entry_service,
	_holding_transaction_service,
):
	_reexport(_module)


del _module

__all__ = [name for name in globals() if not name.startswith("__")]
