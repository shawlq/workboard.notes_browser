from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config.json"


@dataclass
class Settings:
    host: str
    port: int
    notes_dir: Path


def _resolve(path_str: str) -> Path:
    p = Path(path_str).expanduser()
    if not p.is_absolute():
        p = ROOT / p
    return p.resolve()


def load_settings() -> Settings:
    raw = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    notes_dir = _resolve(raw.get("notes_dir", "~/workdir/workboard/notes"))
    if not notes_dir.is_dir():
        raise FileNotFoundError(f"notes_dir does not exist: {notes_dir}")
    return Settings(
        host=str(raw.get("host", "0.0.0.0")),
        port=int(raw.get("port", 8766)),
        notes_dir=notes_dir,
    )


settings = load_settings()
