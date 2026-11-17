/** Illustration de devanture (carte boutique de la barre latérale, kit 24 interfaces). Décorative : aucune photo n'est inventée ;
 *  le logo réel de la boutique la remplacera quand le profil boutique le permettra. */
export function ShopArt({ size = 48, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="12" fill="#1f3d66" />
      <rect x="10" y="26" width="44" height="28" rx="2" fill="#e8eef6" />
      <rect x="15" y="33" width="15" height="12" rx="1.5" fill="#9ec5ff" />
      <path d="M17 41h11M17 38h8" stroke="#2563eb" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="34" y="33" width="14" height="21" rx="1.5" fill="#10243a" />
      <circle cx="45" cy="44" r="1.2" fill="#d6a84f" />
      <path d="M8 18h48l-2 9H10z" fill="#d6a84f" />
      {[0, 1, 2, 3, 4, 5].map((i) => <path key={i} d={`M${10 + i * 8} 18h4l-0.4 9h-3.8z`} fill="#ffffff" opacity="0.9" />)}
      <path d="M10 27a4 4 0 0 0 8 0a4 4 0 0 0 8 0a4 4 0 0 0 8 0a4 4 0 0 0 8 0a4 4 0 0 0 8 0a4 4 0 0 0 4 3.5" fill="none" stroke="#c99a3e" strokeWidth="1.4" />
      <rect x="12" y="10" width="40" height="8" rx="2" fill="#10243a" />
      <circle cx="18" cy="14" r="1.6" fill="#d6a84f" />
      <path d="M22 14h24" stroke="#e8eef6" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
