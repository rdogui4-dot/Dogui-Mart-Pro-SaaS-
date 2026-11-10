import { createHash } from "node:crypto";
import { fromScaled, qtyFor, scaleOf, scaledInt } from "../../../src/domain/quantity";
import { lineKey } from "../../../src/domain/variants";
import { stockScaled, stockScaledVariant } from "./checkout";
import { gate } from "./purchasing-plus";
import { returnClaimOp } from "./purchasing-claims";
import { HttpError, need, type BatchOp, type Ctx, type Store } from "./store";

const sha = (s: string) => createHash("sha1").update(s).digest("hex");
const parse = <T,>(s: unknown, fb: T): T => { try { const v = JSON.parse(String(s)); return v ?? fb; } catch { return fb; } };
type RL = { productId: string; variantId?: string; name: string; accepted: number };

/**
 * Retour fournisseur : sortie de stock tracée (mouvement « adjust » négatif, référence « retour-fournisseur:<réception> », auteur, motif).
 * Borné par ce que la réception a réellement fait entrer en stock moins les retours déjà faits ; refuse un stock négatif ; idempotent (returnKey).
 * Il ne modifie ni la commande ni la dette : l'avoir fournisseur n'existe pas encore (à traiter par litige de facture).
 */
export async function supplierReturn(store: Store, ctx: Ctx, b: { receiptId?: string; returnKey?: string; reason?: string; lines?: { productId: string; variantId?: string; qty: unknown }[] }) {
  await gate(store, ctx); need(ctx, "manager"); const r = await store.get("purchase_receipts", String(b.receiptId ?? "")); if (!r || r.tenantId !== ctx.tenantId || r.shopId !== ctx.shopId) throw new HttpError(404, "Réception introuvable"); if (r.status !== "validated") throw new HttpError(409, "Seule une réception validée (stock créé) peut faire l'objet d'un retour");
  const key = String(b.returnKey ?? "").replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 36); if (key.length < 8) throw new HttpError(400, "returnKey invalide (8 caractères au moins)"); const why = String(b.reason ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 200); if (why.length < 3) throw new HttpError(400, "Motif de retour obligatoire (3 caractères au moins)");
  const evId = `pe${sha(`${r.$id}|return|${key}`).slice(0, 30)}`; if (await store.get("purchase_events", evId)) return { duplicate: true };
  if (!b.lines?.length) throw new HttpError(400, "Aucune ligne à retourner"); const lines = parse<RL[]>(r.lines, []); const prior = (await store.list("purchase_events", { entityId: r.$id }, 1000)).filter((e) => e.kind === "return"); const returned = new Map<string, number>();
  for (const e of prior) for (const l of (parse<{ lines?: { productId: string; variantId?: string; qty: number }[] }>(e.detail, {}).lines ?? [])) returned.set(lineKey(l as never), (returned.get(lineKey(l as never)) ?? 0) + Number(l.qty));
  const ops: BatchOp[] = []; const detail: { productId: string; variantId?: string; name: string; qty: number }[] = []; const seen = new Set<string>(); let i = 0;
  for (const w of b.lines) { const l = lines.find((x) => lineKey(x as never) === lineKey(w as never)); if (!l) throw new HttpError(400, "Article absent de cette réception"); if (seen.has(lineKey(l as never))) throw new HttpError(400, `Ligne en double : ${l.name}`); seen.add(lineKey(l as never));
    const p = await store.get("products", l.productId); const scale = scaleOf(p); let q: number; try { q = qtyFor(w.qty, scale); } catch (e) { throw new HttpError(400, `${l.name} : ${(e as Error).message}`); }
    const left = Math.round((l.accepted - (returned.get(lineKey(l as never)) ?? 0)) * 1e6) / 1e6; if (q > left) throw new HttpError(409, `${l.name} : au plus ${left} peuvent encore être retournés (acceptés ${l.accepted}, déjà retournés ${returned.get(lineKey(l as never)) ?? 0})`);
    const stock = l.variantId ? await stockScaledVariant(store, l.variantId) : await stockScaled(store, l.productId); if (scaledInt(q, scale) > stock) throw new HttpError(409, `${l.name} : stock insuffisant pour ce retour (${fromScaled(stock, scale)} en stock)`);
    ops.push({ kind: "create", table: "stock_moves", id: `rf${sha(`${r.$id}|${key}|${i++}`).slice(0, 30)}`, tenantId: ctx.tenantId, data: { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: l.productId, ...(l.variantId ? { variantId: l.variantId } : {}), qty: -scaledInt(q, scale), kind: "adjust", refId: `retour-fournisseur:${r.number}`.slice(0, 64), userId: ctx.userId } }); ops.push(await returnClaimOp(store, ctx, r, l, q, `${key}|${i}`, why)); detail.push({ productId: l.productId, ...(l.variantId ? { variantId: l.variantId } : {}), name: l.name, qty: q }); }
  ops.push({ kind: "create", table: "purchase_events", id: evId, tenantId: ctx.tenantId, data: { tenantId: ctx.tenantId, shopId: ctx.shopId, entityType: "receipt", entityId: r.$id, kind: "return", userId: ctx.userId, at: new Date().toISOString(), detail: JSON.stringify({ reason: why, lines: detail }) } }, { kind: "create", table: "audit_log", id: crypto.randomUUID().replace(/-/g, "").slice(0, 30), tenantId: ctx.tenantId, data: { tenantId: ctx.tenantId, shopId: ctx.shopId, userId: ctx.userId, action: "supplier.return", detail: `${r.number} ${detail.map((d) => `${d.name}×${d.qty}`).join(",")} ${why}`.slice(0, 1000) } });
  await store.batch(ops); return { duplicate: false, moves: detail.length, reference: `retour-fournisseur:${r.number}`, note: "Le stock est diminué ; la dette fournisseur n'est pas modifiée (traitez l'avoir par un litige sur la facture)." };
}
