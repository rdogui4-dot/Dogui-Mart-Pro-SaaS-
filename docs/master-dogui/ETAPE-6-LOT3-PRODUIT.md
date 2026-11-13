# MASTER DOGUI — étape 6, lot 3 : produit et livraison (livré)

Décisions validées : exports PDF + Excel + CSV ; marge exacte hors périmètre (étude séparée avec le module Caisse).

## Livré
- **D1 exports PDF / Excel / CSV** (modèle commun du projet : CSV Excel FR avec BOM et neutralisation des formules, XLSX sans dépendance, PDF A4 paysage) :
  - **rapports** d'ouverture et de clôture (sections, alertes, recommandations, données manquantes — une section indisponible est exportée avec sa raison —, méthode et limites) ;
  - **liste des recommandations** telle qu'affichée (filtre de statut indiqué) ;
  - **réponse de l'assistant** (chiffres, observations, recommandations, sources, mode « rédigé par IA » ou « sans IA », question d'origine).
  Conversion pure et testée : `src/domain/master-export.ts`. Barre d'export `ExportBar` sur chaque écran.
- **D2/D4 tests navigateur** (`e2e/`, `npm run e2e:master`) : scénario sur les **5 onglets** avec vrai navigateur et vrai routeur serveur en mémoire — licence (démarrage de l'essai), rapports (génération à la clôture, exports vérifiés sur le **contenu** des fichiers : CSV avec BOM, XLSX « PK », PDF « %PDF »), profil (saisie, hypothèse confirmée, suppression), recommandations (actualisation, motif et sources, décision, export), assistant (question guidée chiffrée et sourcée, 21 sujets derrière « Plus de questions », délai de 5 s annoncé clairement, question hors sujet sans improvisation, hors connexion avec question conservée), tablette 1024 px, **aucun débordement horizontal** ni élément sans nom accessible sur chaque onglet, expiration de licence. Captures dans `e2e/out/`. Résultat : 9 scénarios sur 9 passent.
- **Correctif** relevé par ces tests : le suivi d'une recommandation acceptée affichait « aucune mesure comparable » ; il affiche maintenant la **mesure de départ** datée et annonce qu'elle sera relue à la prochaine actualisation (sans causalité).
- **D3 consigne d'exploitation** : `EXPLOITATION.md` (architecture, variables, déploiement, retour arrière, support de licence, relais Gmail, effacement, coûts et qualité de l'IA, incidents fréquents, actions du journal).
- **D5 projets de textes juridiques** : `TEXTES-JURIDIQUES-PROJET.md` (conditions d'utilisation, information sur l'IA, liste de contrôle de la politique de confidentialité), **à faire valider par un juriste** : ce ne sont pas des avis juridiques ; les points incertains sont marqués [à valider].

## Limites assumées
- Les exports reflètent l'affichage : ils ne recalculent rien ; les exports PDF volumineux sont limités à 400 lignes par section par le moteur PDF existant.
- Les tests navigateur utilisent une base en mémoire et simulent Appwrite : ils valident les écrans et le routeur, pas la latence ni les permissions réelles d'Appwrite.
- Le contrôle d'accessibilité est automatique et partiel (noms accessibles, débordement) ; pas d'audit complet au lecteur d'écran.
- Marge exacte (coût enregistré à la vente) : non traitée, touche le module Caisse.
