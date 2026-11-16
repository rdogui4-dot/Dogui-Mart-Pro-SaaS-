import { MemoryStore } from "./memory-store";

/** Dans les tests de fonctions métier, les boutiques de départ ne sont pas soumises à la session de caisse obligatoire (sinon chaque test devrait ouvrir une caisse).
 *  Les tests de l'obligation elle-même (cashier.test.ts) la rétablissent explicitement. */
MemoryStore.defaults.shops = { cashRequired: false };
