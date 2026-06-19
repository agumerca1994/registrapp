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


settings = Settings()
