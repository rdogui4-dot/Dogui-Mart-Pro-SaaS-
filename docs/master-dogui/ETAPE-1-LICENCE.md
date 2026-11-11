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
