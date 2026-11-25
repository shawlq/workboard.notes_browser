from __future__ import annotations

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app import git_sync as git_sync_mod
from app import notes as notes_mod
from app.config import ROOT, settings

STATIC_DIR = ROOT / "static"

app = FastAPI(title="Notes Browser", version="1.0.0")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


class FileWriteIn(BaseModel):
    path: str = Field(..., min_length=1)
    content: str = Field(default="")


class CreateIn(BaseModel):
    parent: str = Field(default="")
    name: str = Field(..., min_length=1)


class RenameIn(BaseModel):
    path: str = Field(..., min_length=1)
    new_name: str = Field(..., min_length=1)


class MoveIn(BaseModel):
    path: str = Field(..., min_length=1)
    dest_parent: str = Field(default="")


class PathIn(BaseModel):
    path: str = Field(..., min_length=1)


@app.get("/", response_class=HTMLResponse)
async def index() -> HTMLResponse:
    index_path = STATIC_DIR / "index.html"
    return HTMLResponse(index_path.read_text(encoding="utf-8"))


@app.get("/api/config")
async def get_public_config() -> dict:
    return {
        "notes_dir": str(settings.notes_dir),
        "host": settings.host,
        "port": settings.port,
    }


@app.get("/api/tree")
async def get_tree() -> dict:
    return {"tree": notes_mod.build_tree()}


@app.get("/api/file")
async def get_file(path: str) -> dict:
    return notes_mod.read_file(path)


@app.put("/api/file")
async def put_file(body: FileWriteIn) -> dict:
    return notes_mod.write_file(body.path, body.content)


@app.post("/api/mkdir")
async def mkdir(body: CreateIn) -> dict:
    return notes_mod.create_dir(body.parent, body.name)


@app.post("/api/create-file")
async def create_file(body: CreateIn) -> dict:
    return notes_mod.create_file(body.parent, body.name)


@app.post("/api/rename")
async def rename(body: RenameIn) -> dict:
    return notes_mod.rename_entry(body.path, body.new_name)


@app.post("/api/move")
async def move(body: MoveIn) -> dict:
    return notes_mod.move_entry(body.path, body.dest_parent)


@app.post("/api/delete")
async def delete_entry(body: PathIn) -> dict:
    return notes_mod.delete_entry(body.path)


@app.post("/api/upload")
async def upload(
    file: UploadFile = File(...),
    parent: str = Form(default=""),
    overwrite: bool = Form(default=False),
) -> dict:
    content = await file.read()
    filename = file.filename or ""
    return notes_mod.upload_file(parent, filename, content, overwrite=overwrite)


@app.get("/api/preview")
async def preview(path: str) -> FileResponse:
    target = notes_mod.resolve_preview(path)
    return FileResponse(
        path=str(target),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{target.name}"',
        },
    )


@app.get("/api/download")
async def download(path: str) -> FileResponse:
    target = notes_mod.resolve_download(path)
    media_type = (
        "application/pdf" if notes_mod.is_pdf(target) else "application/octet-stream"
    )
    return FileResponse(
        path=str(target),
        filename=target.name,
        media_type=media_type,
    )


@app.post("/api/git/sync")
async def git_sync() -> dict:
    return git_sync_mod.sync_notes()
