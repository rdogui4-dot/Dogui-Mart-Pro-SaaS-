# Politique de sécurité

## Signaler une vulnérabilité
Ne publiez pas la faille dans un ticket public. Utilisez le **signalement privé de GitHub** : onglet *Security* du dépôt → *Report a vulnerability*. Indiquez la version, les étapes pour reproduire et l'impact ; n'incluez jamais de données réelles de clients.

## Ce que nous faisons
- Accusé de réception, puis analyse et correction selon la gravité ; information de la personne qui a signalé.
- Aucune donnée d'un autre commerce ne doit être accessible : toute faille d'isolation entre commerces est traitée en priorité.

## Périmètre
Application web et PWA, fonctions Appwrite (`dmp-api`, `dmp-hooks`), serveur local et application Windows. Hors périmètre : déni de service, ingénierie sociale, services tiers.
