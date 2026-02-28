from collections.abc import Generator
from pathlib import Path

from sqlmodel import Session, SQLModel, create_engine

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DATABASE_URL = f"sqlite:///{DATA_DIR / 'asset_tracker.db'}"

engine = create_engine(
	DATABASE_URL,
	connect_args={"check_same_thread": False},
)


def init_db() -> None:
	"""Create database tables on startup."""
	SQLModel.metadata.create_all(engine)


def get_session() -> Generator[Session, None, None]:
	"""Yield a database session for request handlers."""
	with Session(engine) as session:
		yield session
