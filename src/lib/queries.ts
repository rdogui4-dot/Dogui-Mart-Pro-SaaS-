import { useQuery } from "@tanstack/react-query";
import { listAll, stockLevels, type Product, type VariantRow } from "./data";
import { useSession } from "./session";

/** Lectures partagées entre les écrans : une seule requête (et un seul cache) par donnée, au lieu d'une copie par écran. */
export function useStockLevels() {
  const { session } = useSession(); const s = session!;
  return useQuery({ queryKey: ["stock", s.shopId], queryFn: () => stockLevels(s), staleTime: 15_000 });
}
export function useProductsAll(enabled = true) {
  const { session } = useSession(); const s = session!;
  return useQuery({ queryKey: ["products-all", s.shopId], enabled, queryFn: () => listAll<Product & { imageFileId?: string }>("products", s), staleTime: 15_000 });
}
export function useVariantsAll(enabled = true) {
  const { session } = useSession(); const s = session!;
  return useQuery({ queryKey: ["variants-every", s.shopId], enabled, queryFn: () => listAll<VariantRow>("article_variants", s), staleTime: 15_000 });
}
