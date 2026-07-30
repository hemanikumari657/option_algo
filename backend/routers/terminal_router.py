from fastapi import APIRouter
from fastapi.requests import Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

router = APIRouter(tags=["terminal"])
templates = Jinja2Templates(directory="frontend/templates")


@router.get("/terminal", response_class=HTMLResponse)
async def terminal_page(request: Request):
    return templates.TemplateResponse(
        "terminal.html",
        {"request": request, "show_nav": True}
    )
