import uuid
import logging
from sqlalchemy.orm import Session
from blanc.db_models.models import User
from blanc.core.auth.auth import pwd_context
from blanc.config_parsers.settings import get_settings

logger = logging.getLogger(__name__)

class AuthService:
    @staticmethod
    def get_role_by_email(email: str) -> str:
        """
        Determines the role based on the configuration whitelist.
        Centralizes the logic so it's not scattered in routers.
        """
        config = get_settings()
        return "ADMIN" if email in config.admin_users else "USER"

    @staticmethod
    def get_or_create_google_user(db: Session, email: str, name: str) -> User:
        """
        Handles JIT provisioning:
        1. Creates user if not exists.
        2. UPDATES role if the config has changed (e.g. user promoted to admin).
        """
        user = db.query(User).filter(User.email == email).first()
        target_role = AuthService.get_role_by_email(email)

        if not user:
            logger.info(f"JIT Provisioning new user: {email} as {target_role}")
            user = User(
                userId=str(uuid.uuid4()),
                email=email,
                name=name,
                role=target_role,
                # Random password for OAuth users so account can't be hijacked via password login
                password=pwd_context.hash(str(uuid.uuid4()))
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        else:
            # Sync Role: If config says ADMIN but DB says USER, update DB.
            if user.role != target_role:
                logger.info(f"Syncing role for {email}: {user.role} -> {target_role}")
                user.role = target_role
                db.commit()
                db.refresh(user)
        
        return user