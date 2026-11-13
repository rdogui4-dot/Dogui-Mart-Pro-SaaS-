#!/usr/bin/env bash
# Tests navigateur. Usage : bash e2e/run.sh [master | jNN | all]  (par défaut : master)
# Construit le site et le serveur en mémoire (même routeur que la fonction dmp-api), puis pilote Chromium via Playwright.
# Prérequis : Playwright disponible (require('playwright')). Aucune clé, aucun réseau externe.
set -uo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env.example; set +a
OUT=e2e/.build; rm -rf "$OUT"; mkdir -p "$OUT/site" e2e/out
VITE_BASE_PATH=/Dogui-Mart-Pro-SaaS-/ npx vite build --outDir "$OUT/site/Dogui-Mart-Pro-SaaS-" --emptyOutDir >/dev/null || exit 2
npx esbuild e2e/entry.ts --bundle --platform=node --format=cjs --outfile="$OUT/server.cjs" --log-level=error || exit 2
run() { local f="$1"; [ -f "e2e/scenarios/$f.cjs" ] && f="e2e/scenarios/$f.cjs" || f="e2e/$f.cjs"; timeout "${E2E_TIMEOUT:-240}" node "$f"; }
case "${1:-master}" in
  all) rm -f e2e/out/all.txt; for f in e2e/scenarios/j*.cjs e2e/master.cjs; do n=$(basename "$f" .cjs); echo "=== $n" >> e2e/out/all.txt; out=$(timeout "${E2E_TIMEOUT:-240}" node "$f" 2>&1); echo "$out" | grep -E "^(OK|FAIL)|ERRORS|BAD|TOUT PASSE|ÉCHEC" | cut -c1-260 >> e2e/out/all.txt; echo "$out" | grep -qE "^(Error|TypeError|ReferenceError)|Node.js v" && echo "CRASH" >> e2e/out/all.txt; done; node e2e/check-baseline.cjs e2e/out/all.txt; exit $? ;;
  *) run "$1" ;;
esac
