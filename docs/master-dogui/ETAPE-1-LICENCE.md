# MASTER DOGUI — étape 1 : licence indépendante

Aucune IA à ce stade. Cette étape pose la licence, l'essai et le mode consultation, sans toucher aux autres modules.

## Règles implémentées (cahier des charges v1.1)
- **Licence rattachée à l'entreprise**, indépendante de la formule Starter/Business/Pro et de l'abonnement principal (table `md_licenses`, une ligne par entreprise).
- **Essai gratuit de 14 jours**, sans paiement ni débit automatique, démarré explicitement par le **propriétaire**. Unique par entreprise (la ligne existe) et par propriétaire : la clé est dérivée de l'e-mail du propriétaire (`md_trials`, hachée, sans l'e-mail en clair). Une autre entreprise du même propriétaire est refusée ; l'équipe plateforme peut accorder une exception motivée (`platform.master.trial`).
- **Première période** : 15 000 FCFA pour 12 mois (règlement unique), qui commence à la fin de l'essai s'il est en cours. **Renouvellement** : 2 500 FCFA par mois (1 à 12 mois à la fois), à partir de l'échéance ou de la date d'activation si la licence a expiré.
- **Activation** : uniquement par la plateforme (`platform.master.activate`), après vérification du paiement, **idempotente** (identifiant d'opération + réservation unique), **journalisée** (`master.activate`), avec historique.
- **Expiration** : mode consultation (historique et anciens éléments accessibles ; garde `needMaster` refuse les nouvelles analyses). Les données et tous les autres modules restent intacts : la licence n'intervient dans aucune autre action.
- **Interface** (`/master`, propriétaire) : état, dates de début et de fin, début de facturation, prochaine échéance et prix, conséquences de l'expiration, historique des activations. Formulaire d'activation dans l'administration de la plateforme.

## Choix par défaut en attendant la validation de la direction (cahier 3.1, 3.2, 12)
| Point | Valeur retenue | À confirmer |
| --- | --- | --- |
| Règlement de la première période | Paiement unique de 15 000 FCFA pour 12 mois | oui |
| Délai de grâce | 0 jour (`MASTER.graceDays`, paramétrable) | oui |
| Identifiant anti-contournement | E-mail du propriétaire (haché) | oui |
| Licence multi-boutiques | Une licence pour toute l'entreprise | oui |
| Accès à la page | Propriétaire | gérant à décider |

## Limites assumées
- Le paiement n'est pas automatisé : confirmation manuelle par la plateforme (pas de webhook).
- L'e-mail est un identifiant contournable (un nouveau compte avec un autre e-mail obtient un essai) : à renforcer par un second critère si la direction le souhaite.
- Aucun rappel d'échéance n'est envoyé (prestataires externes suspendus) : la page affiche les échéances.
- La licence est tenue en UTC.

## Données (Appwrite, base `dmp`)
`md_licenses` (index unique `tenant`), `md_trials`. Permissions : propriétaire uniquement ; écritures par la fonction `dmp-api` seulement.

## Révision 1b (consignes de la direction)
- **Second critère d'essai** : le **numéro de téléphone** de la boutique principale (9 derniers chiffres, indicatifs ignorés) s'ajoute à l'e-mail du propriétaire. Le téléphone est **obligatoire** pour démarrer l'essai ; si l'un des deux critères a déjà servi pour une autre entreprise, l'essai est refusé (et aucune réservation orpheline ne reste). Limite : le téléphone est déclaré, non vérifié (la vérification par SMS reste suspendue).
- **Rappels dans l'application, pas par e-mail** : bandeau sur l'accueil et sur la page MASTER DOGUI à 7, 3 et 1 jour(s) de l'échéance, puis à l'expiration. Aucun envoi externe.
- **Paiement unique** de 15 000 FCFA pour la première année, **sans délai de grâce** (valeurs déjà retenues) ; fuseau UTC conservé.
- **Webhook de paiement** (voir ci-dessous).

### Webhook de paiement
Architecture : une fonction publique séparée `dmp-hooks` (adresse `https://dmp-hooks-dogui.fra.appwrite.run`) qui ne contient **que** le récepteur. Le routeur `dmp-api` (toutes les autres actions) reste réservé aux utilisateurs connectés.
1. Le propriétaire prépare un paiement (`md.pay.request`) : référence `MD-…`, **montant exact** et **e-mail du payeur** sont enregistrés (une demande active à la fois).
2. Il paie via le lien de paiement renseigné par l'administrateur.
3. Le prestataire notifie l'adresse secrète `…/?k=<jeton>` (jeton généré, affiché une fois, seule son empreinte est conservée).
4. Activation **automatique** seulement si : réception activée, **paramétrage des champs complet**, statut reconnu comme abouti, devise conforme si fixée, **une seule demande** avec le même e-mail et le même montant. Sinon la notification va dans la **file d'examen** de l'administrateur (validation motivée ou rejet).
5. Idempotence : une notification rejouée ne crée rien ; deux notifications simultanées n'activent qu'une fois ; tout est journalisé.

**Important — format du prestataire** : le format exact des notifications de Selar n'a pas pu être vérifié (documentation introuvable depuis cet environnement). Il n'est donc **pas présumé** : après la première notification (visible en file d'examen avec son contenu brut), l'administrateur déclare les champs (référence, montant, e-mail, statut, valeurs de succès). Tant que ce n'est pas fait, aucune activation automatique n'a lieu. Il faut aussi vérifier que Selar peut appeler une adresse avec paramètre `?k=` ; sinon, utiliser l'outil d'intégration du prestataire (type Zapier) qui relaie vers cette adresse.

Données : `md_payments`, `md_events` (le contenu brut n'est conservé que tant que le paramétrage est incomplet), `platform_settings.masterHook`.
