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
  all) rm -f e2e/out/all.txt; for f in e2e/scenarios/j*.cjs e2e/master.cjs e2e/master-modal.cjs e2e/caisse.cjs e2e/stock.cjs e2e/achats-depenses.cjs e2e/clients-promotions.cjs e2e/compta-finance.cjs e2e/logo.cjs e2e/shell.cjs e2e/public.cjs e2e/settings.cjs e2e/recette.cjs e2e/fx3d.cjs e2e/recette3d.cjs e2e/kit0.cjs e2e/kit1.cjs e2e/kit2.cjs e2e/kit3.cjs e2e/kit4.cjs e2e/kit5.cjs e2e/kit6.cjs e2e/kit7.cjs e2e/kit8.cjs e2e/kit9.cjs e2e/kit10.cjs e2e/kit11.cjs e2e/kit12.cjs e2e/kit13.cjs e2e/kit13b.cjs e2e/kit14.cjs e2e/kitbundle.cjs e2e/kit15.cjs e2e/kit16.cjs e2e/kit17.cjs e2e/kit18.cjs e2e/kit19.cjs; do n=$(basename "$f" .cjs); echo "=== $n" >> e2e/out/all.txt; out=$(timeout "${E2E_TIMEOUT:-240}" node "$f" 2>&1); echo "$out" | grep -E "^(OK|FAIL)|ERRORS|BAD|TOUT PASSE|ÉCHEC" | cut -c1-260 >> e2e/out/all.txt; echo "$out" | grep -qE "^(Error|TypeError|ReferenceError)|Node.js v" && echo "CRASH" >> e2e/out/all.txt; done; node e2e/check-baseline.cjs e2e/out/all.txt; exit $? ;;
  *) run "$1" ;;
esac
