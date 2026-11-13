# MASTER DOGUI — étape 6, lot 1 : sécurité et données (livré)

Décisions validées (défauts de l'audit) : 15 questions/jour/utilisateur et 1 question/5 s ; masquage des téléphones et e-mails ; purges 30 jours / 12 mois / 90 jours.

## Ce qui est livré
- **A1 — réception publique des paiements (`dmp-hooks`)** : un jeton absent ou de forme invalide (autre que 32 à 64 caractères alphanumériques) est rejeté (404) **sans aucune lecture de base** ; corps trop volumineux refusé avant toute lecture ; configuration mise en cache 30 s (une rafale de faux jetons ne relit pas la base) ; frein de rafale par instance : plus de 30 jetons invalides par minute = 429 immédiat. Contrepartie : un changement de jeton peut mettre jusqu'à 30 s à s'appliquer ; un attaquant peut faire refuser ~1 min les envois légitimes (le relais Gmail rejoue, car il ne marque un e-mail traité qu'après une réponse 2xx).
- **A2 — assistant : limites par utilisateur** (en plus des 30/jour par entreprise) : 15 questions par jour et par utilisateur, délai minimal de 5 s entre deux questions, 429 clair. Variables facultatives de `dmp-api` : `MASTER_CHAT_USER_DAILY` (1–1000), `MASTER_CHAT_MIN_INTERVAL_MS` (0–60 000). Limite : le plafond personnel est vérifié avant réservation (deux demandes simultanées du même utilisateur peuvent dépasser de 1) ; le plafond d'entreprise, lui, est atomique.
- **A3 — minimisation** : téléphones (8 à 15 chiffres, hors montants groupés par milliers comme « 1 000 000 ») et e-mails remplacés par `[numéro]` / `[e-mail]` **avant stockage et avant transmission** à Gemini ; la valeur d'origine n'est jamais conservée.
- **A4/A5 — purges au fil des consultations (pas de planificateur)** : contenu brut des notifications de paiement effacé à la décision finale ou après 30 jours ; notifications décidées supprimées après 12 mois ; lignes de décompte des questions supprimées après 90 jours ; 100 opérations au plus par appel ; l'audit et les rapprochements ne sont pas touchés.
- **A6 — échecs tracés** : accroche de clôture en échec : `master.hook.failed` ; suivi des recommandations de rapports en échec : `master.reco.failed` (la clôture et le rapport restent valides).
- **Appwrite** : index `tenantonly` sur `md_usage` (disponible). Fonctions `dmp-api` et `dmp-hooks` redéployées ; vérification réelle : un jeton mal formé reçoit 404 immédiatement.

## À faire de votre côté (non faisable par moi)
- **Règle de limitation de débit Appwrite** sur le domaine `dmp-hooks-dogui.fra.appwrite.run` : console Appwrite › projet › Network/Firewall › nouvelle règle « rate limit » (par exemple 60 requêtes par minute et par adresse). Elle protège avant même que la fonction ne démarre ; la disponibilité de cette option dépend de votre offre Appwrite (à vérifier dans la console).

## Tests (1 418 au total, 13 nouveaux)
Jeton invalide sans lecture de base ; cache de configuration ; délai et plafond personnels ; variables ; masquage (téléphones, e-mails, montants conservés) ; question stockée masquée ; purges des notifications et du décompte ; effacement à la décision ; échecs tracés.
