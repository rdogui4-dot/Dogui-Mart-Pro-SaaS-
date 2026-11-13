/** Logo Dogui Mart Pro : symbole (chariot, « D », flèche de croissance) et, en option, le nom. */
export function LogoMark({ size = 40 }: { size?: number }) {
  return <img src={`${import.meta.env.BASE_URL}icon.svg`} width={size} height={size} alt="" aria-hidden="true" className="shrink-0" />;
}
export function Logo({ size = 40, tagline = false }: { size?: number; tagline?: boolean }) {
  return (
    <span className="inline-flex items-center gap-3">
      <LogoMark size={size} />
      <span className="flex flex-col leading-none">
        <span className="text-accent-text font-extrabold tracking-wide" style={{ fontSize: size * 0.5 }}>DOGUI MART</span>
        <span className="font-semibold text-soft" style={{ fontSize: size * 0.34, letterSpacing: "0.5em", marginTop: size * 0.08 }}>PRO</span>
        {tagline && <span className="text-muted mt-1" style={{ fontSize: size * 0.28 }}>Gestion de commerce</span>}
      </span>
    </span>
  );
}
