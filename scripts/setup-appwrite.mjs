// Crée la base et les tables Appwrite (idempotent). Usage : APPWRITE_API_KEY=... npm run appwrite:setup
import { Client, TablesDB } from "node-appwrite";
import { TABLES } from "./schema.mjs";

const { VITE_APPWRITE_ENDPOINT: endpoint, VITE_APPWRITE_PROJECT_ID: project, APPWRITE_API_KEY: key } = process.env;
const databaseId = process.env.VITE_APPWRITE_DATABASE_ID || "dmp";
if (!endpoint || !project || !key) { console.error("Variables manquantes : VITE_APPWRITE_ENDPOINT, VITE_APPWRITE_PROJECT_ID, APPWRITE_API_KEY"); process.exit(1); }

const db = new TablesDB(new Client().setEndpoint(endpoint).setProject(project).setKey(key));
const exists = async (fn) => { try { await fn(); return true; } catch { return false; } };

if (!(await exists(() => db.get({ databaseId })))) await db.create({ databaseId, name: "Dogui Mart Pro" });

for (const [tableId, { cols, idx }] of Object.entries(TABLES)) {
  if (!(await exists(() => db.getTable({ databaseId, tableId })))) {
    // rowSecurity: les droits sont posés par ligne (Team du commerçant) à l'écriture.
    await db.createTable({ databaseId, tableId, name: tableId, permissions: [], rowSecurity: true });
    for (const c of cols) {
      const p = { databaseId, tableId, key: c.key, required: !!c.required };
      if (c.type === "s") await db.createStringColumn({ ...p, size: c.size });
      if (c.type === "i") await db.createIntegerColumn(p);
      if (c.type === "f") await db.createFloatColumn(p);
      if (c.type === "b") await db.createBooleanColumn(p);
      if (c.type === "d") await db.createDatetimeColumn(p);
    }
    console.log("table créée :", tableId);
    // Les colonnes sont créées en asynchrone : laisser Appwrite les rendre disponibles avant les index.
    await new Promise((r) => setTimeout(r, 4000));
    for (const [name, columns, type] of idx) await db.createIndex({ databaseId, tableId, key: name, type: type ?? "key", columns });
  } else console.log("table existante :", tableId);
}
console.log("OK");
