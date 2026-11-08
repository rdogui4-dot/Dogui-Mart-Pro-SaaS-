# Feuille de route
1. ~~Fonctions serveur~~ fait (voir README). Reste : déploiement, webhook/API opérateur Wave & Orange pour confirmer les paiements QR automatiquement, transaction Appwrite pour supprimer la fenêtre de double application.
2. ~~Achats~~ fait : bon de commande → réception → facture fournisseur → règlement. Reste : PDF, retours fournisseur, réception sans commande, avoirs.
3. ~~Factures clients et PDF~~ fait. Reste : devis, avoirs, PDF facture fournisseur, relances WhatsApp des crédits en retard, impression Bluetooth.
4. **SaaS** : ~~plans, périodes, quotas, essai, validation des paiements~~ fait. Abonnements : paiement par liens Selar, validation manuelle (pas d'API, par choix). Relances d'expiration faites (bandeaux + liste « Relances » avec messages prêts, envoi manuel). Reste : envoi automatique (fonction planifiée + e-mail/SMS/WhatsApp si un fournisseur est configuré), factures d'abonnement PDF, PIN caissier. ~~Multi-boutiques, employés, transferts~~ fait.
5. **Compta** : grand livre, bilan/résultat simplifiés, export OHADA.
6. **Rapports** : faits (consolidés, PDF). Reste : totaux pré-calculés pour gros volumes, comparaison de périodes, rapport par vendeur, fuseau horaire par boutique.
7. **Android** : empaquetage TWA/Capacitor (APK/Play Store), impression Bluetooth 58/80 mm.
8. ~~Isolation des lectures par boutique~~ faite (à confirmer avec `npm run verify:isolation`). Tests d'intégration (Appwrite local) et e2e Playwright.
