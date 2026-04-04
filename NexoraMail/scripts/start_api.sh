#!/usr/bin/env bash
if [ -z "${BASH_VERSION-}" ]; then
  exec /usr/bin/env bash "$0" "$@"
fi
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKDIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOGFILE="$WORKDIR/logs/api.log"

mkdir -p "$WORKDIR/logs"

echo "Starting NexoraMail API. Logs -> $LOGFILE"
nohup python3 "$WORKDIR/NexoraMailAPI.py" >> "$LOGFILE" 2>&1 &
sleep 0.5

if command -v pgrep >/dev/null 2>&1; then
  pids=$({ pgrep -f "NexoraMailAPI.py" || true; } | tr '\n' ' ')
else
  pids=$({ ps aux | grep "[N]exoraMailAPI.py" | awk '{print $2}' || true; } | tr '\n' ' ')
fi

if [ -z "$pids" ]; then
  echo "Failed to detect NexoraMail API process after start. Check $LOGFILE."
  exit 1
fi

echo "Started NexoraMail API, PIDs: $pids"
echo "Follow logs with: tail -f $LOGFILE"
