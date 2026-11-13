#!/usr/bin/env bash
# Tests navigateur : construit le site et le serveur en mémoire, puis lance le scénario demandé (par défaut : master).
# Prérequis : Playwright disponible (require('playwright')) ; aucune clé ni réseau externe.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env.example; set +a
OUT=e2e/.build; rm -rf "$OUT"; mkdir -p "$OUT/site"
VITE_BASE_PATH=/Dogui-Mart-Pro-SaaS-/ npx vite build --outDir "$OUT/site/Dogui-Mart-Pro-SaaS-" --emptyOutDir >/dev/null
npx esbuild e2e/entry.ts --bundle --platform=node --format=cjs --outfile="$OUT/server.cjs" --log-level=error
mkdir -p e2e/out
node "e2e/${1:-master}.cjs"
