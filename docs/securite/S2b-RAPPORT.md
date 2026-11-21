# Lot S2-b — États réels de la sécurité et rétention du journal (rapport)

Date : 2026-11-21 · Plan : `S2-PLAN.md` §4.3 · Suite de S2-a (publié, vérifié sur Appwrite).

## Livré (code et tests ; **pas encore publié**)
- **Moteur d'états** `src/domain/security-status.ts` (pur) : 7 contrôles, chacun avec état (ok / à surveiller / critique / **inconnu** / sans objet), preuve en clair, source, heure de mesure, conseil. Règle de base : **sans mesure, « inconnu »**, jamais « ok » (tests dédiés : aucune donnée ⇒ aucun « ok », aucune heure de mesure, aucun score).
  | Contrôle | Poids | Source réelle |
  |---|---|---|
  | Double authentification des propriétaires | 20 | annuaire Appwrite (`userSecurity`) ; inconnue si illisible ou sur le poste |
  | Abonnement | 10 | ligne d'abonnement |
  | Synchronisation du poste | 15 | poste Windows (inconnue vue du cloud ; sans objet si pas de poste) |
  | Sauvegardes du poste | 20 | gestionnaire de sauvegardes du poste (inconnues vues du cloud) |
  | Constats de synchronisation | 5 | journal des constats du poste |
  | Refus d'accès (24 h) | 10 | journal de sécurité du commerce |
  | Intégrité du journal | 20 | vérification de la chaîne ; journal vide = inconnu |
- **Score par règles visibles** : moyenne pondérée des seuls contrôles mesurés (ok 100 %, à surveiller 50 %, critique 0) ; **couverture** = part du poids réellement mesurée ; aucun contrôle mesuré ⇒ pas de score.
- **Limites annoncées dans la réponse** : politique de mots de passe et durée des sessions (réglages de la console Appwrite), sauvegardes du cloud, connexions échouées : non mesurables par l'application.
- **Action `security.status`** (propriétaire seulement ; lecture, donc permise aussi quand un poste héberge le commerce — défaut trouvé pendant les tests : elle était bloquée par la garde du cloud). Le poste Windows fournit ses propres mesures (sauvegardes réelles, synchronisation, constats) par une « sonde » ; il ne prétend pas mesurer la double authentification (son magasin local répond toujours « non »).
- **Rétention (D12, 13 mois)** : `purgeSecurityEvents` retire les plus anciens événements par lots atomiques et **ancre** la chaîne (numéro et empreinte du dernier événement retiré, dans le pointeur) : la suite conservée reste vérifiable ; la vérification détecte une suppression après purge ou un trou après l'ancre. Jamais le dernier événement, jamais plus récent que 13 mois (une durée plus courte est ramenée à 13 mois), refusée si la chaîne est rompue. Action **explicite** `platform.security.purge` (administrateur de la plateforme), journalisée (`security.purge`). Pas de purge automatique (règle « aucune action automatique ») : une exécution planifiée viendra avec le moniteur (S3).

## Preuves
13 tests du domaine, 16 tests serveur (`security-status.test.ts` : rôles, 2FA lue / illisible, journal vide, chaîne rompue, refus comptés, sondes du poste, isolation entre commerces, purge avec ancre, trou détecté, durée minimale, chaîne rompue refusée, action admin), 1 test du poste réel (sauvegardes mesurées). **1742 tests verts**, typecheck propre.

## À faire en production au « publie »
Ajouter deux colonnes à `security_heads` (`anchorSeq` entier, `anchorHash` texte 64) : nécessaires seulement à la purge (sans elles, la purge échouerait ; le reste fonctionne).

## Limites
- Connexions échouées et réglages de console Appwrite : non mesurables (dit à l'écran en S2-c).
- La lecture des sessions/2FA dépend du droit de la clé de la fonction : déjà utilisée par « Équipe & Permissions » ; si le droit manque, l'état est « inconnu ».
- Interface du Centre de sécurité : lot S2-c.
