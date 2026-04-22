from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Quizzy API"
    env: str = "dev"
    database_url: str = "postgresql+psycopg://quizzy:quizzy@db:5432/quizzy"
    jwt_secret: str = "change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480
    frontend_origin: str = "http://localhost:3000"
    join_rate_limit_window_sec: int = 60
    join_rate_limit_max: int = 120
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-2.5-flash"
    gemini_timeout_sec: int = 25

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
