#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker topilmadi. Avval Docker o'rnating."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose topilmadi. Docker Compose plugin'ni o'rnating."
  exit 1
fi

if [[ ! -f ".env" ]]; then
  echo ".env topilmadi. Avval .env yarating (.env.example dan)."
  exit 1
fi

echo "Building images..."
docker compose build

echo "Starting containers..."
docker compose up -d

echo "Done."
echo "Web: http://127.0.0.1:${HOST_WEB_PORT:-18080} (Nginx/proxy orqali domeningizga yo'naltirasiz)"
