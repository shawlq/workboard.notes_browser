from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

from fastapi import HTTPException

from app.config import settings

SKIP_NAMES = {".git", ".venv", "__pycache__", ".DS_Store"}
PDF_EXTENSION = ".pdf"
MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50MB
TEXT_EXTENSIONS = {
    ".md",
    ".txt",
    ".json",
    ".yml",
    ".yaml",
    ".toml",
    ".ini",
    ".cfg",
    ".conf",
    ".sh",
    ".py",
    ".js",
    ".ts",
    ".css",
    ".html",
    ".xml",
    ".csv",
    ".log",
    ".gitignore",
    ".env",
    ".rst",
}


def _norm_rel(rel: str) -> str:
    if rel is None or rel != rel.strip():
        raise HTTPException(status_code=400, detail="invalid path")
    rel = rel.replace("\\", "/").strip().lstrip("/")
    if not rel or rel == "." or ".." in Path(rel).parts:
        raise HTTPException(status_code=400, detail="invalid path")
    return rel


def resolve_under_notes(rel: str) -> Path:
    rel = _norm_rel(rel)
    root = settings.notes_dir.resolve()
    target = (root / rel).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="path escapes notes_dir") from exc
    return target


def validate_entry_name(name: str) -> str:
    name = (name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    if name in {".", ".."} or "/" in name or "\\" in name or "\0" in name:
        raise HTTPException(status_code=400, detail="invalid name")
    if name.startswith("."):
        raise HTTPException(status_code=400, detail="hidden names are not allowed")
    return name


def join_rel(parent: str, name: str) -> str:
    name = validate_entry_name(name)
    parent = (parent or "").replace("\\", "/").strip().strip("/")
    if not parent:
        return name
    return f"{_norm_rel(parent)}/{name}"


def parent_rel(rel: str) -> str:
    rel = _norm_rel(rel)
    parent = str(Path(rel).parent).replace("\\", "/")
    return "" if parent == "." else parent


def is_markdown(path: Path) -> bool:
    return path.suffix.lower() == ".md"


def is_pdf(path: Path) -> bool:
    return path.suffix.lower() == PDF_EXTENSION


def is_probably_text(path: Path) -> bool:
    name = path.name
    if name in {".gitignore", ".env", ".bashrc", ".profile"}:
        return True
    if path.suffix.lower() in TEXT_EXTENSIONS:
        return True
    if path.suffix == "":
        return True
    return False


def is_allowed_file(path: Path) -> bool:
    return is_probably_text(path) or is_pdf(path)


def build_tree(base: Path | None = None, rel: str = "") -> list[dict]:
    base = base or settings.notes_dir
    entries: list[dict] = []
    try:
        children = sorted(base.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
    except PermissionError:
        return entries

    for child in children:
        if child.name in SKIP_NAMES or child.name.startswith("."):
            continue
        child_rel = f"{rel}/{child.name}".lstrip("/") if rel else child.name
        if child.is_dir():
            entries.append(
                {
                    "name": child.name,
                    "path": child_rel,
                    "type": "dir",
                    "children": build_tree(child, child_rel),
                }
            )
        elif child.is_file():
            entry: dict = {
                "name": child.name,
                "path": child_rel,
                "type": "file",
            }
            if is_pdf(child):
                entry["is_pdf"] = True
            entries.append(entry)
    return entries


def read_file(rel: str) -> dict:
    path = resolve_under_notes(rel)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    if is_pdf(path):
        return {
            "path": rel,
            "is_markdown": False,
            "is_pdf": True,
        }
    if not is_probably_text(path):
        raise HTTPException(status_code=415, detail="binary or unsupported file type")
    try:
        content = path.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=415, detail="file is not valid UTF-8 text") from exc
    return {
        "path": rel,
        "content": content,
        "is_markdown": is_markdown(path),
        "is_pdf": False,
    }


def write_file(rel: str, content: str) -> dict:
    path = resolve_under_notes(rel)
    if path.exists() and not path.is_file():
        raise HTTPException(status_code=400, detail="path is not a file")
    if not is_probably_text(path):
        raise HTTPException(status_code=415, detail="binary or unsupported file type")
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent)
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as tmp:
            tmp.write(content)
            tmp.flush()
            os.fsync(tmp.fileno())
        os.replace(tmp_name, path)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise
    return {"ok": True, "path": rel}


def create_dir(parent: str, name: str) -> dict:
    rel = join_rel(parent, name)
    path = resolve_under_notes(rel)
    if path.exists():
        raise HTTPException(status_code=409, detail="already exists")
    path.mkdir(parents=False, exist_ok=False)
    return {"ok": True, "path": rel, "type": "dir"}


