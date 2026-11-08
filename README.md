# Dogui Mart Pro SaaS

Gestion de commerce **pour Android** : PWA installable (TanStack Router/Query + React 19 + Tailwind 4) sur **Appwrite** (Auth, Teams, TablesDB). Inspiré des modules d'Odoo (POS, stock, achats, compta) et de Dolibarr (tiers, factures), adapté au petit commerce africain (FCFA, Mobile Money, SYSCOHADA, hors-ligne).

## Démarrage
```bash
npm install
cp .env.example .env        # renseigner endpoint + projet Appwrite
APPWRITE_API_KEY=... npm run appwrite:setup   # crée base + tables (idempotent)
npm run dev                 # ouvrir sur Android Chrome puis "Ajouter à l'écran d'accueil"
npm run typecheck && npm test && npm run build
```

## Architecture
- **Multi-tenant** : un commerçant = une *Team* Appwrite (rôles `owner` / `manager` / `cashier`). Chaque ligne porte `tenantId` + `shopId` et des droits de ligne basés sur la Team (`rowPerms`).
- **Domaine pur et testé** (`src/domain`) : montants FCFA, encaissement, fidélité, crédit client, stock par mouvements immuables, écritures SYSCOHADA équilibrées, passerelle Mobile Money.
- **Hors-ligne** : les ventes sont mises en file (IndexedDB) avec un `clientId` unique (idempotent) puis synchronisées ; service worker pour le shell.
- **Scan** caméra via `BarcodeDetector` (Chrome Android).

## État réel (v2.0.0-alpha)
Fonctionnel : connexion/création de commerce, caisse (scan, espèces/crédit), stock par mouvements + inventaire, clients, fournisseurs, journal comptable généré à chaque vente, balance des comptes, rôles côté interface.

**Pas encore fait** (voir `ROADMAP.md`) : Mobile Money réel (la passerelle **refuse** tout paiement tant qu'elle n'est pas configurée), mise à jour serveur du crédit client et des points (nécessite une Appwrite Function), bons de commande/réception, factures PDF, abonnements/quotas, gestion multi-boutiques, paiement des abonnements. Les droits de rôle sont aussi à renforcer côté serveur ; l'interface seule ne suffit pas.
Non testé contre un vrai projet Appwrite : le script de setup et la couche données n'ont été vérifiés que par compilation.
