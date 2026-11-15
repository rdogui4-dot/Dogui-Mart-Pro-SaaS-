# Refonte UI/UX — Phase 4 : site public et démarrage (audit et plan)

Date : 15/11/2026 · Statut : **à valider avant code** (contenu public = engagement vis-à-vis des clients).
Phases 1 à 3 publiées. Décision D3 actée : pas de nom de domaine, adresse GitHub Pages.

## 1. Audit de l'existant
| Constat | Source | Conséquence |
|---|---|---|
| La racine du site **est** l'application ; sans compte, on arrive directement sur « Connexion / Créer mon commerce » avec une ligne de présentation | `main.tsx`, `auth.tsx` | aucune page de présentation, rien d'indexable, rien à partager à un prospect |
| Le site est une application mono-page : le HTML servi ne contient pas de contenu (rendu par JavaScript) | `index.html` | un moteur de recherche ou un aperçu de lien (WhatsApp) ne voit presque rien |
| Adresses sensibles qui dépendent de la racine : retour Selar `/merci`, lien de récupération de mot de passe, `start_url` et `scope` du manifeste, service worker | `redirects`, `auth.tsx`, `manifest.webmanifest`, `sw.js` | **déplacer l'application casserait ces liens et les installations existantes** → à éviter |
| Inscription en une étape : e-mail/identifiant + mot de passe + nom + commerce ; création de l'entreprise et de la première boutique ; essai MASTER séparé | `auth.tsx`, `tenant-setup.tsx` | pas de vérification d'e-mail, pas de guide de démarrage après l'inscription |
| Après inscription, l'utilisateur arrive sur l'accueil (désormais organisé en espaces) sans indication des premières étapes | `home.tsx` | risque d'abandon : « par quoi commencer ? » |
| Tarifs : `DEFAULT_PLANS` (Starter 7 500 / Business 15 000 / Pro 40 000 FCFA par mois, limites boutiques/utilisateurs/articles) ; la plateforme peut les **surcharger** (`mergePlans`) | `domain/subscriptions.ts` | une page statique ne peut afficher que les valeurs par défaut : risque d'écart avec une surcharge |
| MASTER DOGUI : essai 14 jours sans paiement, 15 000 FCFA la première période de 12 mois, puis 2 500 FCFA/mois | `domain/master.ts` | à présenter tel quel, sans embellir |
| Textes juridiques : projets non relus par un juriste | `docs/master-dogui/TEXTES-JURIDIQUES-PROJET.md` | **ne pas publier** de conditions/confidentialité présentées comme définitives |
| Aucun e-mail ni numéro de contact officiel dans le dépôt | recherche | à fournir par vous ; jamais inventé |

## 2. Décisions proposées
| # | Décision | Recommandation | Pourquoi |
|---|---|---|---|
| B1 | **Où mettre la page publique** | une page **statique réelle** (HTML + CSS, sans JavaScript indispensable) à `/presentation/` sur la même adresse GitHub Pages ; l'application reste à la racine | zéro lien cassé (Selar, récupération, installation), contenu lisible par les moteurs de recherche et les aperçus de lien, aucune dépendance au rendu JavaScript |
| B2 | Lien depuis l'application | « Découvrir Dogui Mart Pro » sur l'écran de connexion ; « Se connecter / Essayer » sur la page publique | parcours dans les deux sens |
| B3 | Contenu de la page | accueil (promesse, 3 preuves vérifiables : hors ligne, multi-boutiques, FCFA), fonctionnalités (tirées de la liste réelle des fonctions), offres (tarifs par défaut + mention « les tarifs en vigueur s'affichent dans l'application »), MASTER DOGUI, questions fréquentes, contact | **aucun** témoignage, chiffre de clientèle, logo de client ou promesse non vérifiable |
| B4 | Textes juridiques | page « Mentions et confidentialité » **non publiée** tant que le juriste n'a pas validé ; un lien « à venir » n'est pas affiché | éviter un engagement faux |
| B5 | **Vérification d'e-mail** | envoi à l'inscription (e-mail système Appwrite), page de retour `?userId=&secret=` comme pour la récupération de mot de passe ; **non bloquante** : bandeau « Confirmez votre adresse » avec renvoi ; l'identifiant sans e-mail réel reste possible (déjà géré) | ne coupe pas l'accès de ceux qui n'ont pas d'e-mail ; à valider en réel (dépend de l'envoi d'e-mails du projet Appwrite) |
| B6 | **Guide de démarrage** | liste de 5 étapes sur l'accueil : coordonnées de la boutique, premier article, ouverture de la caisse, première vente, ajout d'un collaborateur (+ choix de la formule) ; l'état est **déduit des données réelles** (rien n'est coché à la main), masquable par appareil ; visible seulement au propriétaire et tant que tout n'est pas fait | pas de table à créer, pas de fausse progression |
| B7 | Écran d'inscription | trois champs essentiels d'abord (nom du commerce, identifiant/e-mail, mot de passe) ; « votre nom » conservé ; textes plus courts ; messages d'erreur clairs | moins de friction, aucune règle métier modifiée |
| B8 | Aperçu de lien (titre, description, image) | balises de base sur la page publique et l'application ; image = logo existant | partage WhatsApp lisible |
| B9 | Tarifs sur la page publique | générés **à la compilation** depuis `DEFAULT_PLANS` (une seule source), jamais recopiés à la main | évite les écarts ; un test compare page et configuration |

## 3. Informations à me fournir (rien n'est inventé)
1. **Contact public** : numéro WhatsApp et/ou e-mail à afficher (ou « aucun pour l'instant »).
2. **Nom commercial** exact à afficher (« Dogui Mart Pro » ?) et éventuel slogan que vous souhaitez ; sinon je propose une phrase sobre.
3. Acceptez-vous B5 (vérification d'e-mail non bloquante, à tester avec un vrai envoi) ?

## 4. Plan de réalisation
1. Page statique `public/presentation/` (HTML sémantique, CSS aux jetons du design system, thème clair, lisible sans JavaScript, accessible : contrastes validés, navigation clavier, titres hiérarchisés) + script de génération des tarifs.
2. Liens croisés + balises d'aperçu.
3. Guide de démarrage (composant d'accueil, données réelles) + test unitaire de la logique d'étapes.
4. Vérification d'e-mail (envoi, retour, bandeau) + scénario de test avec simulation, puis **test réel avec votre e-mail** avant de la déclarer fonctionnelle.
5. Écran d'inscription simplifié.
6. Vérifications : types, tests, suite navigateur comparée à la liste de référence, captures téléphone/ordinateur, contraste, Lighthouse accessibilité/SEO de la page publique.
7. Publication **après votre relecture des captures** (option B).

## 5. Ce que je ne ferai pas
Déplacer l'application, publier des conditions juridiques non validées, afficher des chiffres de clientèle ou des témoignages, collecter des e-mails de prospects (pas de formulaire de « newsletter » : aucun envoi externe n'est activé).