def create_file(parent: str, name: str, content: str = "") -> dict:
    name = validate_entry_name(name)
    if Path(name).suffix == "":
        name = f"{name}.md"
    rel = join_rel(parent, name)
    path = resolve_under_notes(rel)
    if path.exists():
        raise HTTPException(status_code=409, detail="already exists")
    if not is_probably_text(path):
        raise HTTPException(status_code=415, detail="unsupported file type")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return {"ok": True, "path": rel, "type": "file"}


def delete_entry(rel: str) -> dict:
    path = resolve_under_notes(rel)
    root = settings.notes_dir.resolve()
    if path == root:
        raise HTTPException(status_code=400, detail="cannot delete notes_dir root")
    if not path.exists():
        raise HTTPException(status_code=404, detail="not found")
    if path.is_dir():
        shutil.rmtree(path)
        kind = "dir"
    elif path.is_file():
        path.unlink()
        kind = "file"
    else:
        raise HTTPException(status_code=400, detail="unsupported entry type")
    return {"ok": True, "path": rel, "type": kind}


def rename_entry(rel: str, new_name: str) -> dict:
    path = resolve_under_notes(rel)
    if not path.exists():
        raise HTTPException(status_code=404, detail="not found")
    new_name = validate_entry_name(new_name)
    dest = path.with_name(new_name)
    root = settings.notes_dir.resolve()
    try:
        dest.resolve().relative_to(root)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="path escapes notes_dir") from exc
    if dest.exists():
        raise HTTPException(status_code=409, detail="target already exists")
    path.rename(dest)
    new_rel = join_rel(parent_rel(rel), new_name)
    kind = "dir" if dest.is_dir() else "file"
    return {"ok": True, "path": new_rel, "from": rel, "type": kind}


def resolve_parent_dir(parent: str) -> Path:
    parent = (parent or "").replace("\\", "/").strip().strip("/")
    if not parent:
        return settings.notes_dir.resolve()
    dest = resolve_under_notes(parent)
    if not dest.is_dir():
        raise HTTPException(status_code=400, detail="destination is not a directory")
    return dest


def move_entry(rel: str, dest_parent: str) -> dict:
    path = resolve_under_notes(rel)
    root = settings.notes_dir.resolve()
    if path == root:
        raise HTTPException(status_code=400, detail="cannot move notes_dir root")
    if not path.exists():
        raise HTTPException(status_code=404, detail="not found")

    dest_parent_norm = (dest_parent or "").replace("\\", "/").strip().strip("/")
    if dest_parent_norm and ".." in Path(dest_parent_norm).parts:
        raise HTTPException(status_code=400, detail="invalid path")
    src_parent = parent_rel(rel)
    if src_parent == dest_parent_norm:
        kind = "dir" if path.is_dir() else "file"
        return {"ok": True, "path": rel, "from": rel, "type": kind, "unchanged": True}

    dest_dir = resolve_parent_dir(dest_parent_norm)
    if path.is_dir():
        try:
            dest_dir.relative_to(path.resolve())
            raise HTTPException(
                status_code=400, detail="cannot move into itself or a descendant"
            )
        except ValueError:
            pass

    new_rel = join_rel(dest_parent_norm, path.name)
    dest = resolve_under_notes(new_rel)
    if dest.exists():
        raise HTTPException(status_code=409, detail="target already exists")
    path.rename(dest)
    kind = "dir" if dest.is_dir() else "file"
    return {"ok": True, "path": new_rel, "from": rel, "type": kind}


def _atomic_write_bytes(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent)
    )
    try:
        with os.fdopen(fd, "wb") as tmp:
            tmp.write(content)
            tmp.flush()
            os.fsync(tmp.fileno())
        os.replace(tmp_name, path)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def upload_file(parent: str, filename: str, content: bytes, overwrite: bool = False) -> dict:
    name = validate_entry_name(filename)
    rel = join_rel(parent, name)
    path = resolve_under_notes(rel)
    if path.exists():
        if not path.is_file():
            raise HTTPException(status_code=400, detail="path is not a file")
        if not overwrite:
            raise HTTPException(status_code=409, detail="already exists")
    if not is_allowed_file(path):
        raise HTTPException(status_code=415, detail="unsupported file type")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"file too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)}MB)",
        )
    if is_pdf(path):
        _atomic_write_bytes(path, content)
        return {"ok": True, "path": rel, "type": "file", "is_pdf": True}
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=415, detail="file is not valid UTF-8 text") from exc
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent)
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as tmp:
            tmp.write(text)
            tmp.flush()
            os.fsync(tmp.fileno())
        os.replace(tmp_name, path)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise
    return {"ok": True, "path": rel, "type": "file", "is_pdf": False}


def resolve_download(rel: str) -> Path:
    path = resolve_under_notes(rel)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    return path


def resolve_preview(rel: str) -> Path:
    path = resolve_under_notes(rel)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    if not is_pdf(path):
        raise HTTPException(status_code=415, detail="preview only supports PDF")
    return path
