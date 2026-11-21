import type { SQLInputValue } from "node:sqlite";
import type { SqliteStore } from "../../dmp-api/src/sqlite-store";
import type { Row } from "../../dmp-api/src/store";

/** Moteur de requêtes du serveur local : comprend les requêtes JSON produites par `Query.*` d'Appwrite (celles que l'interface utilise) et applique les droits de lecture
 *  de l'appelant (rôles de lecture posés à la création de chaque ligne, comme Appwrite). */
type Q = { method: string; attribute?: string; values?: unknown[] };
const MAX_LIMIT = 5_000, DEFAULT_LIMIT = 25;
const col = (attr: string, args: SQLInputValue[]): string => { if (attr === "$id") return "id"; if (attr === "$createdAt") return "created_at"; args.push(`$.${attr}`); return "json_extract(data, ?)"; };
const val = (v: unknown): SQLInputValue => (typeof v === "boolean" ? (v ? 1 : 0) : (v as SQLInputValue));
const like = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function cond(q: Q, args: SQLInputValue[]): string {
  const vs = q.values ?? [];
  switch (q.method) {
    case "equal": { if (!q.attribute) throw new Error("attribut manquant"); const nulls = vs.some((v) => v === null); const rest = vs.filter((v) => v !== null);
      const parts: string[] = []; if (rest.length) { const c = col(q.attribute, args); parts.push(`${c} IN (${rest.map(() => "?").join(", ")})`); args.push(...rest.map(val)); } if (nulls) parts.push(`${col(q.attribute, args)} IS NULL`);
      return parts.length ? `(${parts.join(" OR ")})` : "0"; }
    case "notEqual": { const c = col(q.attribute!, args); args.push(val(vs[0])); return `(${c} IS NOT ? )`; }
    case "lessThan": case "lessThanEqual": case "greaterThan": case "greaterThanEqual": { const op = { lessThan: "<", lessThanEqual: "<=", greaterThan: ">", greaterThanEqual: ">=" }[q.method]!; const c = col(q.attribute!, args); args.push(val(vs[0])); return `${c} ${op} ?`; }
    case "between": { const c = col(q.attribute!, args); args.push(val(vs[0]), val(vs[1])); return `${c} BETWEEN ? AND ?`; }
    case "isNull": return `${col(q.attribute!, args)} IS NULL`;
    case "isNotNull": return `${col(q.attribute!, args)} IS NOT NULL`;
    case "startsWith": { const c = col(q.attribute!, args); args.push(`${like(String(vs[0]))}%`); return `${c} LIKE ? ESCAPE '\\'`; }
    case "endsWith": { const c = col(q.attribute!, args); args.push(`%${like(String(vs[0]))}`); return `${c} LIKE ? ESCAPE '\\'`; }
    case "contains": case "search": { const c = col(q.attribute!, args); args.push(`%${like(String(vs[0]))}%`); return `${c} LIKE ? ESCAPE '\\' COLLATE NOCASE`; }
    case "or": case "and": { const inner = (vs as Q[]).map((x) => cond(x, args)); return inner.length ? `(${inner.join(q.method === "or" ? " OR " : " AND ")})` : "1"; }
    default: throw new Error(`Requête non prise en charge : ${q.method}`);
  }
}

export type QueryResult = { rows: Row[]; total: number };
/** Lit les lignes d'une table que `roles` peut lire, selon les requêtes Appwrite données (filtres, tri, limite, curseur, décalage). */
export function queryRows(store: SqliteStore, table: string, queries: string[], roles: string[]): QueryResult {
  const parsed = queries.map((s) => JSON.parse(s) as Q); const filters = parsed.filter((q) => !["limit", "offset", "orderAsc", "orderDesc", "cursorAfter", "cursorBefore", "select"].includes(q.method));
  const args: SQLInputValue[] = [table, JSON.stringify(roles)]; const where: string[] = ["tbl = ?", "EXISTS (SELECT 1 FROM json_each(read_roles) r WHERE r.value IN (SELECT value FROM json_each(?)))"];
  for (const f of filters) where.push(cond(f, args));
  const base = where.join(" AND "); const baseArgs = [...args];
  const total = Number(store.db.prepare(`SELECT COUNT(*) AS n FROM rows WHERE ${base}`).get(...baseArgs)?.n ?? 0);
  const orders = parsed.filter((q) => q.method === "orderAsc" || q.method === "orderDesc"); const limit = Math.min(MAX_LIMIT, Number(parsed.find((q) => q.method === "limit")?.values?.[0] ?? DEFAULT_LIMIT));
  const offset = Number(parsed.find((q) => q.method === "offset")?.values?.[0] ?? 0); const cur = parsed.find((q) => q.method === "cursorAfter" || q.method === "cursorBefore");
  const dirOf = (q: Q) => (q.method === "orderDesc" ? "DESC" : "ASC"); const tie = orders[0] ? dirOf(orders[0]) : "ASC"; // sans tri : ordre de création
  const orderSql: string[] = []; const orderArgs: SQLInputValue[] = []; for (const o of orders) orderSql.push(`${col(o.attribute!, orderArgs)} ${dirOf(o)}`); orderSql.push(`seq ${tie}`);
  const w2 = [base]; const a2 = [...baseArgs];
  if (cur) {
    const id = String(cur.values?.[0] ?? ""); const row = store.db.prepare("SELECT seq FROM rows WHERE tbl = ? AND id = ?").get(table, id);
    if (!row) throw new Error("Curseur introuvable");
    const after = cur.method === "cursorAfter"; const keys: { expr: string; args: SQLInputValue[]; dir: "ASC" | "DESC" }[] = orders.map((o) => { const ar: SQLInputValue[] = []; return { expr: col(o.attribute!, ar), args: ar, dir: dirOf(o) as "ASC" | "DESC" }; }); keys.push({ expr: "seq", args: [], dir: tie as "ASC" | "DESC" });
    const parts: string[] = []; const pargs: SQLInputValue[] = [];
    for (let i = 0; i < keys.length; i++) {
      const eq = keys.slice(0, i).map((k) => `${k.expr} IS (SELECT ${k.expr} FROM rows WHERE tbl = ? AND id = ?)`); const eqArgs = keys.slice(0, i).flatMap((k) => [...k.args, table, id, ...k.args]);
      const k = keys[i]!; const op = (k.dir === "ASC") === after ? ">" : "<";
      parts.push(`(${[...eq, `${k.expr} ${op} (SELECT ${k.expr} FROM rows WHERE tbl = ? AND id = ?)`].join(" AND ")})`);
      // les `?` de chaque expression de colonne (json_extract) viennent d'abord, dans l'ordre d'apparition
      pargs.push(...(keys.slice(0, i).flatMap((kk) => [...kk.args, ...kk.args, table, id])), ...k.args, ...k.args, table, id); void eqArgs;
    }
    w2.push(`(${parts.join(" OR ")})`); a2.push(...pargs);
  }
  const sql = `SELECT id, created_at, updated_at, data FROM rows WHERE ${w2.join(" AND ")} ORDER BY ${orderSql.join(", ")} LIMIT ? OFFSET ?`;
  const rows = store.db.prepare(sql).all(...a2, ...orderArgs, limit, offset) as Record<string, unknown>[];
  return { rows: rows.map((r) => ({ ...(JSON.parse(String(r.data)) as object), $id: String(r.id), $createdAt: String(r.created_at), $updatedAt: String(r.updated_at ?? r.created_at) }) as Row), total };
}
