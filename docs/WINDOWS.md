# Dogui Mart Pro pour Windows — guide d'installation et d'utilisation

Dogui Mart Pro pour Windows garde les données de votre commerce **sur un ordinateur du magasin** (le *poste principal*), les partage aux autres appareils du magasin (caisses, téléphones) et les **copie automatiquement dans le cloud** dès qu'Internet est disponible. Sans Internet, la caisse continue de fonctionner.

## 1. Ce qu'il vous faut
- Un PC sous **Windows 10 ou 11 (64 bits)**, allumé pendant les heures d'ouverture. Il sera le poste principal.
- Votre compte Dogui Mart Pro (propriétaire).
- Pour les téléphones et autres PC : le **même réseau** (Wi-Fi ou câble) que le poste principal.

## 2. Installer
1. Téléchargez **« Dogui Mart Pro Setup x.y.z.exe »** depuis la page *Releases* du projet sur GitHub.
2. Double-cliquez. **Windows affichera « Windows a protégé votre ordinateur » (éditeur inconnu)** : l'installateur n'est pas encore signé numériquement. Cliquez sur **« Informations complémentaires »**, puis **« Exécuter quand même »**. Vous pouvez comparer l'empreinte SHA-256 du fichier avec celle publiée avec la version.
3. Acceptez la demande d'**autorisation administrateur** (nécessaire pour la règle du pare-feu) et suivez l'assistant. L'application s'installe pour **tous les utilisateurs** du PC.
4. L'installation crée une règle de **pare-feu Windows** « Dogui Mart Pro » limitée aux **réseaux privés** (jamais le Wi-Fi public), pour que les autres appareils du magasin puissent joindre le poste principal.

## 3. Premier lancement
Choisissez :
- **Poste principal** — ce PC garde les données. *Un seul par commerce.*
- **Poste secondaire** — ce PC se connecte à un poste principal déjà installé (voir §6).

### Nouveau commerce (sans compte cloud)
Sur le poste principal, créez le compte propriétaire, l'entreprise et la boutique comme d'habitude. Tout reste sur ce PC.

### Commerce déjà dans le cloud
Sur l'écran de connexion d'un poste principal **vierge**, cliquez **« Rattacher ce poste à mon commerce cloud »**, saisissez votre e-mail et mot de passe cloud, donnez un nom au poste (ex. « Caisse principale »). Le commerce est téléchargé ; le poste devient la **référence** (ventes, stock, caisse) et le cloud devient un **miroir** (consultation, rapports, abonnement). Tant que ce poste héberge, le cloud refuse les saisies d'exploitation : une seule saisie, pas de doublon. Vous pouvez **rendre le commerce au cloud** à tout moment (Paramètres → Synchronisation).

## 4. Utiliser les autres appareils du magasin
Sur le poste principal : **Paramètres → Réseau local**. Vous y voyez les adresses (par exemple `https://192.168.1.20:8443`), un **QR code** à scanner avec le téléphone, l'**empreinte du certificat** et les **appareils connectés** (vous pouvez en déconnecter un).

Sur chaque téléphone ou tablette, ouvrez la page **« Connecter un appareil »** (`/connect` du poste principal) et **approuvez le certificat de sécurité** une fois (le navigateur affichera sinon un avertissement et refusera la caméra). Les caissiers se connectent ensuite avec leur identifiant et mot de passe.

## 5. Synchronisation avec le cloud (Paramètres → Synchronisation)
- **État** : dernière synchronisation réussie, éléments en attente, connexion cloud.
- **Synchroniser maintenant**, **Reconnecter au cloud** (si la session a expiré).
- **Constats à examiner** : ce que la synchronisation a dû arbitrer (suppression côté cloud, modification des deux côtés, refus). Rien n'est appliqué automatiquement ; vous examinez puis marquez « examiné ».
- **Alerte** : un bandeau (propriétaire seulement) apparaît si le poste n'a pas synchronisé depuis X heures (24 h par défaut, réglable).
- **Rétablir depuis le cloud** : si les données du poste sont abîmées. Une copie de sécurité est faite avant ; refusé tant que des éléments ne sont pas envoyés.
- **Rendre au cloud** : le cloud reprend la saisie, ce poste cesse de synchroniser.

