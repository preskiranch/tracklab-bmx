#!/bin/zsh

APP_DIR="/Users/rinzellhicks/Documents/Playground/wattbike-bmx-race"
APP_URL="${TRACKLAB_APP_URL:-https://tracklab-bmx.onrender.com}"
LOCAL_APP_URL="http://127.0.0.1:5174"
BRIDGE_STATUS_URL="http://127.0.0.1:8787/api/bridge/status"
RUN_LOCAL_WEB="${TRACKLAB_RUN_LOCAL_WEB:-0}"
ENV_FILE="$APP_DIR/.env.local"

clear
echo "Starting TrackLab BMX..."
echo
echo "This starts the local Bluetooth/ANT+ bike connector for the TrackLab website."
echo "Use this launcher on the Mac or PC that is near the Wattbikes."
echo

if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js/npm was not found."
  echo "Ask Codex to reinstall the TrackLab dependencies, then run this again."
  echo
  read -r "?Press Return to close this window."
  exit 1
fi

cd "$APP_DIR" || {
  echo "Could not find the TrackLab app folder:"
  echo "$APP_DIR"
  echo
  read -r "?Press Return to close this window."
  exit 1
}

if [ "$RUN_LOCAL_WEB" = "1" ]; then
  MAPS_KEY="$(grep -E '^VITE_GOOGLE_MAPS_API_KEY=.+$' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2-)"
  if [ -z "$MAPS_KEY" ]; then
    echo "Google satellite imagery needs your Google Maps API key."
    echo "Run Google Maps Setup from the TrackLabs folder first."
    echo
    read -r "?Press Return to close this window."
    exit 1
  fi
fi

if [ ! -d "node_modules" ]; then
  echo "Installing app dependencies. This only needs to happen once."
  npm install --cache ./.npm-cache || {
    echo
    echo "Dependency install failed."
    read -r "?Press Return to close this window."
    exit 1
  }
fi

WEB_PID="$(lsof -tiTCP:5174 -sTCP:LISTEN 2>/dev/null | head -1)"
BRIDGE_PID="$(lsof -tiTCP:8787 -sTCP:LISTEN 2>/dev/null | head -1)"
if [ "$RUN_LOCAL_WEB" != "1" ] && [ -n "$BRIDGE_PID" ]; then
  echo "TrackLab Bike Connector is already running."
  echo "Opening $APP_URL"
  /usr/bin/open "$APP_URL"
  echo
  echo "Return to the website, choose Advanced Connector, then press Start Connector if it is not already scanning."
  read -r "?Press Return to close this window."
  exit 0
fi

if [ "$RUN_LOCAL_WEB" = "1" ] && [ -n "$WEB_PID" ] && [ -n "$BRIDGE_PID" ]; then
  echo "TrackLab is already running."
  echo "Opening $LOCAL_APP_URL"
  /usr/bin/open "$LOCAL_APP_URL"
  echo
  echo "If the app ever gets stuck, run Stop TrackLab BMX first, then start again."
  read -r "?Press Return to close this window."
  exit 0
fi

if [ "$RUN_LOCAL_WEB" = "1" ] && [ -n "$WEB_PID$BRIDGE_PID" ]; then
  echo "Found a partial TrackLab session. Stopping it before starting clean."
  /Users/rinzellhicks/Documents/Playground/wattbike-bmx-race/scripts/tracklab-stop-local.zsh --quiet
  sleep 2
fi

(
  for _ in {1..30}; do
    if [ "$RUN_LOCAL_WEB" = "1" ] && /usr/bin/curl -fsS "$LOCAL_APP_URL" >/dev/null 2>&1; then
      /usr/bin/open "$LOCAL_APP_URL"
      exit 0
    fi
    if [ "$RUN_LOCAL_WEB" != "1" ] && /usr/bin/curl -fsS "$BRIDGE_STATUS_URL" >/dev/null 2>&1; then
      /usr/bin/open "$APP_URL"
      exit 0
    fi
    sleep 1
  done
  /usr/bin/open "$APP_URL"
) &

echo "The app will open at: $APP_URL"
echo
echo "Use it like this:"
echo "1. Choose Advanced Connector in TrackLab."
echo "2. Press Start Connector if it is not already scanning."
echo "3. Put each Wattbike in Just Ride."
echo "4. Pedal each bike for a few seconds so the connector can detect it."
echo
echo "Leave this Terminal window open while using TrackLab."
echo "Run Stop TrackLab BMX when you are finished."
echo

if [ "$RUN_LOCAL_WEB" = "1" ]; then
  npm run dev
else
  WATTBIKE_INPUT="${WATTBIKE_INPUT:-auto}" WATTBIKE_BRIDGE_AUTOSTART="${WATTBIKE_BRIDGE_AUTOSTART:-1}" npm run bridge
fi

echo
echo "TrackLab BMX stopped."
read -r "?Press Return to close this window."
