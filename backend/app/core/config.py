from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str
    FIREBASE_PROJECT_ID: str
    FIREBASE_CREDENTIALS_PATH: str = "/app/firebase-credentials.json"
    ESTADISTICAS_BCRA_TOKEN: str = ""
    ENVIRONMENT: str = "development"
    EVOLUTION_API_URL: str = ""
    EVOLUTION_API_KEY: str = ""
    EVOLUTION_INSTANCE: str = ""
    WHATSAPP_WEBHOOK_SECRET: str = ""
    APP_DOMAIN: str = ""
    FRONTEND_URL: str = "http://localhost:3000"
    INTERNAL_LOG_KEY: str = ""

    @model_validator(mode="after")
    def derive_frontend_url(self) -> "Settings":
        if self.APP_DOMAIN and self.FRONTEND_URL == "http://localhost:3000":
            self.FRONTEND_URL = f"https://{self.APP_DOMAIN}"
        return self


settings = Settings()

