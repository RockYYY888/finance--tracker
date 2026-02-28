from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
	"""Runtime configuration for local-only development and hardened deployments."""

	model_config = SettingsConfigDict(
		env_file=".env",
		env_prefix="ASSET_TRACKER_",
		extra="ignore",
	)

	api_token: str | None = None
	allowed_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
	allowed_hosts: str = "localhost,127.0.0.1"

	def cors_origins(self) -> list[str]:
		return [item.strip() for item in self.allowed_origins.split(",") if item.strip()]

	def trusted_hosts(self) -> list[str]:
		return [item.strip() for item in self.allowed_hosts.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
	return Settings()
