from pydantic import BaseModel


class DirectoryUserOut(BaseModel):
    """Lo mínimo para elegir a alguien, y nada más.

    Schema propio y no `UserOut` porque ese incluye `tenant_code` — el código
    para unirse a un hogar. Devolverlo acá le daría a cualquiera una forma de
    meterse en el hogar de cualquier usuario que pueda encontrar por nombre.

    Tampoco van mail ni teléfono, ni siquiera enmascarados (`j•••@gmail.com`):
    un enmascarado sigue siendo un oráculo de confirmación, sólo que disfrazado
    de privacidad. Desambiguar entre dos homónimos es el trabajo del alias.
    """
    model_config = {"from_attributes": True}

    id: int
    display_name: str | None
    alias: str | None
    same_household: bool = False


class DirectoryLookupOut(BaseModel):
    """El resultado de buscar a alguien por un dato exacto.

    `found: false` viaja con 200, nunca 404: una diferencia de código de estado
    *es* el oráculo que se quiere evitar, y además así el picker resuelve en un
    solo viaje si mostrar "ya usa RegistrApp" o "se le va a enviar una
    invitación".
    """
    found: bool
    user: DirectoryUserOut | None = None
