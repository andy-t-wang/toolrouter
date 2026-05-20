#!/usr/bin/env bash
# PostToolUse hook: when `gh pr create` runs, spawn a detached watcher that
# polls the PR for new review comments every 5 minutes and dispatches a
# headless `claude -p` invocation to address them.
set -euo pipefail

payload=$(cat)

tool_name=$(printf '%s' "$payload" | jq -r '.tool_name // ""')
[[ "$tool_name" == "Bash" ]] || exit 0

command=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')
# Match `gh pr create` allowing for leading commands like `cd repo && ...`
if ! printf '%s' "$command" | grep -qE '(^|[;&| ])gh[[:space:]]+pr[[:space:]]+create([[:space:]]|$)'; then
  exit 0
fi

# Only succeed-path: skip if the tool reported an error
tool_error=$(printf '%s' "$payload" | jq -r '.tool_response.error // ""')
[[ -z "$tool_error" ]] || exit 0

stdout=$(printf '%s' "$payload" | jq -r '.tool_response.stdout // .tool_response.output // ""')
pr_url=$(printf '%s' "$stdout" | grep -oE 'https://github\.com/[^[:space:]]+/pull/[0-9]+' | tail -1 || true)

repo_root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$repo_root"

if [[ -z "$pr_url" ]]; then
  pr_url=$(gh pr view --json url --jq .url 2>/dev/null || true)
fi
[[ -n "$pr_url" ]] || exit 0

pr_number=$(printf '%s' "$pr_url" | grep -oE '[0-9]+$')
[[ -n "$pr_number" ]] || exit 0

watcher="$repo_root/.claude/hooks/pr-comment-watcher.sh"
log_dir="$repo_root/.claude/logs"
mkdir -p "$log_dir"
log_file="$log_dir/pr-watcher-${pr_number}.log"

nohup bash "$watcher" "$pr_url" "$repo_root" >>"$log_file" 2>&1 &
disown $! 2>/dev/null || true

exit 0
