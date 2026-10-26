#!/usr/bin/env bash
# R2 dagi savol rasmlarini 3 o'lchamga bo'ladi (s/m/l, webp). Serverda ishga tushirish:
#
#   ./scripts/optimize-images.sh            # DRY-RUN (hech narsa yozilmaydi)
#   ./scripts/optimize-images.sh --apply    # haqiqatan bajaradi
#   ./scripts/optimize-images.sh --apply --limit=20 --fix-cache-headers
#
# Docker bilan ishlayotgan bo'lsa backend konteyner ichida (u yerda sharp va .env tayyor),
# aks holda to'g'ridan-to'g'ri node bilan ishga tushadi.
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if command -v docker >/dev/null 2>&1 && docker compose ps --status running --services 2>/dev/null | grep -qx backend; then
  exec docker compose exec -T backend node scripts/optimize-images.mjs "$@"
fi

exec node scripts/optimize-images.mjs "$@"
