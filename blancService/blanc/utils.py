from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

def standard_response(status_code: int, message: str, data=None):
    payload = {
        "status": status_code,
        "message": message,
        "data": data
    }
    return JSONResponse(
        status_code=status_code,
        content=jsonable_encoder(payload)
    )