# Refonte UI/UX — système de mouvement et page publique (version de travail)

Date : 15/11/2026. Directive du propriétaire : *fluide, très professionnel, sans effet « IA » décoratif.* Les compétences « animation-motion-design-web », « strategie-animation-par-contenu » et « effets-futuristes-ia » ont été appliquées **dans cette limite** : on garde leurs règles de performance, d'accessibilité et d'honnêteté, et on n'utilise pas leurs effets décoratifs (aurore, néon, verre dépoli, glitch, particules, grille cyber).

## Système de mouvement (application)
| Événement | Effet | Durée / courbe | Repli mouvement réduit |
|---|---|---|---|
| Changement de page | fondu + 6 px vers le haut | 200 ms, ease-out | aucun mouvement |
| Ouverture d'une fiche plein écran | fondu + 14 px | 200 ms, ease-out | aucun |
| Confirmation, notification | fondu + 6 px | 120 ms | aucun |
| Survol bouton / carte | changement de teinte | transition courte | conservé (pas de déplacement) |
| Assistant MASTER DOGUI en attente de réponse | trois points + « analyse vos données… » (`role="status"`) | boucle 1,2 s | points fixes |
Règles : seulement `opacity` et `transform` ; rien ne retarde l'accès au contenu ; tout est neutralisé par `prefers-reduced-motion`.
Les « effets d'IA » ne sont affichés que pour un **état réel** (requête en cours), jamais simulés.

## Page publique `/presentation/` — plan d'animation
| Section | Effet | Déclencheur | Poids | Repli |
|---|---|---|---|---|
| En-tête, titre, appel à l'action | aucun (affichés immédiatement) | — | 0 | — |
| Cartes de fonctions et d'offres | **un seul effet signature** : apparition décalée (opacité + 16 px, 60 ms entre cartes) | entrée dans l'écran (IntersectionObserver) | < 1 Ko de CSS/JS | contenu visible sans JavaScript et en mouvement réduit |
Aucune image lourde, aucune bibliothèque, aucune vidéo : page statique d'environ 12 Ko.

## Contenu : sources
Tarifs et limites = `DEFAULT_PLANS` (un test unitaire compare la page et la configuration) ; MASTER DOGUI = règles de `domain/master.ts` ; fonctions = `domain/features.ts`. Aucun contact public tant que vous n'en avez pas fourni ; aucune condition juridique tant qu'elle n'est pas validée.
