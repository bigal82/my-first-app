#!/bin/bash
# FaecherLofts Manager — Push + Deploy in einem Schritt
#
# Verwendung:
#   bash scripts/deploy.sh              # nur Manager
#   bash scripts/deploy.sh --website    # nur Website
#   bash scripts/deploy.sh --all        # beides

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/../.env.deploy" ]; then
  source "$SCRIPT_DIR/../.env.deploy"
fi

COOLIFY_URL="${COOLIFY_URL:?Fehlt: COOLIFY_URL in .env.deploy}"
COOLIFY_TOKEN="${COOLIFY_TOKEN:?Fehlt: COOLIFY_TOKEN in .env.deploy}"
MANAGER_UUID="${MANAGER_UUID:-j133ig0jojoq91fd4bxpwb1l}"
WEBSITE_UUID="${WEBSITE_UUID:-cyhdi8i9csym99pa19jbrjgt}"

deploy_app() {
  local uuid=$1
  local name=$2
  echo "→ Deploying $name ($uuid)..."
  local response
  response=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $COOLIFY_TOKEN" \
    "$COOLIFY_URL/api/v1/deploy?uuid=$uuid&force=true")
  local http_code=$(echo "$response" | tail -1)
  local body=$(echo "$response" | head -1)
  if [ "$http_code" = "200" ]; then
    echo "✓ $name deploy gestartet"
  else
    echo "✗ $name deploy fehlgeschlagen (HTTP $http_code): $body"
    return 1
  fi
}

case "${1:-}" in
  --website)
    echo "=== Website: git push ==="
    cd "C:/claude/fächerlofts-www/site/dist"
    git push github main
    deploy_app "$WEBSITE_UUID" "Website"
    ;;
  --all)
    echo "=== Manager: git push ==="
    cd "C:/claude/my-first-app/app"
    git push github main
    deploy_app "$MANAGER_UUID" "Manager"
    echo ""
    echo "=== Website: git push ==="
    cd "C:/claude/fächerlofts-www/site/dist"
    git push github main
    deploy_app "$WEBSITE_UUID" "Website"
    ;;
  *)
    echo "=== Manager: git push + deploy ==="
    cd "C:/claude/my-first-app/app"
    git push github main
    deploy_app "$MANAGER_UUID" "Manager"
    ;;
esac

echo ""
echo "Done. Deployments laufen im Hintergrund auf Coolify."
