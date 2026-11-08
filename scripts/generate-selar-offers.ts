// Génère docs/offres-selar.pdf et docs/offres-selar.md (fiches des 3 produits d'abonnement Selar) depuis le catalogue de l'application.
// Usage : npm run docs:offers [-- https://app.exemple.com]   (sans domaine, les URL de redirection portent le marqueur VOTRE-DOMAINE)
import { mkdirSync, writeFileSync } from "node:fs";
import { buildProducts, productsMarkdown } from "../src/domain/selar-offers";
import { buildOffersPdf } from "../src/lib/offers-pdf";

mkdirSync("docs", { recursive: true });
const now = new Date();
const base = process.argv[2] || process.env.APP_URL || undefined;
writeFileSync("docs/offres-selar.pdf", Buffer.from((await buildOffersPdf(now, undefined, base)).output("arraybuffer")));
writeFileSync("docs/offres-selar.md", productsMarkdown(buildProducts(undefined, base), now));
console.log("docs/offres-selar.pdf et docs/offres-selar.md générés");
