import { MemoryStore } from "../functions/dmp-api/src/memory-store";
import { handle } from "../functions/dmp-api/src/main";
let n = 0;
/** Base en mémoire (même moteur que les tests) : les écrans sont pilotés par un vrai navigateur contre le vrai routeur de la fonction. */
export class Store extends MemoryStore {
  async create(table: string, id: string, tenantId: string, data: Record<string, unknown>) {
    return super.create(table, id, tenantId, { $createdAt: new Date(Date.now() + (++n)).toISOString(), ...data });
  }
}
export { handle };
