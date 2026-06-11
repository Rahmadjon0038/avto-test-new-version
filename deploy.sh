#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

DEPLOY_ENV="$ROOT_DIR/.env.docker"
SOURCE_ENV="$ROOT_DIR/.env.production"
ALT_SOURCE_ENV="$ROOT_DIR/.env"
EXAMPLE_ENV="$ROOT_DIR/.env.example"

if [ -f "$SOURCE_ENV" ]; then
  cp "$SOURCE_ENV" "$DEPLOY_ENV"
elif [ -f "$ALT_SOURCE_ENV" ]; then
  cp "$ALT_SOURCE_ENV" "$DEPLOY_ENV"
elif [ -f "$EXAMPLE_ENV" ]; then
  cp "$EXAMPLE_ENV" "$DEPLOY_ENV"
else
  : > "$DEPLOY_ENV"
fi

set_env() {
  local key="$1"
  local value="$2"
  local tmp
  tmp="$(mktemp)"
  if [ -f "$DEPLOY_ENV" ]; then
    grep -v "^${key}=" "$DEPLOY_ENV" > "$tmp" || true
  fi
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$DEPLOY_ENV"
}

get_env() {
  local key="$1"
  grep -E "^${key}=" "$DEPLOY_ENV" | tail -n1 | cut -d= -f2- || true
}

maybe_set_default() {
  local key="$1"
  local value="$2"
  local current
  current="$(get_env "$key")"
  if [ -z "$current" ]; then
    set_env "$key" "$value"
  fi
}

override_from_alt_env() {
  local key="$1"
  local value
  value=""
  if [ -f "$ALT_SOURCE_ENV" ]; then
    value="$(grep -E "^${key}=" "$ALT_SOURCE_ENV" | tail -n1 | cut -d= -f2- || true)"
  fi
  if [ -n "$value" ]; then
    set_env "$key" "$value"
  fi
}

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    date +%s%N | sha256sum | awk '{print $1}'
  fi
}

maybe_set_default POSTGRES_DB "avtotest"
maybe_set_default POSTGRES_USER "avtotest"
maybe_set_default POSTGRES_PASSWORD "avtotest"
set_env DATABASE_URL "postgresql://avtotest:avtotest@db:5432/avtotest"
current_base_url="$(get_env BASE_URL)"
if [ -z "$current_base_url" ] || [ "$current_base_url" = "https://your-domain-or-ngrok-url.example" ] || [ "$current_base_url" = "http://localhost:3001" ] || [ "$current_base_url" = "http://localhost:3000" ] || [ "$current_base_url" = "http://127.0.0.1:3000" ]; then
  set_env BASE_URL "https://road-test.uz"
fi
maybe_set_default NEXT_PUBLIC_SITE_URL "https://road-test.uz"
maybe_set_default CARD_NUMBER "8600 xxxx xxxx xxxx"

override_from_alt_env SMTP_HOST
override_from_alt_env SMTP_PORT
override_from_alt_env SMTP_SECURE
override_from_alt_env SMTP_USER
override_from_alt_env SMTP_PASS
override_from_alt_env SMTP_FROM

secret_value="$(get_env AUTH_JWT_SECRET)"
if [ -z "$secret_value" ] || [ "$secret_value" = "change-this-to-random-string" ]; then
  secret_value="$(generate_secret)"
  set_env AUTH_JWT_SECRET "$secret_value"
fi

session_secret="$(get_env SESSION_SECRET)"
if [ -z "$session_secret" ] || [ "$session_secret" = "change-this-to-random-string" ]; then
  set_env SESSION_SECRET "$secret_value"
else
  set_env SESSION_SECRET "$session_secret"
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker topilmadi. Avval Docker o‘rnating."
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  compose_cmd=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  compose_cmd=(docker-compose)
else
  echo "Docker Compose topilmadi."
  exit 1
fi

"${compose_cmd[@]}" --env-file "$DEPLOY_ENV" up -d --build --remove-orphans

echo "Deploy tayyor."
echo "Frontend: https://road-test.uz"
echo "Backend:  http://localhost:4001"
