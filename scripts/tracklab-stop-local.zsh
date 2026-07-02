#!/bin/zsh

QUIET="${1:-}"

if [ "$QUIET" != "--quiet" ]; then
  clear
  echo "Stopping TrackLab BMX..."
  echo
fi

PIDS="$(
  {
    lsof -tiTCP:5174 -sTCP:LISTEN 2>/dev/null
    lsof -tiTCP:8787 -sTCP:LISTEN 2>/dev/null
  } | sort -u
)"

if [ -z "$PIDS" ]; then
  if [ "$QUIET" != "--quiet" ]; then
    echo "TrackLab is not currently running."
    echo
    read -r "?Press Return to close this window."
  fi
  exit 0
fi

echo "$PIDS" | xargs kill -TERM 2>/dev/null || true
sleep 2

LEFTOVER="$(
  {
    lsof -tiTCP:5174 -sTCP:LISTEN 2>/dev/null
    lsof -tiTCP:8787 -sTCP:LISTEN 2>/dev/null
  } | sort -u
)"

if [ -n "$LEFTOVER" ]; then
  echo "$LEFTOVER" | xargs kill -KILL 2>/dev/null || true
fi

if [ "$QUIET" != "--quiet" ]; then
  echo "TrackLab has been stopped."
  echo
  read -r "?Press Return to close this window."
fi
