from __future__ import annotations

"""Compatibility shim for feedback domain services."""

from app.services import (
	feedback_admin_service as _feedback_admin_service,
	feedback_model_service as _feedback_model_service,
	feedback_user_service as _feedback_user_service,
)


def _reexport(module: object) -> None:
	for name, value in vars(module).items():
		if name.startswith("__"):
			continue
		globals()[name] = value


for _module in (
	_feedback_model_service,
	_feedback_user_service,
	_feedback_admin_service,
):
	_reexport(_module)


del _module

__all__ = [name for name in globals() if not name.startswith("__")]
