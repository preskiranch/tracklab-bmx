#!/bin/zsh

APP_DIR="/Users/rinzellhicks/Documents/Playground/wattbike-bmx-race"
APP_URL="${TRACKLAB_APP_URL:-https://tracklab-bmx.onrender.com}"
BRIDGE_STATUS_URL="http://127.0.0.1:8787/api/bridge/status"
CONNECTOR_TERMINAL_SCRIPT="$APP_DIR/scripts/tracklab-start-local.zsh"
CURRENT_USER="$(id -un 2>/dev/null || echo rinzellhicks)"
USER_HOME="$(/usr/bin/dscl . -read "/Users/$CURRENT_USER" NFSHomeDirectory 2>/dev/null | /usr/bin/awk '{print $2}')"
if [ -z "$USER_HOME" ] || [ "$USER_HOME" = "/" ]; then
  USER_HOME="/Users/rinzellhicks"
fi
export HOME="$USER_HOME"

SUPPORT_DIR="$USER_HOME/Library/Application Support/TrackLab BMX"
LOG_DIR="$USER_HOME/Library/Logs/TrackLab BMX"
PID_FILE="$SUPPORT_DIR/connector.pid"
LOG_FILE="$LOG_DIR/connector.log"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

notify() {
  /usr/bin/osascript -e "display notification \"$1\" with title \"TrackLab BMX\"" >/dev/null 2>&1 || true
}

mkdir -p "$SUPPORT_DIR" "$LOG_DIR"

{
  echo
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] TrackLab connector launch requested."
} >> "$LOG_FILE"

if /usr/bin/curl -fsS "$BRIDGE_STATUS_URL" >/dev/null 2>&1; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Connector already running." >> "$LOG_FILE"
  /usr/bin/open "$APP_URL"
  notify "Bike connector is already running."
  exit 0
fi

cd "$APP_DIR" || {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Missing app directory: $APP_DIR" >> "$LOG_FILE"
  /usr/bin/osascript -e 'display alert "TrackLab BMX" message "Could not find the TrackLab app folder. Ask Codex to reinstall the TrackLab connector."' >/dev/null 2>&1 || true
  exit 1
}

if ! command -v npm >/dev/null 2>&1; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] npm was not found in PATH: $PATH" >> "$LOG_FILE"
  /usr/bin/osascript -e 'display alert "TrackLab BMX" message "Node.js/npm was not found. Ask Codex to reinstall the TrackLab dependencies, then try again."' >/dev/null 2>&1 || true
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Installing dependencies before connector start." >> "$LOG_FILE"
  npm install --cache ./.npm-cache >> "$LOG_FILE" 2>&1 || {
    /usr/bin/osascript -e 'display alert "TrackLab BMX" message "Dependency install failed. Ask Codex to check the connector log."' >/dev/null 2>&1 || true
    exit 1
  }
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting connector bridge." >> "$LOG_FILE"
/usr/bin/osascript <<APPLESCRIPT >> "$LOG_FILE" 2>&1
tell application "Terminal"
  activate
  do script "export TRACKLAB_APP_URL='${APP_URL}'; zsh '${CONNECTOR_TERMINAL_SCRIPT}'"
end tell
APPLESCRIPT

for _ in {1..40}; do
  if /usr/bin/curl -fsS "$BRIDGE_STATUS_URL" >/dev/null 2>&1; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Connector bridge is online." >> "$LOG_FILE"
    /usr/bin/open "$APP_URL"
    notify "Bike connector is running. Put each Wattbike in Just Ride and pedal."
    exit 0
  fi
  sleep 0.5
done

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Connector did not become reachable on 127.0.0.1:8787." >> "$LOG_FILE"
/usr/bin/open "$APP_URL"
/usr/bin/osascript -e 'display alert "TrackLab BMX" message "The connector did not start. Ask Codex to check ~/Library/Logs/TrackLab BMX/connector.log."' >/dev/null 2>&1 || true
exit 1
