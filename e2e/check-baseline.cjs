/** Compare le résultat de « run.sh all » à e2e/known-failures.json : seules les NOUVELLES étapes en échec (ou plantages) font échouer. */
const fs = require("fs"); const base = JSON.parse(fs.readFileSync(__dirname + "/known-failures.json", "utf8")).known;
let cur = null, nw = [], fixed = [], crash = [], seen = {};
for (const l of fs.readFileSync(process.argv[2], "utf8").split("\n")) {
  if (l.startsWith("=== ")) cur = l.slice(4);
  else if (l.startsWith("FAIL") && cur) { const n = l.slice(5).split(" → ")[0].trim().slice(0, 90); (seen[cur] = seen[cur] || []).push(n); if (!(base[cur] || []).includes(n)) nw.push(cur + " : " + n); }
  else if (l === "CRASH" && cur) crash.push(cur);
}
for (const k of Object.keys(base)) for (const n of base[k]) if (!(seen[k] || []).includes(n)) fixed.push(k + " : " + n);
const knownCrash = (JSON.parse(fs.readFileSync(__dirname + "/known-failures.json", "utf8")).crash) || [];
const newCrash = crash.filter((c) => !knownCrash.includes(c));
console.log(`Échecs connus restants : ${Object.values(seen).flat().length - nw.length} · réparés : ${fixed.length} · NOUVEAUX : ${nw.length} · plantages nouveaux : ${newCrash.length}`);
nw.forEach((x) => console.log("NOUVEAU ÉCHEC", x)); newCrash.forEach((x) => console.log("NOUVEAU PLANTAGE", x)); fixed.forEach((x) => console.log("RÉPARÉ (à retirer de la liste)", x));
process.exit(nw.length || newCrash.length ? 1 : 0);
