#!/usr/bin/env bash
if [ -z "${BASH_VERSION-}" ]; then
  exec /usr/bin/env bash "$0" "$@"
fi
set -euo pipefail

# start.sh - start NexoraMail + NexoraMailAPI in background
# Does NOT write PID files; finds processes by name using pgrep or ps|grep

# Resolve script dir (scripts/) and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKDIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
MAIL_LOGFILE="$WORKDIR/logs/output.log"
API_LOGFILE="$WORKDIR/logs/api.log"

mkdir -p "$WORKDIR/logs"

start_one() {
  local script_name="$1"
  local logfile="$2"

  # skip if already running
  local running=""
  if command -v pgrep >/dev/null 2>&1; then
    running=$({ pgrep -f "$script_name" || true; } | tr '\n' ' ')
  else
    running=$({ ps aux | grep "[${script_name:0:1}]${script_name:1}" | awk '{print $2}' || true; } | tr '\n' ' ')
  fi
  if [ -n "$running" ]; then
    echo "$script_name already running: $running"
    return 0
  fi

  echo "Starting $script_name (debug mode). Logs -> $logfile"
  nohup python3 "$WORKDIR/$script_name" >> "$logfile" 2>&1 &
  sleep 0.5

  local pids=""
  if command -v pgrep >/dev/null 2>&1; then
    pids=$({ pgrep -f "$script_name" || true; } | tr '\n' ' ')
  else
    pids=$({ ps aux | grep "[${script_name:0:1}]${script_name:1}" | awk '{print $2}' || true; } | tr '\n' ' ')
  fi

  if [ -z "$pids" ]; then
    echo "Failed to detect $script_name after start. Check $logfile for errors."
    return 1
  fi
  echo "Started $script_name, PIDs: $pids"
}

start_one "wMailServer.py" "$MAIL_LOGFILE"
start_one "NexoraMailAPI.py" "$API_LOGFILE"

echo "Follow logs:"
echo "  tail -f $MAIL_LOGFILE"
echo "  tail -f $API_LOGFILE"

exit 0
