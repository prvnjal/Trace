#!/usr/bin/env bash
# Trigger a TRACE FIRMS refresh via the API and wait for it to finish.
#
# The backend ALSO refreshes automatically every 6 hours on its own
# (APScheduler, FIRMS_REFRESH_HOURS env, default 6). This script is the
# visible, schedulable path — run it from cron or Task Scheduler, or by
# hand when you want to watch a refresh happen:
#
#   ./scripts/firms_refresh.sh            # default day range, 90 min timeout
#   ./scripts/firms_refresh.sh 3          # 3-day FIRMS window
#   TRACE_API=http://192.168.1.10:8000 ./scripts/firms_refresh.sh
set -u

API="${TRACE_API:-http://localhost:8000}"
DAYS="${1:-}"
TIMEOUT_MIN="${2:-90}"

echo "Triggering FIRMS refresh on $API ..."
params=""
[ -n "$DAYS" ] && params="?days=$DAYS"
code=$(curl -s -o /tmp/trace_refresh.json -w "%{http_code}" -X POST "$API/admin/refresh$params")

if [ "$code" = "409" ]; then
  echo "A refresh is already running — following its progress instead."
elif [ "$code" != "200" ]; then
  echo "Could not trigger a refresh (HTTP $code). Is the API up at $API?"
  cat /tmp/trace_refresh.json 2>/dev/null
  exit 1
fi

deadline=$(( $(date +%s) + TIMEOUT_MIN * 60 ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  sleep 30
  st=$(curl -s "$API/admin/refresh/status")
  state=$(printf '%s' "$st" | python3 -c "import sys,json;print(json.load(sys.stdin).get('state','?'))" 2>/dev/null || echo "?")
  detail=$(printf '%s' "$st" | python3 -c "import sys,json;print(json.load(sys.stdin).get('detail') or '')" 2>/dev/null || echo "")
  echo "[$(date +%H:%M:%S)] state=$state ${detail:+| $detail}"
  case "$state" in
    done)   echo "Refresh complete."; exit 0 ;;
    failed) echo "Refresh FAILED: $detail"; exit 1 ;;
  esac
done

echo "Timed out after ${TIMEOUT_MIN} min — the job may still be running."
echo "Check: curl $API/admin/refresh/status"
exit 2
