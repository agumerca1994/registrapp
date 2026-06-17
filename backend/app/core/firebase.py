import firebase_admin
from firebase_admin import credentials, auth
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.core.config import settings

_bearer = HTTPBearer()

def _init_firebase():
    if not firebase_admin._apps:
        cred = credentials.Certificate(settings.FIREBASE_CREDENTIALS_PATH)
        firebase_admin.initialize_app(cred)

_init_firebase()


async def get_current_user(
    token: HTTPAuthorizationCredentials = Depends(_bearer),
) -> dict:
    try:
        decoded = auth.verify_id_token(token.credentials)
        return decoded
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token Firebase inválido o expirado",
        )
