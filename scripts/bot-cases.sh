#!/usr/bin/env bash
# Lo que el bot no resolvió por código, ya enmascarado (ver backend/app/services/bot_cases.py).
# Uso: INTERNAL_LOG_KEY=… ./scripts/bot-cases.sh [min_count] [kind]
set -euo pipefail
: "${INTERNAL_LOG_KEY:?Falta INTERNAL_LOG_KEY}"
API="${API_URL:-https://api.tood.com.ar}"
curl -fsS -H "x-internal-key: $INTERNAL_LOG_KEY" \
  "$API/internal/bot-cases?min_count=${1:-1}${2:+&kind=$2}" | python3 -m json.tool
