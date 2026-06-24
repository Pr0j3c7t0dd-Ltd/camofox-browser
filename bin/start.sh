#!/bin/sh
# Start the camofox server, then open a default welcome tab so the VNC
# view shows a live browser window immediately on connect.

set -e

# Start the server in the background
node --max-old-space-size="${MAX_OLD_SPACE_SIZE:-128}" /app/server.js &
SERVER_PID=$!

# Wait for the server to be ready
echo "[start] waiting for server on port ${CAMOFOX_PORT:-9377}..."
until curl -sf "http://localhost:${CAMOFOX_PORT:-9377}/health" | grep -q '"ok":true'; do
  sleep 1
done
echo "[start] server ready"

# Open a default tab so the browser window is visible in noVNC
AUTH_HEADER=""
if [ -n "$CAMOFOX_ACCESS_KEY" ]; then
  AUTH_HEADER="-H \"Authorization: Bearer $CAMOFOX_ACCESS_KEY\""
fi

curl -sf -X POST "http://localhost:${CAMOFOX_PORT:-9377}/tabs" \
  ${AUTH_HEADER:+-H "Authorization: Bearer $CAMOFOX_ACCESS_KEY"} \
  -H "Content-Type: application/json" \
  -d '{"userId":"_welcome","sessionKey":"default","url":"https://example.com"}' > /dev/null \
  && echo "[start] welcome tab opened" \
  || echo "[start] warning: could not open welcome tab (continuing anyway)"

# Hand off to the server process
wait $SERVER_PID
