// Vérification EN CONDITIONS RÉELLES de l'isolation des lectures (étiquettes + rôles d'équipe) contre votre projet Appwrite.
// Crée une table et des comptes temporaires, lit « en tant que » chaque compte, puis NETTOIE tout.
// Usage : APPWRITE_API_KEY=... VITE_APPWRITE_ENDPOINT=... VITE_APPWRITE_PROJECT_ID=... node scripts/verify-isolation.mjs
// Clé requise : users.write, teams.write, databases/tables/rows read+write, sessions.write.
import { Client, Permission, Query, Role, TablesDB, Teams, Users } from "node-appwrite";

const { VITE_APPWRITE_ENDPOINT: endpoint, VITE_APPWRITE_PROJECT_ID: project, APPWRITE_API_KEY: key } = process.env;
const databaseId = process.env.VITE_APPWRITE_DATABASE_ID || "dmp";
if (!endpoint || !project || !key) { console.error("Variables manquantes"); process.exit(1); }

const admin = new Client().setEndpoint(endpoint).setProject(project).setKey(key);
const db = new TablesDB(admin), users = new Users(admin), teams = new Teams(admin);
const tag = Date.now().toString(36); const tableId = `isoprobe${tag}`.slice(0, 36); const teamId = `isoteam${tag}`.slice(0, 36);
const created = { users: [], team: false, table: false };
const results = []; const check = (name, cond) => { results.push([name, !!cond]); console.log(`${cond ? "OK  " : "ÉCHEC"}  ${name}`); };

async function asUser(userId) { // lit avec la session du compte, comme le ferait l'application
  const s = await users.createSession({ userId });
  return new TablesDB(new Client().setEndpoint(endpoint).setProject(project).setSession(s.secret));
}
const readable = async (c) => (await c.listRows({ databaseId, tableId, queries: [Query.limit(50)] })).rows.map((r) => r.$id).sort();

try {
  const mk = async (id, labels) => { const u = await users.create({ userId: `${id}${tag}`.slice(0, 36), email: `${id}.${tag}@staff.invalid`, password: `Probe-${tag}-9482xq`, name: id }); created.users.push(u.$id); if (labels) await users.updateLabels({ userId: u.$id, labels }); return u.$id; };
  const cashA = await mk("cashA", [`sIsoA${tag}`]); const mgrA = await mk("mgrA", [`sIsoA${tag}`, `gIsoA${tag}`]); const cashB = await mk("cashB", [`sIsoB${tag}`]); const boss = await mk("boss", []);
  await teams.create({ teamId, name: "isoprobe" }); created.team = true;
  await teams.createMembership({ teamId, roles: ["owner"], userId: boss });

  await db.createTable({ databaseId, tableId, name: tableId, permissions: [], rowSecurity: true, columns: [{ key: "x", type: "string", size: 8, required: false }] }); created.table = true;
  await new Promise((r) => setTimeout(r, 4000));
  const row = (id, roles) => db.createRow({ databaseId, tableId, rowId: id, data: { x: "1" }, permissions: roles.map((r) => Permission.read(r)) });
  await row("shopA", [`team:${teamId}/owner`, `label:sIsoA${tag}`]); await row("shopB", [`team:${teamId}/owner`, `label:sIsoB${tag}`]);
  await row("mgrOnlyA", [`team:${teamId}/owner`, `label:gIsoA${tag}`]); await row("nobody", []);

  const [cA, mA, cB, bo] = await Promise.all([asUser(cashA), asUser(mgrA), asUser(cashB), asUser(boss)]);
  check("le caissier de A lit la boutique A, pas B, pas la donnée « gérant »", JSON.stringify(await readable(cA)) === '["shopA"]');
  check("le gérant de A lit A et la donnée « gérant », pas B", JSON.stringify(await readable(mA)) === '["mgrOnlyA","shopA"]');
  check("le caissier de B ne lit que B", JSON.stringify(await readable(cB)) === '["shopB"]');
  check("le propriétaire (rôle d'équipe) lit tout sauf la ligne sans lecteur", JSON.stringify(await readable(bo)) === '["mgrOnlyA","shopA","shopB"]');
  // Retrait d'étiquette : l'effet doit être immédiat sur une nouvelle lecture
  await users.updateLabels({ userId: cashA, labels: [] });
  check("après retrait des étiquettes, le caissier ne lit plus rien", JSON.stringify(await readable(await asUser(cashA))) === "[]");
  // Écriture : aucun droit client
  let denied = false; try { await cA.createRow({ databaseId, tableId, rowId: "hack", data: { x: "2" } }); } catch { denied = true; }
  check("un client ne peut pas créer de ligne", denied);
} catch (e) { console.error("Erreur inattendue :", e?.message ?? e); results.push(["exécution", false]); }
finally {
  if (created.table) await db.deleteTable({ databaseId, tableId }).catch(() => {});
  if (created.team) await teams.delete({ teamId }).catch(() => {});
  for (const id of created.users) await users.delete({ userId: id }).catch(() => {});
  console.log("Nettoyage terminé.");
}
const bad = results.filter(([, ok]) => !ok).length;
console.log(bad ? `\n${bad} vérification(s) en échec : NE PAS considérer les lectures comme isolées.` : "\nIsolation confirmée sur votre projet.");
process.exit(bad ? 1 : 0);