## 6. Poste secondaire
1. Installez Dogui Mart Pro sur l'autre PC, choisissez **Poste secondaire**.
2. Saisissez l'adresse du poste principal (affichée dans *Paramètres → Réseau local*), par exemple `192.168.1.20` ou `dogui.local`. Seules les adresses du réseau local sont acceptées.
3. **Comparez l'empreinte** affichée avec celle du poste principal (*Paramètres → Réseau local → Certificat de sécurité*). Si elles sont identiques, cochez la case et connectez-vous. L'empreinte est alors mémorisée : un autre appareil se faisant passer pour le poste principal sera refusé.

## 7. Sauvegardes
- **Automatiques** : une copie de la base par jour dans `%APPDATA%\Dogui Mart Pro\sauvegardes` (les 7 dernières sont gardées), plus une copie avant toute restauration.
- Pensez à **copier ce dossier régulièrement sur un support externe** : une panne du PC ne doit jamais être la seule copie de vos données (le cloud en garde une copie dès que le poste est rattaché).

## 8. Mises à jour
L'application recherche les mises à jour toutes les 6 heures. Quand une version est prête, une fenêtre propose **« Installer maintenant »** ou **« Plus tard »** : choisissez un moment **sans vente en cours**. Rien ne s'installe sans votre accord. Menu de la zone de notification → *Rechercher une mise à jour* pour vérifier à la demande.

## 9. Fermer, quitter, démarrage
- Fermer la fenêtre **ne coupe pas** le poste principal : il reste actif dans la zone de notification (près de l'horloge) pour que les autres appareils continuent de fonctionner. Pour l'arrêter : clic droit sur l'icône → *Quitter*.
- *Démarrer avec Windows* se règle dans le même menu.

## 10. Désinstaller
*Paramètres Windows → Applications → Dogui Mart Pro → Désinstaller.* La règle du pare-feu est supprimée ; **vos données ne sont pas supprimées** (dossier `%APPDATA%\Dogui Mart Pro`).

## 11. Dépannage
| Problème | Que faire |
|---|---|
| Un téléphone n'ouvre pas l'adresse | Même réseau Wi-Fi que le poste principal ? Poste principal allumé et l'application ouverte ? La règle « Dogui Mart Pro » du pare-feu existe-t-elle (réseau **privé**) ? Si votre réseau est classé « Public », passez-le en « Privé » dans les paramètres Wi-Fi de Windows. |
| `dogui.local` ne fonctionne pas | Utilisez l'adresse avec des chiffres (toujours valable) : certains réseaux bloquent la découverte automatique. |
| Avertissement de certificat sur le téléphone | Normal tant que le certificat n'est pas approuvé : page « Connecter un appareil », section certificat. |
| « Le port 8443 est déjà utilisé » | Un autre programme utilise ce port. Fermez-le, ou changez le port dans `%APPDATA%\Dogui Mart Pro\poste.json` (`"port"`), puis relancez. |
| Bandeau « n'est plus connecté au cloud » | Paramètres → Synchronisation → *Reconnecter au cloud* avec le mot de passe du propriétaire. |
| Poste secondaire « injoignable » | Poste principal éteint ou autre réseau ; si le poste principal a été réinstallé, son certificat a changé : *Changer de poste principal* et comparez la nouvelle empreinte. |
| Besoin d'un journal technique | `%APPDATA%\Dogui Mart Pro\logs\poste.log` (aucune donnée d'entreprise). |

## 12. Sécurité en bref
- Échanges **chiffrés (HTTPS)** avec un certificat généré sur votre poste ; les postes secondaires **épinglent l'empreinte** validée par vous.
- Le mot de passe du cloud n'est **jamais conservé** : il sert à ouvrir la session cloud, puis est oublié.
- Les mots de passe du personnel sont stockés sous forme d'empreintes ; les comptes créés sur le poste sont envoyés au cloud sans que le cloud connaisse leurs mots de passe.
- Le poste principal n'est joignable que depuis le **réseau local** (pare-feu limité aux réseaux privés).
