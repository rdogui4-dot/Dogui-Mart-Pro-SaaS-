; Règle de pare-feu Windows : les autres appareils du magasin (téléphones, caisses) peuvent joindre le poste principal.
; Limitée aux réseaux PRIVÉS (jamais Wi-Fi public) ; supprimée à la désinstallation. Les données de l'entreprise ne sont jamais supprimées.
!macro customInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Dogui Mart Pro"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Dogui Mart Pro" dir=in action=allow program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" enable=yes profile=private description="Poste principal Dogui Mart Pro (réseau local)"'
!macroend
!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Dogui Mart Pro"'
!macroend
