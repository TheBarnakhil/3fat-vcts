#!/usr/bin/env bash
# Upload Directus env vars from web/.env.local to Vercel (production, preview, development).
# Requires: `npx vercel login` (or VERCEL_TOKEN) and a linked project in web/.vercel
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$ROOT_DIR/web"
ENV_FILE="$WEB_DIR/.env.local"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

read_env() {
  local key="$1"
  local line value
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -1 || true)"
  if [[ -z "$line" ]]; then
    echo "Missing $key in $ENV_FILE" >&2
    return 1
  fi
  value="${line#*=}"
  value="${value%%#*}"
  value="${value#\"}"
  value="${value%\"}"
  value="${value#\'}"
  value="${value%\'}"
  printf '%s' "$value"
}

VARS=(
  DIRECTUS_URL
  DIRECTUS_ADMIN_TOKEN
  DIRECTUS_TENANT_TOKENS
  DIRECTUS_CORS_ORIGIN
)

cd "$WEB_DIR"

if [[ ! -d .vercel ]]; then
  echo "Linking Vercel project (web/)..."
  npx --yes vercel@latest link --project project-jcsyq --yes
fi

ENV_TARGETS=(production preview development)
VERCEL_BIN="${VERCEL_BIN:-vercel}"

add_env() {
  local name="$1" value="$2" target="$3"
  echo "Setting $name ($target)..."
  if [[ "$target" == "preview" ]]; then
    # CLI v54 still needs an empty branch arg for all Preview branches (see vercel/vercel#15763).
    timeout 30 "$VERCEL_BIN" env add "$name" preview \
      --value "$value" \
      --yes \
      --force \
      --non-interactive "" \
      || true
  else
    timeout 30 "$VERCEL_BIN" env add "$name" "$target" \
      --value "$value" \
      --yes \
      --force \
      || true
  fi
}

for name in "${VARS[@]}"; do
  value="$(read_env "$name")"
  if [[ -z "$value" ]]; then
    echo "Skipping empty $name" >&2
    continue
  fi
  for target in "${ENV_TARGETS[@]}"; do
    add_env "$name" "$value" "$target"
  done
done

echo
echo "Done. Redeploy production for changes to take effect:"
echo "  cd web && npx vercel --prod"
