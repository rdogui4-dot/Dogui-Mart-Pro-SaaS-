const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const { Store, handle } = require("./.build/server.cjs");
const ROOT = path.join(__dirname, ".build", "site"), PREFIX = "/Dogui-Mart-Pro-SaaS-/";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };
const T = "t1";

function applyQueries(rows, qs) {
  const match = (q, r) => {
    const v = r[q.attribute];
    switch (q.method) {
      case "equal": return q.values.some((x) => (v === x) || (v == null && x === "" && false));
      case "notEqual": return !q.values.includes(v) && v != null;
      case "or": return q.values.some((s) => match(typeof s === "string" ? JSON.parse(s) : s, r));
      case "and": return q.values.every((s) => match(typeof s === "string" ? JSON.parse(s) : s, r));
      case "search": return String(v ?? "").toLowerCase().includes(String(q.values[0]).toLowerCase());
      case "startsWith": return String(v ?? "").toLowerCase().startsWith(String(q.values[0]).toLowerCase());
      case "greaterThanEqual": return v != null && String(v) >= String(q.values[0]);
      case "greaterThan": return v != null && String(v) > String(q.values[0]);
      case "lessThan": return v != null && String(v) < String(q.values[0]);
      case "isNull": return v == null; case "isNotNull": return v != null;
      case "contains": return Array.isArray(v) ? v.includes(q.values[0]) : String(v ?? "").includes(q.values[0]);
      default: return true;
    }
  };
  let out = rows.filter((r) => qs.every((q) => !["equal", "notEqual", "or", "and", "search", "startsWith", "greaterThanEqual", "greaterThan", "lessThan", "isNull", "isNotNull", "contains"].includes(q.method) || match(q, r)));
  const ord = qs.find((q) => q.method === "orderAsc" || q.method === "orderDesc");
  if (ord) out = [...out].sort((a, b) => (String(a[ord.attribute] ?? "") < String(b[ord.attribute] ?? "") ? -1 : String(a[ord.attribute] ?? "") > String(b[ord.attribute] ?? "") ? 1 : 0) * (ord.method === "orderAsc" ? 1 : -1));
  const cur = qs.find((q) => q.method === "cursorAfter"); if (cur) out = out.slice(out.findIndex((r) => r.$id === cur.values[0]) + 1);
  const lim = qs.find((q) => q.method === "limit")?.values[0] ?? 25; const off = qs.find((q) => q.method === "offset")?.values[0] ?? 0;
  return { total: out.length, rows: out.slice(off, off + lim) };
}

async function start(opts = {}) {
  const st = new Store(); const errors = [], calls = [], bad = [];
  await st.grant(T, "u1", ["owner"], []); st.ownerNames.set("u1", "Dogui");
  const call = (action, payload = {}, shopId = "") => handle(st, "u1", { action, tenantId: T, shopId, payload }, { admins: [] });
  const shop = (await call("shop.create", { name: "Dakar Plateau" })).body.data.shopId;
  const row = st.rows("subscriptions").find((r) => r.$id === T); const sub = { tenantId: T, plan: opts.plan ?? "pro", period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() };
  if (row) Object.assign(row, sub); else await st.create("subscriptions", T, T, sub);
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x"); let f = path.join(ROOT, u.pathname.slice(1)); if (u.pathname.endsWith("/")) f = path.join(f, "index.html");
    if (u.pathname.startsWith(PREFIX) && fs.existsSync(f) && fs.statSync(f).isFile()) { res.writeHead(200, { "content-type": MIME[path.extname(f)] ?? "application/octet-stream" }); return fs.createReadStream(f).pipe(res); }
    res.writeHead(200, { "content-type": "text/html" }); fs.createReadStream(path.join(ROOT, PREFIX.slice(1), "index.html")).pipe(res);
  });
  await new Promise((r) => server.listen(0, r));
  const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 1, permissions: ["camera"] }); const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message)); page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200)); });
  const origin = `http://localhost:${server.address().port}`; let offline = false;
  await page.route("https://fra.cloud.appwrite.io/**", async (route) => {
    if (offline) return route.abort("internetdisconnected");
    const req = route.request(); const url = new URL(req.url()); const p = url.pathname;
    const cors = { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const json = (b, s = 200) => route.fulfill({ status: s, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(b) });
    if (p.includes("/storage/buckets/articles/files/")) { const id = p.split("/files/")[1].split("/")[0]; const f = st.files.get(id); return route.fulfill({ status: f ? 200 : 404, headers: { ...cors, "content-type": f?.mime ?? "text/plain" }, body: f ? Buffer.from(f.data) : "nf" }); }
    if (p.endsWith("/account")) return json({ $id: "u1", name: "Dogui", email: "x@y.sn" });
    if (p.endsWith("/teams")) return json({ total: 1, teams: [{ $id: T, name: "DOGUI MART" }] });
    if (p.includes("/memberships")) return json({ total: 1, memberships: [{ userId: "u1", roles: ["owner"] }] });
    if (p.includes("/executions")) {
      const sent = JSON.parse(JSON.parse(req.postData() ?? "{}").body ?? "{}"); const r = await handle(st, "u1", sent, { admins: [] }); calls.push([sent.action, r.status, r.status >= 400 ? r.body.error : ""]);
      if (r.status >= 400 && !(opts.expect ?? []).includes(sent.action)) bad.push(`${sent.action} → ${r.status} ${r.body.error}`);
      return json({ $id: "ex", responseStatusCode: r.status, responseBody: JSON.stringify(r.body), status: "completed" }, 201);
    }
    const m = p.match(/\/tables\/([^/]+)\/rows(?:\/([^/]+))?$/);
    if (m) {
      const [, table, id] = m; if (id) { const r = await st.get(table, id); return r ? json({ ...r }) : json({ message: "not found", code: 404 }, 404); }
      const qs = [...url.searchParams.entries()].filter(([k]) => k.startsWith("queries")).map(([, v]) => JSON.parse(v)); return json(applyQueries(st.rows(table).map((r) => ({ ...r })), qs));
    }
    return json({ message: "unmocked " + p, code: 404 }, 404);
  });
  return { handle, page, st, call, shop, errors, calls, bad, origin, setOffline: (v) => { offline = v; }, url: (p = "") => `${origin}${PREFIX}${p}`, close: async () => { await browser.close(); server.close(); } };
}
module.exports = { start };
