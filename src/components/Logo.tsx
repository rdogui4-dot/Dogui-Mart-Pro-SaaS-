/** Logo Dogui Mart Pro (2026) : symbole « M » et point or, nom « DOGUI » (gras) « MART PRO » (léger). Le symbole d'application est une tuile bleu nuit. */
export function LogoMark({ size = 40 }: { size?: number }) {
  return <img src={`${import.meta.env.BASE_URL}icon.svg`} width={size} height={size} alt="" aria-hidden="true" className="shrink-0" />;
}
export function Wordmark({ size = 16, className = "" }: { size?: number; className?: string }) {
  return <span className={`whitespace-nowrap leading-none tracking-tight ${className}`} style={{ fontSize: size }}><span className="font-bold">DOGUI</span> <span className="font-light">MART PRO</span></span>;
}
export function Logo({ size = 40, tagline = false }: { size?: number; tagline?: boolean }) {
  return (
    <span className="inline-flex items-center gap-3">
      <LogoMark size={size} />
      <span className="flex flex-col">
        <Wordmark size={size * 0.46} className="text-main" />
        {tagline && <span className="text-muted mt-1.5" style={{ fontSize: size * 0.28 }}>Gestion de commerce</span>}
      </span>
    </span>
  );
}
