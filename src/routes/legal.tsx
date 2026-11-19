/** Pages publiques « Conditions d'utilisation » et « Politique de confidentialité » (accessibles sans compte). */
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/Logo";
import { CONDITIONS, CONFIDENTIALITE, type LegalDoc } from "@/domain/legal";

export const legalDocAt = (path: string): LegalDoc | null => (/\/conditions\/?$/.test(path) ? CONDITIONS : /\/confidentialite\/?$/.test(path) ? CONFIDENTIALITE : null);
export const legalHref = (slug: LegalDoc["slug"]) => `${import.meta.env.BASE_URL}${slug}`;

export function LegalPage({ doc }: { doc: LegalDoc }) {
  const other = doc.slug === "conditions" ? CONFIDENTIALITE : CONDITIONS;
  return (
    <div className="min-h-dvh bg-[var(--bg)]">
      <header className="border-b border-line bg-surface"><div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between gap-3"><a href={import.meta.env.BASE_URL} aria-label="Accueil"><Logo size={40} /></a><a className="text-sm text-accent-text inline-flex items-center gap-1" href={import.meta.env.BASE_URL}><ArrowLeft size={16} aria-hidden="true" />Retour à l'application</a></div></header>
      <main className="mx-auto max-w-3xl px-4 py-8 flex flex-col gap-6">
        <div><h1 className="text-3xl font-bold">{doc.title}</h1><p className="text-sm text-muted mt-1">Version du {doc.version}</p><p className="mt-3 text-soft">{doc.intro}</p></div>
        <nav aria-label="Sommaire" className="card !p-4"><ul className="grid gap-1 sm:grid-cols-2 text-sm">{doc.sections.map((s, i) => <li key={s.h}><a className="text-accent-text underline" href={`#s${i + 1}`}>{s.h}</a></li>)}</ul></nav>
        {doc.sections.map((s, i) => <section key={s.h} id={`s${i + 1}`} aria-labelledby={`h${i + 1}`} className="flex flex-col gap-2"><h2 id={`h${i + 1}`} className="text-xl font-semibold">{s.h}</h2>{s.p.map((t, k) => <p key={k} className="leading-relaxed">{t}</p>)}</section>)}
        <footer className="border-t border-line pt-4 text-sm text-muted flex flex-wrap gap-x-4 gap-y-1"><a className="text-accent-text underline" href={legalHref(other.slug)}>{other.title}</a><a className="text-accent-text underline" href={`${import.meta.env.BASE_URL}presentation/`}>Présentation de DOGUI MART PRO</a></footer>
      </main>
    </div>
  );
}
