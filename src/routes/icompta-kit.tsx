import { type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatFcfa } from "@/domain/money";

export const rid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 24);
export const day = (o = 0) => new Date(Date.now() + o * 864e5).toISOString().slice(0, 10);
export const fmtDay = (d: string) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");
export const money = (n: number | null | undefined) => (n === null || n === undefined ? "—" : formatFcfa(n));
export const Err = ({ e }: { e: unknown }) => (e ? <p className="text-red-400 text-sm" role="alert">{(e as Error).message}</p> : null);
export const Field = ({ label, children }: { label: string; children: ReactNode }) => <label className="text-xs text-white/60 flex flex-col gap-1">{label}{children}</label>;
export const Note = ({ children }: { children: ReactNode }) => <p className="text-[11px] text-white/40">{children}</p>;
export const Kpi = ({ label, value, tone = "" }: { label: string; value: ReactNode; tone?: string }) => <div className="card"><div className="text-white/50 text-xs">{label}</div><div className={`font-semibold text-lg ${tone}`}>{value}</div></div>;
export const useQ = <T,>(action: string, payload: object = {}, enabled = true) => { const { session } = useSession(); const s = session!; return useQuery({ queryKey: ["ic", action, s.shopId, payload], enabled, retry: 1, queryFn: () => api<T>(s, action, payload) }); };
export const useAct = (action: string, onOk?: (r: any) => void) => { const { session } = useSession(); const s = session!; const qc = useQueryClient(); return useMutation({ mutationFn: (b: object) => api<any>(s, action, b), onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ["ic"] }); onOk?.(r); } }); };
