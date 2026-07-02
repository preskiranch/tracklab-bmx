#!/bin/zsh

APP_DIR="/Users/rinzellhicks/Documents/Playground/wattbike-bmx-race"
APP_URL="http://127.0.0.1:5174"
ENV_FILE="$APP_DIR/.env.local"

clear
echo "Starting TrackLab BMX..."
echo
echo "This starts the local TrackLab app and the ANT+ bridge."
echo "Use this launcher for Wattbike riding and racing."
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

MAPS_KEY="$(grep -E '^VITE_GOOGLE_MAPS_API_KEY=.+$' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2-)"
if [ -z "$MAPS_KEY" ]; then
  echo "Google satellite imagery needs your Google Maps API key."
  echo "Run Google Maps Setup from the TrackLabs folder first."
  echo
  read -r "?Press Return to close this window."
  exit 1
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
if [ -n "$WEB_PID" ] && [ -n "$BRIDGE_PID" ]; then
  echo "TrackLab is already running."
  echo "Opening $APP_URL"
  /usr/bin/open "$APP_URL"
  echo
  echo "If the app ever gets stuck, run Stop TrackLab BMX first, then start again."
  read -r "?Press Return to close this window."
  exit 0
fi

if [ -n "$WEB_PID$BRIDGE_PID" ]; then
  echo "Found a partial TrackLab session. Stopping it before starting clean."
  /Users/rinzellhicks/Documents/Playground/wattbike-bmx-race/scripts/tracklab-stop-local.zsh --quiet
  sleep 2
fi

(
  for _ in {1..30}; do
    if /usr/bin/curl -fsS "$APP_URL" >/dev/null 2>&1; then
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
echo "1. Press Start Local Bridge in TrackLab."
echo "2. Put each Wattbike in Just Ride."
echo "3. Pedal each bike for a few seconds so the ANT+ bridge can detect it."
echo
echo "Leave this Terminal window open while using TrackLab."
echo "Run Stop TrackLab BMX when you are finished."
echo

npm run dev

echo
echo "TrackLab BMX stopped."
read -r "?Press Return to close this window."
