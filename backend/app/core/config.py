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
    API_DOMAIN: str = ""
    FRONTEND_URL: str = "http://localhost:3000"
    INTERNAL_LOG_KEY: str = ""

    # --- MCP connector ---------------------------------------------------
    MCP_ENABLED: bool = True
    # Local-only escape hatch to poke at /mcp without minting a token. Forced
    # off in production by the validator below — never trust the env var alone.
    MCP_AUTH_DISABLED: bool = False
    # Both derived from API_DOMAIN when empty. The resource URL is the RFC 8707
    # audience every token is bound to, so it must match exactly what clients
    # send as `resource`.
    OAUTH_ISSUER_URL: str = ""
    MCP_RESOURCE_URL: str = ""
    MCP_ACCESS_TOKEN_TTL_SECONDS: int = 3600
    MCP_REFRESH_TOKEN_TTL_DAYS: int = 30
    MCP_DCR_ENABLED: bool = True
    # Extra Host:/Origin: values accepted by the transport's anti-DNS-rebinding
    # check, comma-separated. The API domain and localhost are always included.
    # These exist as env vars so a client rejected with 421/403 in production can
    # be allowed without a code change.
    MCP_ALLOWED_HOSTS: str = ""
    MCP_ALLOWED_ORIGINS: str = ""

    @model_validator(mode="after")
    def derive_urls(self) -> "Settings":
        if self.APP_DOMAIN and self.FRONTEND_URL == "http://localhost:3000":
            self.FRONTEND_URL = f"https://{self.APP_DOMAIN}"

        if not self.OAUTH_ISSUER_URL:
            self.OAUTH_ISSUER_URL = (
                f"https://{self.API_DOMAIN}" if self.API_DOMAIN else "http://localhost:8000"
            )
        self.OAUTH_ISSUER_URL = self.OAUTH_ISSUER_URL.rstrip("/")

        if not self.MCP_RESOURCE_URL:
            self.MCP_RESOURCE_URL = f"{self.OAUTH_ISSUER_URL}/mcp"
        self.MCP_RESOURCE_URL = self.MCP_RESOURCE_URL.rstrip("/")

        if self.ENVIRONMENT == "production":
            self.MCP_AUTH_DISABLED = False
        return self

    @property
    def mcp_allowed_hosts(self) -> list[str]:
        hosts = ["localhost", "localhost:*", "127.0.0.1", "127.0.0.1:*", "[::1]", "[::1]:*"]
        if self.API_DOMAIN:
            hosts += [self.API_DOMAIN, f"{self.API_DOMAIN}:*"]
        hosts += [h.strip() for h in self.MCP_ALLOWED_HOSTS.split(",") if h.strip()]
        return hosts

    @property
    def mcp_allowed_origins(self) -> list[str]:
        """Origins the MCP transport accepts.

        Only exact values and `host:*` port wildcards are matched (the SDK does
        no subdomain globbing), and a missing Origin — every non-browser client —
        always passes. A rejected origin surfaces as a 403 on /mcp; add it to
        MCP_ALLOWED_ORIGINS rather than loosening this list.
        """
        origins = [
            "https://claude.ai",
            "https://claude.com",
            "http://localhost:*",
            "http://127.0.0.1:*",
        ]
        if self.FRONTEND_URL:
            origins.append(self.FRONTEND_URL.rstrip("/"))
        origins += [o.strip() for o in self.MCP_ALLOWED_ORIGINS.split(",") if o.strip()]
        return origins

    @property
    def mcp_resource_metadata_url(self) -> str:
        """Where clients discover which authorization server protects /mcp."""
        return f"{self.OAUTH_ISSUER_URL}/.well-known/oauth-protected-resource/mcp"


settings = Settings()

