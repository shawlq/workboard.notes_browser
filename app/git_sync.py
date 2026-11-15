from __future__ import annotations

import subprocess
from pathlib import Path

from app.config import settings


def _run(cmd: list[str], cwd: Path) -> dict:
    proc = subprocess.run(
        cmd,
        cwd=str(cwd),
        capture_output=True,
        text=True,
        timeout=120,
    )
    return {
        "cmd": " ".join(cmd),
        "returncode": proc.returncode,
        "stdout": (proc.stdout or "").strip(),
        "stderr": (proc.stderr or "").strip(),
    }


def _is_nothing_to_commit(step: dict) -> bool:
    text = f"{step.get('stdout', '')}\n{step.get('stderr', '')}".lower()
    return (
        "nothing to commit" in text
        or "no changes added to commit" in text
        or "nothing added to commit" in text
    )


def sync_notes() -> dict:
    cwd = settings.notes_dir
    if not (cwd / ".git").exists():
        return {
            "ok": False,
            "steps": [],
            "message": f"not a git repository: {cwd}",
        }

    steps: list[dict] = []
    commands = [
        ["git", "pull"],
        ["git", "add", "."],
        ["git", "commit", "-m", "update"],
        ["git", "push"],
    ]

    for cmd in commands:
        try:
            step = _run(cmd, cwd)
        except subprocess.TimeoutExpired:
            step = {
                "cmd": " ".join(cmd),
                "returncode": -1,
                "stdout": "",
                "stderr": "command timed out after 120s",
            }
            steps.append(step)
            return {
                "ok": False,
                "steps": steps,
                "message": f"timeout: {step['cmd']}",
            }

        if cmd[:2] == ["git", "commit"] and step["returncode"] != 0 and _is_nothing_to_commit(step):
            step["skipped"] = True
            step["note"] = "nothing to commit"
            steps.append(step)
            continue

        steps.append(step)
        if step["returncode"] != 0:
            err = step["stderr"] or step["stdout"] or f"exit {step['returncode']}"
            return {
                "ok": False,
                "steps": steps,
                "message": f"failed at `{step['cmd']}`: {err}",
            }

    return {
        "ok": True,
        "steps": steps,
        "message": "git sync completed",
    }
