## Dogui Mart Pro pour Windows {{VERSION}}

Logiciel de caisse, stock, achats, clients et comptabilité avec **réseau local intégré** : un PC du magasin (le *poste principal*) garde les données, les partage aux autres appareils et les copie automatiquement dans le cloud dès qu'Internet est là. Sans Internet, la caisse continue.

### Installer
1. Téléchargez **`Dogui-Mart-Pro-Setup.exe`** ci-dessous (Windows 10 ou 11, 64 bits).
2. Windows affichera **« Windows a protégé votre ordinateur »** : l'installateur n'est pas encore signé numériquement. Cliquez sur **Informations complémentaires → Exécuter quand même**.
3. Acceptez l'autorisation administrateur (nécessaire pour la règle de pare-feu *réseau privé*) et suivez l'assistant.
4. Au premier lancement, choisissez **Poste principal** ou **Poste secondaire**.

Le **guide complet en français** est joint à cette version : `Guide-installation-Windows.md`.

### Vérifier le fichier (facultatif)
Empreinte SHA-256 de `Dogui-Mart-Pro-Setup.exe` :
```
{{SHA256}}
```
PowerShell : `Get-FileHash .\Dogui-Mart-Pro-Setup.exe -Algorithm SHA256`

### Mises à jour
L'application recherche les mises à jour toutes les 6 heures et vous propose **Installer maintenant** ou **Plus tard** : rien ne s'installe sans votre accord.

### Vos données
Désinstaller ne supprime pas vos données (`%APPDATA%\Dogui Mart Pro`). Une sauvegarde par jour est faite automatiquement dans le dossier `sauvegardes`.
