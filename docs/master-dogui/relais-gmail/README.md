# Relais gratuit Selar → MASTER DOGUI (Gmail + Google Apps Script)

Selar n'offre ni API ni webhook : on s'appuie sur l'e-mail de vente qu'il envoie au vendeur. Coût : 0 (quota Gmail/Apps Script largement suffisant).

## Sécurité
- Le jeton n'est **jamais** dans une URL visible d'un acheteur : retirez-le de la redirection Selar et **régénérez-le** (Administration › Réception des paiements), puis collez le nouveau dans `configurer()` (stocké en « Propriétés du script »), lancez, **effacez-le du code**.
- Une notification n'active une licence que si le **montant exact** et l'**e-mail du payeur** correspondent à **une seule** demande préparée par le propriétaire dans l'application. Sinon : file d'examen.
- Limite honnête : le relais fait confiance à la boîte Gmail. Un e-mail falsifié qui passerait les filtres de Gmail et imiterait le format Selar ne pourrait activer qu'une demande déjà préparée avec cet e-mail et ce montant exacts.

## Installation (≈ 10 minutes, depuis un navigateur)
1. Sur script.google.com, créer un projet avec le compte Gmail qui reçoit les ventes Selar ; coller `selar-gmail-relais.gs`.
2. **Calibrer** (le format Selar n'est pas présumé) : ouvrir un vrai e-mail de vente, repérer comment y figurent la référence de commande, le montant et l'e-mail de l'acheteur, puis ajuster `SEARCH`, `RE_REF`, `RE_AMOUNT`, `RE_EMAIL`. Ne me communiquez ce texte qu'avec e-mail et téléphone masqués.
3. Lancer `configurer()` (autoriser les accès demandés), puis effacer le jeton du code. Lancer `installer()` (déclencheur toutes les 5 minutes).
4. Administration › Réception des paiements, paramétrage des champs : référence = `ref`, montant = `amount`, e-mail = `email`, statut = `status`, valeurs de succès = `success`, devise attendue : vide (l'e-mail ne la porte pas forcément).
5. **Test** : le propriétaire prépare un paiement, paie, attend ≤ 5 min. Résultat attendu : événement « licence activée automatiquement » ; sinon, lire la note de la file d'examen. Un e-mail non reconnu arrive avec le statut `non-lu` et son texte : sert à corriger les expressions.

## Page de retour
Configurer chez Selar la redirection après achat vers `https://<votre-domaine-de-l-app>/…/merci` (**sans jeton**). La page affiche l'état réel de la demande et se rafraîchit ; elle ne confirme rien par elle-même.
