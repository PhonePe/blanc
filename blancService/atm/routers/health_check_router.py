from http import HTTPStatus

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from starlette.responses import Response
from atm.db.database import get_db

health_router = APIRouter(
    tags=['HealthCheck'])


@health_router.get("/healthcheck", status_code=204)
async def health_check(db: Session = Depends(get_db)):
    if not isinstance(db,Session):
        raise HTTPException(status_code=500, detail="Db not up")
    return Response(status_code=HTTPStatus.NO_CONTENT)
