# Dogui Mart Pro — version Windows

Application Electron (Windows x64) : le **poste principal** garde les données du commerce (SQLite) et les partage en HTTPS aux autres appareils du magasin ; un **poste secondaire** s'y connecte. Voir `docs/refonte-ui/KIT-24-AUDIT-ET-PLAN.md` (§47).

## Construire
```
npm install                 # à la racine
npm run desktop:build       # application web + code du poste → desktop/dist, desktop/resources
cd desktop && npm install
npm run dist                # installateur NSIS dans desktop/dist-installer (à lancer sous Windows ou en CI windows-latest)
```
`npm run dist` exige Windows (le désinstalleur NSIS est produit en l'exécutant). Depuis Linux, `npx electron-builder --win --dir` produit le dossier non empaqueté (utile pour vérifier le contenu).

## Essayer sans installer
`cd desktop && npx electron . ` (sous Linux sans écran : `xvfb-run -a npx electron . --no-sandbox`). Données : dossier utilisateur de l'application (`--user-data-dir=…` pour en choisir un).

## Choix de conception
- **Electron 45** : Node 24 embarqué (la version est figée avec l'application, indépendante du PC) ; `node:sqlite` testé dans cette version.
- **Sécurité** : page de l'application isolée (pas de Node, contexte isolé, bac à sable) ; le pont `window.dogui` n'existe que sur les écrans internes ; navigation limitée à l'origine du poste ; certificat auto-signé accepté **uniquement** s'il a exactement l'empreinte attendue (celle du poste, ou celle validée par l'utilisateur pour un secondaire) ; adresses du poste principal limitées au réseau local.
- **Installateur** : pour toutes les sessions (droits administrateur), règle de pare-feu entrante limitée aux réseaux **privés**, supprimée à la désinstallation ; les données ne sont jamais supprimées. **Non signé** pour l'instant : Windows affiche « Éditeur inconnu » (Plus d'infos → Exécuter quand même).
- **Mises à jour** : GitHub Releases du dépôt ; téléchargement en arrière-plan, installation seulement sur décision de l'utilisateur.
- **Sauvegardes** : une copie par jour dans `sauvegardes/` (7 conservées), plus une copie avant toute restauration.
