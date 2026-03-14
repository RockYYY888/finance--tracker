from __future__ import annotations

import argparse
import json
from dataclasses import asdict

from sqlmodel import Session

from app.database import engine, init_db
from app.services.agent_demo_service import seed_agent_workspace_demo


def main() -> None:
	parser = argparse.ArgumentParser(description="Seed demo data for the agent workspace.")
	parser.add_argument("--user", default="admin", help="User id to seed. Defaults to admin.")
	args = parser.parse_args()

	init_db()
	with Session(engine) as session:
		summary = seed_agent_workspace_demo(session, user_id=args.user)

	print(json.dumps(asdict(summary), ensure_ascii=False, indent=2))


if __name__ == "__main__":
	main()
