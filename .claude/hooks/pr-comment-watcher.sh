#!/usr/bin/env bash
# Background watcher: every 5 minutes, fetch new review comments on the PR
# past the watermark and dispatch a headless `claude -p` to fix+push.
# Loops until the PR is no longer OPEN.
set -uo pipefail

pr_url="${1:-}"
repo_root="${2:-$(pwd)}"

[[ -n "$pr_url" ]] || { echo "[watcher] missing pr_url"; exit 1; }
pr_number=$(printf '%s' "$pr_url" | grep -oE '[0-9]+$')
[[ -n "$pr_number" ]] || { echo "[watcher] cannot parse PR number from $pr_url"; exit 1; }

cd "$repo_root"

state_dir="$repo_root/.claude/hooks/state"
mkdir -p "$state_dir"
lock_dir="$state_dir/lock-pr-${pr_number}"
watermark_file="$state_dir/watermark-pr-${pr_number}"

# Atomic mkdir-based lock — prevents overlapping watchers for the same PR.
if ! mkdir "$lock_dir" 2>/dev/null; then
  echo "[watcher] another watcher already running for PR #${pr_number}; exiting"
  exit 0
fi
# shellcheck disable=SC2064
trap "rmdir '$lock_dir' 2>/dev/null || true" EXIT INT TERM

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { echo "[$(ts)] $*"; }

# Initialize watermark to PR creation time so we ignore pre-existing comments.
if [[ ! -s "$watermark_file" ]]; then
  if pr_created=$(gh pr view "$pr_number" --json createdAt --jq .createdAt 2>/dev/null) && [[ -n "$pr_created" ]]; then
    printf '%s' "$pr_created" > "$watermark_file"
  else
    ts > "$watermark_file"
  fi
fi

log "watcher started for PR #${pr_number} (${pr_url}); watermark=$(cat "$watermark_file")"

CLAUDE_BIN="${CLAUDE_BIN:-$(command -v claude || true)}"
if [[ -z "$CLAUDE_BIN" ]]; then
  log "claude CLI not found on PATH; cannot apply fixes"
fi

SLEEP_SECS="${PR_WATCHER_SLEEP_SECS:-300}"  # 5 minutes
MAX_CYCLES="${PR_WATCHER_MAX_CYCLES:-0}"    # 0 = unbounded
cycle=0

while :; do
  cycle=$((cycle + 1))
  if [[ "$MAX_CYCLES" -gt 0 && "$cycle" -gt "$MAX_CYCLES" ]]; then
    log "reached MAX_CYCLES=$MAX_CYCLES, exiting"
    break
  fi

  log "cycle #$cycle: sleeping ${SLEEP_SECS}s"
  sleep "$SLEEP_SECS"

  state=$(gh pr view "$pr_number" --json state --jq .state 2>/dev/null || echo "UNKNOWN")
  if [[ "$state" != "OPEN" ]]; then
    log "PR #${pr_number} is $state; stopping watcher"
    break
  fi

  watermark=$(cat "$watermark_file")
  log "fetching review comments since $watermark"

  # Inline review comments (review threads). Filter to those after watermark.
  if ! comments=$(gh api --paginate "repos/{owner}/{repo}/pulls/${pr_number}/comments" 2>/dev/null \
        | jq --arg wm "$watermark" '[.[] | select(.created_at > $wm)]'); then
    log "failed to fetch comments; will retry next cycle"
    continue
  fi

  count=$(printf '%s' "$comments" | jq 'length')
  if [[ "$count" -eq 0 ]]; then
    log "no new review comments"
    continue
  fi

  log "found $count new review comment(s); dispatching claude"

  digest=$(printf '%s' "$comments" \
    | jq -r '.[] | "- @\(.user.login) on \(.path):\(.line // .original_line // "?") (\(.created_at)):\n  \(.body | gsub("\n"; "\n  "))"')

  newest=$(printf '%s' "$comments" | jq -r 'map(.created_at) | max // ""')

  branch=$(gh pr view "$pr_number" --json headRefName --jq .headRefName 2>/dev/null || echo "")

  if [[ -z "$CLAUDE_BIN" ]]; then
    log "skipping fix dispatch: claude CLI unavailable"
  else
    prompt=$(cat <<EOF
You are resolving review feedback on PR #${pr_number} (${pr_url}).
The PR head branch is: ${branch}
Repo root: ${repo_root}

New review comments since last check:
${digest}

Your job:
1. Make sure the local checkout is on branch "${branch}" (fetch + switch if needed). Do not touch unrelated work.
2. For each comment, decide if it is a valid critique. If yes, apply a focused code change. If no, skip it (do not reply).
3. Run available formatters/linters/tests if they are quick.
4. Stage only the files you changed, commit with a clear message like "address PR review feedback", and push to origin/${branch}.
5. If nothing valid to fix, exit without committing.

Constraints:
- Do not amend existing commits; create a new commit.
- Do not force-push.
- Do not change the PR title or description.
- Do not respond to comments via gh; just push the fix.
EOF
)

    log "invoking: $CLAUDE_BIN -p (dangerously-skip-permissions)"
    if "$CLAUDE_BIN" -p "$prompt" --dangerously-skip-permissions --add-dir "$repo_root" 2>&1; then
      log "claude invocation completed"
    else
      log "claude invocation exited non-zero"
    fi
  fi

  # Advance watermark even if claude failed, so we don't reprocess the same
  # comments on every cycle. If new comments arrive, they'll be picked up next.
  if [[ -n "$newest" ]]; then
    printf '%s' "$newest" > "$watermark_file"
    log "watermark advanced to $newest"
  fi
done

log "watcher exiting for PR #${pr_number}"
