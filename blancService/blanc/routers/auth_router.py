import logging
import httpx
import uuid
from datetime import timedelta
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

# DB & Models
from blanc.db_models.models import User
from blanc.db.database import get_db
from blanc.schemas.auth import UserCreate, UserOut

# Auth Core
from blanc.core.auth.auth import (
    pwd_context, 
    create_access_token, 
    ACCESS_TOKEN_EXPIRE_MINUTES, 
    require_roles
)
from blanc.utils import standard_response
from blanc.config_parsers.settings import get_settings
from blanc.services.auth_service import AuthService  # Import the new service

# Setup Logger
logger = logging.getLogger(__name__)

# Load Config
config = get_settings()
auth_router = APIRouter(prefix="/auth", tags=["Auth"])

# =================================================================
# GOOGLE OAUTH FLOW
# =================================================================

@auth_router.get("/google/login")
async def google_login():
    """Step 1: Redirect user to Google Login."""
    params = {
        "client_id": config.google_auth.client_id,
        "redirect_uri": config.google_auth.redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "hd": config.google_auth.allowed_domain, 
        "prompt": "select_account"
    }
    google_auth_url = f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"
    return RedirectResponse(url=google_auth_url)

@auth_router.get("/google/callback")
async def google_callback(code: str, db: Session = Depends(get_db)):
    """Step 2: Handle Google's redirect and issue local JWT."""
    
    # 1. Exchange 'code' for an ID Token
    token_url = "https://oauth2.googleapis.com/token"
    data = {
        "code": code,
        "client_id": config.google_auth.client_id,
        "client_secret": config.google_auth.client_secret,
        "redirect_uri": config.google_auth.redirect_uri,
        "grant_type": "authorization_code",
    }

    async with httpx.AsyncClient(timeout=30.0, trust_env=True) as client:
        resp = await client.post(token_url, data=data)
        token_data = resp.json()

    if "error" in token_data:
        logger.error(f"Google Token Error: {token_data}")
        raise HTTPException(
            status_code=400, 
            detail=f"Token exchange failed: {token_data.get('error_description')}"
        )

    # 2. Verify and Decode the ID Token
    try:
        id_info = id_token.verify_oauth2_token(
            token_data["id_token"], 
            google_requests.Request(), 
            config.google_auth.client_id
        )
    except Exception as e:
        logger.warning(f"Invalid Google Token: {e}")
        raise HTTPException(status_code=401, detail="Invalid Authentication Token")

    email = id_info.get("email")
    email_verified = bool(id_info.get("email_verified"))

    # 3. DOMAIN SECURITY
    # Reject unverified email accounts even when the domain matches —
    # otherwise a Google Workspace member with a still-pending verification
    # (e.g. mid-onboarding) can log in with an unproven identity.
    if not email or not email_verified:
        logger.warning(f"Unverified Google email login attempt: {email}")
        return RedirectResponse(
            url=f"{config.frontend.base_url}/login?error=email_not_verified"
        )

    if not email.endswith(f"@{config.google_auth.allowed_domain}"):
        logger.warning(f"Unauthorized domain login attempt: {email}")
        return RedirectResponse(
            url=f"{config.frontend.base_url}/login?error=unauthorized_domain"
        )

    # 4. JIT Provisioning & User Retrieval (Logic moved to Service)
    user = AuthService.get_or_create_google_user(
        db, 
        email, 
        id_info.get("name", "Employee")
    )

    # 5. Issue your original JWT
    access_token = create_access_token(
        data={"sub": user.email},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )

    # 6. Redirect back to Frontend
    return RedirectResponse(
        url=f"{config.frontend.base_url}/auth-success?token={access_token}"
    )


# =================================================================
# STANDARD AUTH ROUTES
# =================================================================

@auth_router.post("/register")
def register(user_data: UserCreate, db: Session = Depends(get_db)):
    # Check existing
    if db.query(User).filter(User.email == user_data.email).first():
        return standard_response(400, "Email already registered")
    
    # Use Service for Role Logic (Reusability)
    assigned_role = AuthService.get_role_by_email(user_data.email)
    
    new_user = User(
        userId=str(uuid.uuid4()),
        email=user_data.email,
        password=pwd_context.hash(user_data.password),
        name=user_data.name,
        role=assigned_role
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    return standard_response(201, "User registered successfully", UserOut.from_orm(new_user).dict())

@auth_router.post("/login")
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == form_data.username).first()
    
    if not user or not pwd_context.verify(form_data.password, user.password):
        # Don't reveal if it was the user or password that failed
        return standard_response(401, "Invalid credentials")

    # Sync role on login (Optional, but good practice if config changed)
    expected_role = AuthService.get_role_by_email(user.email)
    if user.role != expected_role:
        user.role = expected_role
        db.commit()

    access_token = create_access_token(
        data={"sub": user.email},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    # return {"access_token": access_token, "token_type": "bearer"}

    return standard_response(200, "Login successful", {"access_token": access_token, "token_type": "bearer"})

# ... existing admin/profile routes ...
@auth_router.get("/admin")
def admin_route(current_user: User = Depends(require_roles(["ADMIN"]))):
    return standard_response(200, "Admin access granted", UserOut.from_orm(current_user).dict())

@auth_router.get("/profile")
def profile_route(current_user: User = Depends(require_roles(["USER", "ADMIN"]))):
    return standard_response(200, "Profile fetched successfully", UserOut.from_orm(current_user).dict())