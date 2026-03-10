from __future__ import annotations

"""Compatibility shim for dashboard domain services."""

from app.services import (
	dashboard_correction_service as _dashboard_correction_service,
	dashboard_live_service as _dashboard_live_service,
	dashboard_query_service as _dashboard_query_service,
)


def _reexport(module: object) -> None:
	for name, value in vars(module).items():
		if name.startswith("__"):
			continue
		globals()[name] = value


for _module in (
	_dashboard_live_service,
	_dashboard_correction_service,
	_dashboard_query_service,
):
	_reexport(_module)


del _module

__all__ = [name for name in globals() if not name.startswith("__")]
