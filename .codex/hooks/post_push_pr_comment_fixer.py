#!/usr/bin/env python3
"""Codex PostToolUse hook for post-push PR feedback fixes."""

from __future__ import annotations

import datetime as dt
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Optional

GIT_PUSH_RE = re.compile(r"(^|[;&|()\s])git(\s+-C\s+(?:'[^']*'|\"[^\"]*\"|\S+))*\s+(?:-[^\s]+\s+)*push(\s|$)")


def main() -> int:
    if len(sys.argv) > 1 and sys.argv[1] == "--run-worker":
        return run_worker(Path(sys.argv[2]), sys.argv[3])

    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0

    if payload.get("hook_event_name") != "PostToolUse":
        return 0
    if payload.get("tool_name") != "Bash":
        return 0

    command = tool_command(payload)
    if not is_successful_git_push(command, payload.get("tool_response")):
        return 0

    repo_root = find_repo_root(payload.get("cwd") or os.getcwd())
    if repo_root is None:
        return 0

    worker_id = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    launch_worker(repo_root, worker_id)
    return 0


def tool_command(payload: dict[str, Any]) -> str:
    tool_input = payload.get("tool_input")
    if not isinstance(tool_input, dict):
        return ""
    command = tool_input.get("command") or tool_input.get("cmd")
    return command if isinstance(command, str) else ""


def is_successful_git_push(command: str, response: Any) -> bool:
    if not command or "--dry-run" in command:
        return False
    if not GIT_PUSH_RE.search(command):
        return False
    if not isinstance(response, dict):
        return True
    if response.get("success") is False:
        return False
    if response.get("error"):
        return False

    for key in ("exit_code", "exitCode", "status_code", "statusCode", "returncode", "code"):
        value = response.get(key)
        if isinstance(value, int) and value != 0:
            return False
        if isinstance(value, str) and value.isdigit() and int(value) != 0:
            return False

    status = response.get("status")
    if isinstance(status, str) and status.lower() in {"failed", "error", "nonzero", "cancelled"}:
        return False
    return True


def find_repo_root(cwd: str) -> Optional[Path]:
    try:
        result = subprocess.run(
            ["git", "-C", cwd, "rev-parse", "--show-toplevel"],
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    return Path(result.stdout.strip())


def launch_worker(repo_root: Path, worker_id: str) -> None:
    log_dir = repo_root / ".codex" / "hooks" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"post-push-pr-comment-fixer-{worker_id}.log"

    env = os.environ.copy()
    env["CODEX_POST_PUSH_WORKER_ID"] = worker_id
    with log_path.open("ab", buffering=0) as log:
        subprocess.Popen(
            [sys.executable, str(Path(__file__).resolve()), "--run-worker", str(repo_root), worker_id],
            cwd=str(repo_root),
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=log,
            start_new_session=True,
            env=env,
        )


def run_worker(repo_root: Path, worker_id: str) -> int:
    log(f"worker {worker_id} scheduled for {repo_root}")
    delay_secs = int(os.environ.get("CODEX_POST_PUSH_DELAY_SECS", "300"))
    time.sleep(max(delay_secs, 0))

    state_dir = repo_root / ".codex" / "hooks" / "state"
    state_dir.mkdir(parents=True, exist_ok=True)
    lock_path = state_dir / "post-push-pr-comment-fixer.lock"

    with lock_path.open("w") as lock_file:
        if not try_lock(lock_file):
            log("another post-push fixer is already running; exiting")
            return 0

        codex_bin = os.environ.get("CODEX_BIN") or shutil.which("codex")
        if not codex_bin:
            log("codex CLI not found on PATH")
            return 0

        prompt = build_prompt(repo_root)
        args = codex_args(codex_bin, repo_root, prompt)
        log("running: " + shlex.join(redact_args(args)))
        completed = subprocess.run(args, cwd=str(repo_root), text=True)
        log(f"codex exited with status {completed.returncode}")
        return completed.returncode


def try_lock(lock_file: Any) -> bool:
    try:
        import fcntl

        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except (ImportError, OSError):
        return False


def codex_args(codex_bin: str, repo_root: Path, prompt: str) -> list[str]:
    extra_args = os.environ.get("CODEX_POST_PUSH_CODEX_ARGS")
    if extra_args:
        return [codex_bin, *shlex.split(extra_args), prompt]

    return [
        codex_bin,
        "exec",
        "--cd",
        str(repo_root),
        "--ask-for-approval",
        "never",
        "--sandbox",
        "workspace-write",
        prompt,
    ]


def redact_args(args: list[str]) -> list[str]:
    if len(args) <= 2:
        return args
    return [*args[:-1], "<prompt>"]


def build_prompt(repo_root: Path) -> str:
    return f"""You are running from ToolRouter's Codex post-push PR feedback hook.

This hook fired five minutes after a successful `git push`.
Repo root: {repo_root}

Task:
1. Identify the open GitHub PR for the current checkout. If the checkout is detached, use `gh` and git metadata to find the PR associated with the current commit or remote head before giving up.
2. Review unresolved PR review comments, review threads, and requested changes that still apply to the pushed branch.
3. For each item, decide if it is a valid critique. If valid, apply a focused fix. If not valid, leave it alone.
4. Run relevant quick checks for the touched files.
5. If you changed files, stage only the files changed for these fixes, create a new commit with a clear message such as `address PR review feedback`, and push the PR branch.
6. If there is no open PR, no actionable feedback, or no changed files after review, exit without committing or pushing.

Constraints:
- Do not amend existing commits.
- Do not force-push.
- Do not change the PR title or description.
- Do not reply to review comments unless the user explicitly asked for that.
- Do not touch unrelated work.
"""


def log(message: str) -> None:
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"[{now}] {message}", flush=True)


if __name__ == "__main__":
    raise SystemExit(main())
