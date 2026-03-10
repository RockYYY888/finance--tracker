from collections.abc import Iterator

import pytest

from app import runtime_state


@pytest.fixture(autouse=True)
def reset_actor_source_context() -> Iterator[None]:
	token = runtime_state.current_actor_source_context.set("USER")
	try:
		yield
	finally:
		runtime_state.current_actor_source_context.reset(token)
