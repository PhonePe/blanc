"""
JWT + role-check helpers.

Hardening applied here (see security review):

* **Startup guard** — refuse to import if ``jwt_config.secret_key`` is a
  placeholder, blank, or shorter than 32 chars. Blocks the "forgot to set
  the secret" foot-gun before the app can serve requests.
* **Fixed claims** — every token now carries ``iss``, ``aud``, ``jti``,
  ``iat`` alongside ``exp``. ``get_current_user`` verifies ``iss`` and
  ``aud`` so tokens signed for a different environment cannot be
  replayed here.
* **Shorter default lifetime** — capped at 60 minutes when the config
  value is absent or absurdly large.
* Uses timezone-aware UTC (``datetime.now(timezone.utc)``) instead of
  the deprecated ``datetime.utcnow()``.
"""
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from atm.config_parsers.settings import get_settings
from atm.db.database import get_db
from atm.db_models.models import User

config = get_settings()

SECRET_KEY = config.jwt_config.secret_key
ALGORITHM = config.jwt_config.algorithm

# Hard-cap the configured lifetime so a misconfigured value can't hand
# out year-long tokens.
_configured_lifetime = int(config.jwt_config.access_token_expire_minutes or 60)
ACCESS_TOKEN_EXPIRE_MINUTES = min(max(_configured_lifetime, 5), 60)

# Issuer and audience are checked on verification so tokens minted for
# a different deployment / audience cannot be replayed here.
JWT_ISSUER = "blanc"
JWT_AUDIENCE = "blanc-web"

# --- Startup guard ---------------------------------------------------------
# Refuse to import at all when the secret is obviously unsafe. This is a
# module-level check so `python main.py` fails fast rather than at first
# request. Docker path also enforces this via entrypoint.sh, but native
# runs used to accept the placeholder silently.
if (
    not SECRET_KEY
    or SECRET_KEY.startswith("CHANGE_ME")
    or len(SECRET_KEY) < 32
):
    raise RuntimeError(
        "jwt_config.secret_key is missing, placeholder, or shorter than 32 chars. "
        "Generate one with:\n"
        "  python3 -c 'import secrets; print(secrets.token_urlsafe(48))'"
    )


pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def create_access_token(
    data: dict, expires_delta: Optional[timedelta] = None
) -> str:
    to_encode = data.copy()
    now = datetime.now(timezone.utc)
    expire = now + (
        expires_delta
        if expires_delta
        else timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update(
        {
            "iat": now,
            "exp": expire,
            "iss": JWT_ISSUER,
            "aud": JWT_AUDIENCE,
            "jti": str(uuid.uuid4()),
        }
    )
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> User:
    credentials_exception = HTTPException(
        status_code=401, detail="Could not validate credentials"
    )
    try:
        payload = jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[ALGORITHM],
            audience=JWT_AUDIENCE,
            issuer=JWT_ISSUER,
        )
        email = payload.get("sub")
        if not email:
            raise credentials_exception
    except jwt.PyJWTError:
        raise credentials_exception

    user = db.query(User).filter(User.email == email).first()
    if user is None:
        raise credentials_exception
    return user


def require_roles(allowed_roles: List[str]):
    def role_checker(current_user: User = Depends(get_current_user)) -> User:
        if not current_user.role:
            raise HTTPException(status_code=403, detail="User has no assigned role")

        user_role = (
            current_user.role.value
            if hasattr(current_user.role, "value")
            else current_user.role
        )
        if user_role not in allowed_roles:
            raise HTTPException(
                status_code=403,
                detail="You do not have access to this resource",
            )
        return current_user

    return role_checker


def _role_value(user: User) -> str:
    return user.role.value if hasattr(user.role, "value") else user.role


def require_assessment_owner(
    assessment_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """FastAPI dependency: resolve the assessment for ``assessment_id`` and
    verify the caller is either its owner or an ADMIN.

    Closes the cross-tenant IDOR on every ``/assessment/{id}/…`` route.
    Use it INSTEAD of ``get_current_user`` on routes that operate on a
    specific assessment — you get the row for free.
    """
    # Local import to avoid a top-level cycle: this module is imported
    # early during app startup, while ORM models pull in dependencies
    # that themselves import auth. Keeping the import lazy is the
    # cheapest fix.
    from atm.db_models.models import Assessment

    assessment = (
        db.query(Assessment).filter_by(assessment_id=assessment_id).first()
    )
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")

    if _role_value(current_user) == "ADMIN":
        return assessment

    if assessment.user_id != current_user.userId:
        raise HTTPException(
            status_code=403,
            detail="You do not have access to this assessment",
        )
    return assessment
