// Génère docs/offres-selar.pdf et docs/offres-selar.md depuis le catalogue de l'application.
// Usage : npm run docs:offers
import { mkdirSync, writeFileSync } from "node:fs";
import { buildOffers, offersMarkdown } from "../src/domain/selar-offers";
import { buildOffersPdf } from "../src/lib/offers-pdf";

mkdirSync("docs", { recursive: true });
const now = new Date();
writeFileSync("docs/offres-selar.pdf", Buffer.from((await buildOffersPdf(now)).output("arraybuffer")));
writeFileSync("docs/offres-selar.md", offersMarkdown(buildOffers(), now));
console.log("docs/offres-selar.pdf et docs/offres-selar.md générés");
