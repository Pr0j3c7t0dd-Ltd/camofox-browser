#!/bin/sh
# Start the camofox server, then keep a welcome tab open so the VNC
# view always shows a live browser window.

set -e

PORT="${CAMOFOX_PORT:-9377}"
# SESSION_USER_ID must match the userId the agent uses so that the human's
# noVNC login and the agent's API calls share the same persistent profile.
SESSION_USER_ID="${SESSION_USER_ID:-agent}"
WELCOME_URL="https://example.com"

open_welcome_tab() {
  curl -sf -X POST "http://localhost:${PORT}/tabs" \
    ${CAMOFOX_ACCESS_KEY:+-H "Authorization: Bearer $CAMOFOX_ACCESS_KEY"} \
    -H "Content-Type: application/json" \
    -d "{\"userId\":\"${SESSION_USER_ID}\",\"sessionKey\":\"default\",\"url\":\"${WELCOME_URL}\"}" \
    > /dev/null
}

welcome_tab_open() {
  tabs=$(curl -sf "http://localhost:${PORT}/tabs" \
    ${CAMOFOX_ACCESS_KEY:+-H "Authorization: Bearer $CAMOFOX_ACCESS_KEY"} 2>/dev/null)
  # true if any tab exists (the welcome tab is the only one at idle)
  echo "$tabs" | grep -qv '"tabs":\[\]'
}

# Start the server in the background
node --max-old-space-size="${MAX_OLD_SPACE_SIZE:-128}" /app/server.js &
SERVER_PID=$!

# Wait for the server to be ready
echo "[start] waiting for server on port ${PORT}..."
until curl -sf "http://localhost:${PORT}/health" | grep -q '"ok":true'; do
  sleep 1
done
echo "[start] server ready"

# Open the initial welcome tab
if open_welcome_tab; then
  echo "[start] welcome tab opened"
else
  echo "[start] warning: could not open welcome tab (continuing anyway)"
fi

# Keep-alive loop: reopen the welcome tab if it was closed by a session timeout
( while true; do
    sleep 120
    if ! welcome_tab_open; then
      if open_welcome_tab; then
        echo "[start] welcome tab reopened"
      fi
    fi
  done
) &

# Hand off to the server process
wait $SERVER_PID
