#!/bin/zsh

APP_DIR="/Users/rinzellhicks/Documents/Playground/wattbike-bmx-race"
ENV_FILE="$APP_DIR/.env.local"
GCLOUD="/Users/rinzellhicks/.local/bin/gcloud"

clear
echo "TrackLab BMX Google Maps setup"
echo

if [ ! -x "$GCLOUD" ]; then
  echo "Google Cloud CLI was not found at:"
  echo "$GCLOUD"
  echo
  echo "Ask Codex to install Google Cloud CLI, then run this again."
  read -r "?Press Return to close this window."
  exit 1
fi

if [ ! -d "$APP_DIR" ]; then
  echo "Could not find the TrackLab app folder:"
  echo "$APP_DIR"
  read -r "?Press Return to close this window."
  exit 1
fi

ACTIVE_ACCOUNT="$("$GCLOUD" auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -1)"
if [ -z "$ACTIVE_ACCOUNT" ]; then
  echo "You need to sign into Google Cloud."
  echo "A browser login window may open. Finish login, then return here."
  echo
  "$GCLOUD" auth login || {
    echo
    echo "Google login failed or was cancelled."
    read -r "?Press Return to close this window."
    exit 1
  }
fi

CURRENT_PROJECT="$("$GCLOUD" config get-value project 2>/dev/null)"
if [ -n "$CURRENT_PROJECT" ] && [ "$CURRENT_PROJECT" != "(unset)" ]; then
  echo "Current Google Cloud project: $CURRENT_PROJECT"
  read -r "?Use this project? Press Return for yes, or type another project ID: " PROJECT_ID
  PROJECT_ID="${PROJECT_ID:-$CURRENT_PROJECT}"
else
  echo "Enter the Google Cloud project ID you want TrackLab to use."
  echo "The project must have billing enabled."
  echo
  "$GCLOUD" projects list --format='table(projectId,name)' 2>/dev/null | sed -n '1,12p'
  echo
  read -r "?Project ID: " PROJECT_ID
fi

if [ -z "$PROJECT_ID" ]; then
  echo "No project ID provided."
  read -r "?Press Return to close this window."
  exit 1
fi

"$GCLOUD" config set project "$PROJECT_ID" || {
  echo "Could not set Google Cloud project."
  read -r "?Press Return to close this window."
  exit 1
}

echo
echo "Checking billing for $PROJECT_ID..."
BILLING_ENABLED="$("$GCLOUD" billing projects describe "$PROJECT_ID" --format='value(billingEnabled)' 2>/dev/null)"
if [ "$BILLING_ENABLED" != "True" ]; then
  echo "Billing is not enabled or could not be verified for this project."
  echo "Google Maps requires billing before an API key will work."
  echo
  open "https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT_ID"
  echo "Enable billing in the browser, then run this setup again."
  read -r "?Press Return to close this window."
  exit 1
fi

echo
echo "Enabling Google APIs..."
MAP_APIS=(
  "apikeys.googleapis.com"
  "maps-backend.googleapis.com"
  "places.googleapis.com"
  "places-backend.googleapis.com"
  "geocoding-backend.googleapis.com"
)

for API in "${MAP_APIS[@]}"; do
  echo "  $API"
  "$GCLOUD" services enable "$API" --project="$PROJECT_ID" --quiet || {
    echo
    echo "Failed to enable $API."
    echo "Open Google Cloud Console and enable it manually, then run this setup again."
    read -r "?Press Return to close this window."
    exit 1
  }
done

echo
echo "Creating a restricted TrackLab browser API key..."
KEY_STRING="$("$GCLOUD" services api-keys create \
  --project="$PROJECT_ID" \
  --display-name="TrackLab BMX Local $(date +%Y-%m-%d)" \
  --allowed-referrers="https://tracklab-bmx.onrender.com/*,http://127.0.0.1:5174/*,http://localhost:5174/*,http://127.0.0.1:*/*,http://localhost:*/*" \
  --format='value(response.keyString)' 2>/tmp/tracklab-google-key-error.txt)"

if [ -z "$KEY_STRING" ]; then
  echo "API key creation did not return a key."
  echo
  cat /tmp/tracklab-google-key-error.txt
  echo
  echo "You can still create a key in Google Cloud Console and paste it into the TrackLab launcher."
  read -r "?Press Return to close this window."
  exit 1
fi

{
  echo "VITE_GOOGLE_MAPS_API_KEY=$KEY_STRING"
  echo "VITE_WATTBIKE_BRIDGE_URL=ws://127.0.0.1:8787"
} > "$ENV_FILE"
chmod 600 "$ENV_FILE"

echo
echo "Google Maps key saved for TrackLab."
echo "$ENV_FILE"
echo
echo "Now run Start TrackLab BMX."
read -r "?Press Return to close this window."
