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
  tabs=$(curl -sf "http://localhost:${PORT}/tabs?userId=${SESSION_USER_ID}" \
    ${CAMOFOX_ACCESS_KEY:+-H "Authorization: Bearer $CAMOFOX_ACCESS_KEY"} 2>/dev/null)
  # true if this user already has a tab (the welcome tab is the only one at idle).
  # The list is `{"running":true,"tabs":[{...}]}`; any tabId means open. Testing
  # `"tabs":[]` against an empty/errored response reported "closed" every cycle,
  # which reopened a welcome tab over whatever the human was on.
  echo "$tabs" | grep -q '"tabId"'
}

# Wait for the server, open the welcome tab, then keep it open. This runs in the
# background because the server has to end up as PID 1 (see the exec below).
(
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
  while true; do
    sleep 120
    if ! welcome_tab_open; then
      if open_welcome_tab; then
        echo "[start] welcome tab reopened"
      fi
    fi
  done
) &

# exec, not a background child: node becomes PID 1 and receives docker's SIGTERM
# itself. A backgrounded child never saw it -- `docker stop`/`restart` signals
# only PID 1, and a shell does not pass signals to its children, so node was
# SIGKILLed with the container, its graceful shutdown never ran, and the
# storage-state checkpoint that saves every login in the shared profile never
# happened. The obvious middle ground was tried first (trap SIGTERM, forward to
# the child PID): the trap ran and logged, node still never reacted, and the
# container sat out the entire stop grace period -- while a direct
# `kill -TERM <node pid>` from outside the container did work. So let the kernel
# deliver the signal straight to node instead of routing it through a shell.
exec node --max-old-space-size="${MAX_OLD_SPACE_SIZE:-128}" /app/server.js
