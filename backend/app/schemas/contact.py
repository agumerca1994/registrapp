from pydantic import BaseModel, model_validator


class ContactOut(BaseModel):
    """Un contacto de la agenda del hogar.

    Lleva `contact_name` además de `display_name` a propósito: es el nombre del
    campo viejo, y un bundle del frontend cacheado puede sobrevivir a un deploy.
    Se saca cuando el selector nuevo esté en producción.
    """
    model_config = {"from_attributes": True}

    id: int
    display_name: str
    contact_email: str | None = None
    contact_phone: str | None = None
    contact_user_id: int | None = None
    person_key: str
    use_count: int = 0

    # Compatibilidad con el frontend anterior.
    contact_name: str = ""

    @model_validator(mode="after")
    def _mirror_legacy(self):
        if not self.contact_name:
            self.contact_name = self.display_name
        return self


class ContactCreate(BaseModel):
    display_name: str = ""
    contact_email: str | None = None
    contact_phone: str | None = None

    # El frontend anterior manda `contact_name`.
    contact_name: str | None = None

    @model_validator(mode="after")
    def _accept_legacy(self):
        if not self.display_name and self.contact_name:
            self.display_name = self.contact_name
        return self


class ContactUpdate(BaseModel):
    display_name: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None
