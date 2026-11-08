/** Préfixe de routage à partir de la base de Vite : "/" -> aucun préfixe ; "/depot/" -> "/depot" (sans barre finale). */
export const routerBasepath = (baseUrl: string): string | undefined => {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed === "" ? undefined : trimmed;
};
