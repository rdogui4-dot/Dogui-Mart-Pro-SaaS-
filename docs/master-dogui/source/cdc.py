# -*- coding: utf-8 -*-
# Contenu du cahier des charges MASTER DOGUI v1.1 : (type, texte...) ; types : h1, h2, p, b (puces), note, tbl, todo
C=[]
def h1(t): C.append(("h1",t))
def h2(t): C.append(("h2",t))
def p(t): C.append(("p",t))
def b(*t): C.append(("b",list(t)))
def note(t): C.append(("note",t))
def todo(t): C.append(("todo",t))
def tbl(rows,w=None): C.append(("tbl",rows,w))

h1("1. Présentation générale")
p("MASTER DOGUI est un système d’intelligence artificielle de pilotage commercial et managérial intégré à DOGUI MART PRO. Il analyse les données réellement disponibles de chaque entreprise, apprend progressivement son fonctionnement et transforme les informations opérationnelles en diagnostics, alertes, recommandations et aides à la décision.")
p("Il agit comme un directeur intelligent : il accompagne le commerçant, éclaire ses décisions et l’aide à améliorer la performance de son activité, sans se substituer à sa responsabilité.")
note("Principe directeur : aucune donnée, statistique, transaction, alerte ou recommandation n’est inventée. Toute analyse précise sa période, ses sources, sa méthode et ses limites. Ce que MASTER DOGUI ne sait pas, il le dit.")
h2("1.1 Ce que MASTER DOGUI n’est pas")
b("Il n’est ni un expert-comptable, ni un conseiller fiscal, juridique ou financier agréé : ses analyses ne remplacent pas un professionnel.","Il n’exécute aucune opération financière (paiement, virement, souscription, achat) et ne modifie aucune donnée métier sans confirmation et autorisation explicites.","Il n’accède à aucune donnée confidentielle de tiers (concurrents, enseignes) : il s’appuie uniquement sur les données de l’entreprise et sur des sources publiques documentées.")

h1("2. Objectifs fonctionnels")
b("Comprendre le modèle économique, l’organisation et les objectifs propres à chaque entreprise.","Analyser les ventes, marges, stocks, achats, fournisseurs, dépenses, trésorerie, clients et équipes selon les données accessibles.","Produire des rapports automatiques à l’ouverture de l’application et après la clôture confirmée d’une session de caisse, selon les règles du chapitre 6.","Détecter les risques, anomalies, pertes potentielles, ruptures, surstocks et opportunités commerciales.","Fournir des recommandations hiérarchisées, argumentées et suivies dans le temps.","Répondre en langage naturel aux questions de gestion et aider à comparer plusieurs scénarios.","Respecter les droits d’accès par rôle et les fonctionnalités réellement disponibles dans l’abonnement DOGUI MART PRO.")

h1("3. Modèle commercial et licence indépendante")
p("MASTER DOGUI est une option payante indépendante de l’abonnement principal DOGUI MART PRO. Elle peut être souscrite par une entreprise utilisant Starter, Business ou Pro, sans changer de formule.")
tbl([["Élément","Règle commerciale"],
["Essai gratuit","14 jours, une seule fois par entreprise, sans paiement initial ni débit automatique."],
["Première période payante","15 000 FCFA pour les 12 premiers mois payants, après l’essai (modalités de règlement : voir 3.1)."],
["Renouvellement","À partir de la 2e année : 2 500 FCFA par mois, sans engagement annuel."],
["Licence","Rattachée à l’entreprise (businessId), pas à un utilisateur ni à une boutique."],
["Après expiration","Mode consultation : historique, anciens rapports et conversations accessibles ; nouvelles analyses, rapports, recommandations et automatisations suspendus."]],[110,360])
h2("3.1 Précisions commerciales à confirmer")
todo("Les points ci-dessous levaient une ambiguïté du cahier v1.0. Ce sont des PROPOSITIONS : elles doivent être validées par la direction avant développement.")
b("Règlement de la première période : paiement unique de 15 000 FCFA donnant droit à 12 mois, ou possibilité d’échelonner. Proposition : paiement unique, sans renouvellement automatique.","Fin de la première période : le renouvellement à 2 500 FCFA/mois commence le jour suivant l’échéance ; aucun débit automatique sans consentement explicite et rappel préalable (par exemple 7 jours avant).","Entreprise multi-boutiques : une licence couvre toutes les boutiques de l’entreprise (proposition). Les analyses restent limitées au périmètre autorisé de chaque utilisateur.","Résiliation et reprise : l’utilisateur peut cesser de payer à tout moment (mode consultation). Une réactivation reprend l’historique ; aucune période déjà payée n’est remboursée sauf règle commerciale écrite.","Changement de formule (Starter, Business, Pro) pendant l’essai ou la période payante : sans effet sur la licence ; seule la profondeur des analyses change.")
h2("3.2 Unicité de l’essai")
p("L’essai est unique par entreprise et ne doit pas être réinitialisé par la création de nouveaux utilisateurs. Un contrôle supplémentaire est nécessaire pour éviter la recréation d’une entreprise.")
todo("À décider : identifiant retenu pour détecter une entreprise déjà essayée (par exemple numéro de téléphone du propriétaire vérifié, ou identifiant légal facultatif). Le choix doit être conforme à la protection des données et ne pas bloquer à tort une entreprise légitime ; prévoir un recours manuel via l’administration.")
h2("3.3 Informations affichées")
p("L’interface affiche clairement : date de début et de fin de l’essai, prix applicable, date de début de facturation, prochaine échéance, conséquences de l’expiration, règles de renouvellement et d’annulation. L’expiration ne supprime aucune donnée et ne bloque aucun autre module ; chaque module reste soumis à son propre abonnement.")

h1("4. Domaines d’expertise et périmètre de la version 1")
p("Les domaines ci-dessous sont les domaines cibles. Chacun ne devient « actif » qu’avec des données et des sources suffisantes. Le périmètre de la version 1 est précisé au chapitre 19.")
h2("4.1 Commerce et distribution")
b("Gestion de magasins, points de vente, assortiment, prix, promotions et merchandising.","Rotation des stocks, disponibilité, démarque, ruptures, surstocks et réapprovisionnement.","Bonnes pratiques de distribution, issues de sources publiques citées. Le contexte ivoirien (acteurs tels que Prosuma, Carrefour, CDCI, CFAO Retail) peut servir de repère, sans prétendre accéder à des données confidentielles ni comparer de chiffres non publics.")
h2("4.2 Gestion et direction")
b("Pilotage de la performance, organisation, objectifs, productivité et processus.","Gestion commerciale, relation client, fidélisation et marketing.","Aide à la décision, gestion des risques et conduite du changement.")
h2("4.3 Finance, comptabilité et fiscalité")
b("Trésorerie, encaissements, décaissements, créances, dettes, budgets et prévisions (modules FinI).","Rentabilité, coûts, marges, seuil de rentabilité et flux de trésorerie.","Comptabilité compatible avec le référentiel SYSCOHADA lorsque les modules (ICompta) et les données le permettent : le plan de comptes est celui de l’entreprise, MASTER DOGUI n’en présume aucun numéro.","Fiscalité ivoirienne : informations uniquement sourcées, datées et versionnées dans la base de connaissances (voir 9.3), toujours accompagnées d’une mention de validation par un professionnel pour toute décision déclarative ou sensible. Aucun taux ni règle fiscale n’est affirmé sans source datée.")
h2("4.4 Investissement et ressources humaines")
b("Évaluation de projets d’entreprise (équipements, magasins, véhicules, recrutement, expansion) à partir du module IProj-Invest : les calculs (ROI, VAN, TRI, récupération) sont ceux du module, MASTER DOGUI les explique sans les recalculer autrement.","Investissements financiers : rendement déclaré, risque déclaré, horizon et scénarios, sans promesse de rendement et sans cours de marché fabriqué.","Organisation RH, effectifs, coûts de personnel, objectifs et indicateurs, uniquement selon les données autorisées par le rôle.")

h1("5. Profil adaptatif de chaque entreprise")
p("MASTER DOGUI construit progressivement un profil propre à chaque entreprise, sans jamais mélanger les données de plusieurs clients.")
b("Identité, secteur, forme d’activité, taille et localisation.","Magasins, caisses, horaires, équipes et responsabilités.","Catalogue, catégories, prix, fournisseurs et conditions d’achat.","Typologie de clientèle, habitudes d’achat et canaux commerciaux.","Objectifs, contraintes, priorités et seuils d’alerte.","Historique des décisions, recommandations acceptées ou refusées et résultats observés.")
h2("5.1 Qualification et gouvernance de la mémoire")
b("Chaque information mémorisée est qualifiée : donnée vérifiée (issue d’un module), préférence déclarée, hypothèse ou estimation. Elle porte sa source, sa date et son auteur.","Le profil est consultable et modifiable par les personnes autorisées (propriétaire par défaut). Toute modification est journalisée.","Une information déduite par l’IA n’est jamais promue au rang de « donnée vérifiée » sans confirmation d’un utilisateur autorisé.","L’utilisateur peut supprimer une information du profil ; les rapports déjà produits restent inchangés.","La mémoire d’une entreprise est strictement isolée : aucune information d’une entreprise ne sert à répondre à une autre.")

h1("6. Rapports automatiques d’ouverture et de clôture")
h2("6.1 Rapport d’ouverture")
p("À l’ouverture de l’application, le système vérifie l’état réel des sessions de caisse pour le magasin et le périmètre concernés. Si aucune session pertinente n’est ouverte, il peut produire un briefing de santé de l’activité avant l’ouverture d’une nouvelle session.")
b("Synthèse de la période précédente et comparaison pertinente.","Ventes, encaissements et marge, cette dernière uniquement si les coûts sont disponibles.","État du stock, ruptures, seuils critiques et produits à surveiller.","Fournisseurs, commandes, réceptions et réclamations en attente.","Dépenses, trésorerie et écarts de caisse disponibles.","Clients, opportunités CRM et actions commerciales prioritaires.","Alertes prioritaires et recommandations concrètes.")
note("Règle impérative : si une session de caisse est déjà ouverte dans le périmètre concerné, aucun rapport d’ouverture n’est généré ni affiché. Une session de caisse n’est jamais ouverte automatiquement.")
h2("6.2 Rapport de clôture")
p("Après confirmation effective de la clôture d’une session (événement émis par le serveur, jamais déduit de l’affichage d’un écran), un rapport associé à cette session et à ce magasin est généré.")
b("Ventes confirmées, annulations, remboursements et avoirs.","Encaissements par moyen de paiement.","Montant théorique, montant compté et écart de caisse.","Dépenses imputées à la session et justification des écarts.","Indicateurs de marge seulement si les coûts fiables existent.","Alertes, anomalies et recommandations pour la prochaine période.")
h2("6.3 Fiabilité et cycle de vie des rapports")
b("Idempotence : un rapport est identifié par businessId, storeId, reportType, businessDate et, si pertinent, sessionId. Un événement répété ne crée jamais de doublon.","États : en attente, en génération, prêt, partiel, échoué, remplacé. Un rapport partiel liste les données manquantes ; un rapport échoué est rejouable.","Date commerciale : fuseau horaire et heure de bascule définis par entreprise (par défaut, fuseau de la boutique) ; une session clôturée après minuit appartient à sa date d’ouverture.","Plusieurs caisses ou sessions simultanées : un rapport de clôture par session ; le briefing d’ouverture est produit seulement si aucune session n’est ouverte dans le périmètre.","Correction après coup (par exemple une session rouverte ou corrigée) : le nouveau rapport remplace le précédent, qui est conservé et marqué « remplacé » avec le motif.","Chaque chiffre d’un rapport renvoie à ses sources et est reproductible à partir d’elles.")

h1("7. Assistant conversationnel")
p("L’utilisateur peut poser des questions en langage naturel : évolution des ventes, produits rentables, stocks à risque, fournisseurs, trésorerie, clients, dépenses, investissements ou organisation.")
p("Chaque réponse structurée présente : conclusion, période, données sources, calcul ou méthode, observations, limites, niveau de confiance et recommandations. Une réponse qui ne peut pas s’appuyer sur des données le dit explicitement.")
b("Les actions qui modifient des données, déclenchent un paiement ou engagent l’entreprise exigent une confirmation et une autorisation adaptées au rôle.","Les chiffres cités proviennent exclusivement du moteur déterministe (9.2) ; le modèle de langage rédige et explique, il ne calcule pas.","Les conversations sont rattachées à l’utilisateur ; un responsable peut consulter celles des collaborateurs seulement si la règle est activée et annoncée (voir 13.2).")

h1("8. Moteur de recommandations")
b("Priorités : critique, élevée, moyenne, opportunité, information.","Chaque recommandation conserve son motif, ses données sources, sa date, sa priorité, son niveau de confiance et son statut.","Statuts : nouvelle, acceptée, refusée, reportée, en cours, réalisée, sans effet mesurable.","Suivi des résultats après action, sans attribuer une causalité non démontrée.","Distinction explicite entre faits constatés, estimations et prévisions.","Aucune promesse de résultat commercial ou financier.")
h2("8.1 Qualité des recommandations")
b("Une recommandation n’est émise que si le seuil minimal de données est atteint (par exemple historique suffisant) ; sinon elle est remplacée par un message « données insuffisantes ».","Les règles de déclenchement des alertes et leurs seuils sont paramétrables par l’entreprise ; les valeurs par défaut sont documentées.","Une recommandation refusée n’est pas re-proposée à l’identique sans changement des données.")

h1("9. Architecture fonctionnelle et technique")
p("Architecture modulaire, évolutive et sécurisée, avec séparation des responsabilités.")
h2("9.1 Composants")
b("Orchestrateur : comprend la demande, vérifie les droits et choisit les capacités autorisées.","Agents spécialisés : commerce, stock, finance, comptabilité, CRM, achats, RH et investissement.","Moteur de rapports et de recommandations.","Mémoire métier cloisonnée par entreprise.","Gestionnaire de licence, paiements, quotas, coûts IA et journal d’audit.")
h2("9.2 Moteur de calcul déterministe")
p("KPI, agrégations, marges, écarts et projections sont calculés par du code déterministe, testé et reproductible. Les calculs financiers sensibles ne sont jamais improvisés par le modèle de langage. Chaque indicateur documente sa formule, sa période, sa source, ses hypothèses et ses limites.")
h2("9.3 Moteur de connaissances")
b("Chaque source est documentée : titre, émetteur, date de publication, date de validité, version et responsable de la mise à jour.","Une réponse fondée sur une source en indique la référence et la date ; une source périmée est signalée, jamais utilisée silencieusement.","Fiscalité et réglementation : mises à jour planifiées et validées par un professionnel avant publication.")
h2("9.4 Couche IA")
b("Le fournisseur et le modèle IA sont interchangeables via une couche d’abstraction.","Prompts, outils et versions sont contrôlés, versionnés et testés avant mise en production.","Le modèle ne reçoit que les données strictement nécessaires (voir 13.1).")

h1("10. Intégration avec DOGUI MART PRO")
p("MASTER DOGUI réutilise les données des modules comme source de vérité : Dashboard, Articles, Caisse, Stock, Silent Count et Silent Smart Count, Achats et réclamations fournisseurs, Fournisseurs, Promotions, Dépenses, CRM, FinI, ICompta et IProj-Invest, selon leur disponibilité et l’abonnement.")
b("Aucune duplication des données commerciales existantes ; références communes et traçabilité des sources.","Accès limité aux modules réellement souscrits et autorisés ; une formule Pro n’est jamais confondue avec la licence MASTER DOGUI.","Les données historiques conservent leur sens et leur intégrité.","MASTER DOGUI ne crée aucune écriture comptable ni aucun mouvement de trésorerie.")
p("Les indicateurs financiers sont nommés avec précision : chiffre d’affaires, encaissements, remboursements, marge brute, charges, résultat. Le chiffre d’affaires ou la marge brute ne sont jamais assimilés au bénéfice net ; un résultat provisoire est présenté comme tel.")

h1("11. Interface utilisateur")
b("Accueil MASTER DOGUI avec état de licence et synthèse.","Briefing d’ouverture et rapport de clôture.","Conversation et historique des échanges.","Profil de l’entreprise et préférences.","Centre de recommandations et suivi des décisions.","Analyses, rapports et diagnostics, exportables en PDF, Excel et CSV.","Gestion de l’abonnement, de l’essai et des paiements.")
p("Interface Android-first, en français, lisible et accessible, adaptée aux connexions instables : états de chargement, erreurs, données partielles et indisponibilités explicites.")
h2("11.1 Hors ligne et connexion instable")
b("Sans réseau, les derniers rapports et conversations déjà chargés restent consultables en lecture seule ; les nouvelles analyses sont indisponibles et le message le dit clairement.","Aucune question envoyée hors ligne n’est perdue en silence : elle est conservée et rejouée, ou refusée avec un message explicite.","Les rapports volumineux sont paginés et téléchargeables à la demande.")

h1("12. Licence, paiement et mode consultation")
b("La licence est attachée à l’entreprise et contrôlée côté serveur.","L’activation dépend d’une confirmation vérifiable du prestataire de paiement, jamais d’une simple capture d’écran.","Les événements de paiement sont vérifiés (signature), idempotents et journalisés.","À expiration : suspension des nouvelles analyses IA, rapports, recommandations et automatisations MASTER DOGUI.","Consultation conservée des anciens rapports, conversations et historiques.","Aucune suppression de données, aucune interruption des autres modules.","Délai de grâce, rappels avant échéance et règles de renouvellement, d’annulation et de reprise affichés sans ambiguïté.")
todo("À décider : délai de grâce éventuel après l’échéance, canaux de rappel (dans l’application uniquement tant que les prestataires externes de messagerie restent suspendus).")

h1("13. Sécurité, confidentialité et conformité")
b("Appwrite est le backend de référence : Auth, TablesDB, Storage et Functions.","Droits vérifiés côté serveur pour chaque lecture ou action sensible ; isolation stricte par businessId et par boutique, contrôle d’accès par rôle.","Clés API et secrets exclusivement côté serveur.","Protection contre les injections de prompt et contre les instructions contenues dans les données importées ou saisies : toute donnée est traitée comme du contenu, jamais comme une consigne.","Journal des accès sensibles, décisions automatisées, erreurs et actions.","Revue juridique de la conformité aux règles ivoiriennes de protection des données personnelles, notamment la loi n° 2013-450 du 19 juin 2013, avant mise en production.")
h2("13.1 Données transmises au fournisseur IA")
b("Principe de minimisation : seules les données agrégées ou strictement nécessaires à la question sont transmises ; les données nominatives de clients (nom, téléphone) sont exclues ou pseudonymisées par défaut.","Aucun mot de passe, secret, jeton ni donnée de paiement n’est jamais transmis.","Liste des champs autorisés par type d’analyse, documentée et auditable ; journal de ce qui a été transmis (sans le contenu sensible).","Conditions contractuelles avec le fournisseur IA : pas d’entraînement sur les données de l’entreprise, localisation et durée de conservation connues.")
todo("À valider avant production : choix du fournisseur IA, localisation du traitement, clauses de confidentialité, base légale et information des personnes concernées.")
h2("13.2 Conservation, accès et effacement")
b("Durée de conservation définie par type de donnée (conversations, rapports, journaux) ; purge automatique au-delà.","Droit d’accès et d’effacement des données personnelles contenues dans les conversations, sans altérer les rapports comptables ou commerciaux déjà produits (qui référencent des données agrégées).","Visibilité des conversations : privée à l’utilisateur par défaut ; consultation par le propriétaire uniquement si la règle est activée et annoncée aux utilisateurs.")
note("Aucune modification du schéma Appwrite n’est effectuée avant audit de l’existant. Les noms de tables du chapitre 14 sont des concepts, pas des identifiants existants.")

h1("14. Structures de données logiques à étudier")
p("Après audit uniquement, étudier la nécessité de structures pour : licences, essais, paiements, profils d’entreprise, préférences, rapports, versions de rapports, recommandations, conversations, messages, sources de connaissances, documents, tâches d’analyse, consommation IA, journaux d’audit, règles d’automatisation et actions.")
p("Les structures existantes (abonnements, journal d’audit, tables de rapports et de réglages des modules) sont réutilisées lorsqu’elles répondent au besoin. Toute création est justifiée par un schéma, des index, des permissions, des règles de rétention et une stratégie de migration.")

h1("15. Événements et automatisations")
b("Connexion ou ouverture de l’application.","Vérification de l’existence d’une session de caisse active.","Clôture confirmée d’une session.","Anomalies de vente ou de caisse.","Seuil de stock, rupture ou échéance fournisseur.","Événements de licence, essai et paiement.","Analyses périodiques et analyses déclenchées à la demande.")
p("Les automatisations sont pilotées par des événements fiables émis côté serveur et contrôlées contre les doublons (clés d’idempotence, verrous). En cas d’échec, nouvelle tentative limitée puis alerte ; aucune boucle infinie. Aucune action financière ou externe sensible n’est exécutée sans autorisation explicite.")

h1("16. Formules Starter, Business et Pro")
p("La licence MASTER DOGUI est indépendante des formules. Les formules déterminent les modules et les données accessibles ; MASTER DOGUI adapte la profondeur de ses analyses.")
tbl([["Formule","Profondeur des analyses"],["Starter","Fonctionnalités et données disponibles dans Starter."],["Business","Analyses enrichies avec les modules Business autorisés."],["Pro","Analyses avancées utilisant les modules Pro autorisés."]],[110,360])
p("Dans tous les cas, les modules ou données indisponibles sont signalés clairement au lieu de simuler des résultats. Un changement ou une rétrogradation de formule ne supprime aucun historique MASTER DOGUI.")

h1("17. Maîtrise des coûts IA et administration")
b("Suivi des appels, tokens, coûts, latences, erreurs et taux de réussite, par entreprise.","Quotas et limites configurables par entreprise et par formule ; seuils d’avertissement à 80 % puis 100 %.","Comportement au dépassement défini à l’avance : l’utilisateur est prévenu, les rapports déterministes continuent, seules les réponses génératives sont limitées. Aucune fonction n’est facturée ni suspendue silencieusement.","Priorité aux calculs locaux déterministes et à la mise en cache lorsque c’est sûr.","Console d’administration : licences, fournisseurs IA, modèles, prompts versionnés, quotas, incidents, interruption d’urgence (kill switch).")

h1("18. Tests et critères d’acceptation")
b("Aucun rapport d’ouverture lorsqu’une session pertinente est déjà active ; un rapport d’ouverture est produit seulement lorsque le périmètre est sans session active.","Un rapport de clôture est déclenché uniquement après confirmation réelle de la clôture.","Les événements répétés ne créent pas de rapports en double (y compris envois simultanés).","Les montants, marges et écarts sont reproductibles à partir des données sources.","Les données d’une entreprise ne sont jamais visibles par une autre ; tests d’isolation par boutique et par rôle.","L’essai est unique par entreprise et ne nécessite aucun paiement initial.","Dates, tarifs et renouvellements sont cohérents et visibles.","Après expiration, les historiques restent consultables et les nouvelles analyses sont suspendues ; les autres fonctions continuent selon leur abonnement.","Les erreurs, données partielles et limites sont visibles et traçables.","Aucun succès fictif ni donnée de démonstration en production.")
h2("18.1 Qualité des réponses (ajout)")
b("Jeu de questions de référence par domaine (ventes, stock, trésorerie, fournisseurs, investissement) avec réponses attendues vérifiées à partir de données de test.","Seuil d’acceptation fixé avant la mise en production (par exemple 100 % des chiffres exacts, 0 donnée inventée sur le jeu de référence) ; mesure répétée à chaque changement de modèle ou de prompt.","Tests d’injection de prompt et de fuite inter-entreprises.","Tests de charge et de coût : coût moyen par rapport et par conversation sous le plafond.")

h1("19. Plan de réalisation recommandé")
p("Principe : livrer d’abord le noyau déterministe, utile et peu coûteux, puis ajouter la conversation et les agents. Chaque phase a ses livrables et un critère de sortie validé avant la suivante.")
tbl([["Phase","Contenu","Livrable et critère de sortie"],
["1 Audit","Cartographier code, modules, Appwrite, permissions, événements de caisse, données et abonnements.","Rapport d’audit validé ; aucun changement de code ou de schéma."],
["2 Fondations","Orchestrateur, sécurité, licence et essai, contrats d’intégration, journal d’audit.","Licence et essai testés (unicité, expiration, consultation)."],
["3 Rapports déterministes","Briefing d’ouverture et rapport de clôture idempotents, KPI reproductibles, sans IA générative.","Critères d’acceptation du chapitre 18 liés aux rapports atteints."],
["4 Profil métier","Profil d’entreprise, préférences, mémoire isolée et qualifiée.","Isolation prouvée par tests."],
["5 Intelligence métier","Agents spécialisés et base de connaissances sourcée ; recommandations.","Jeu de référence de qualité réussi."],
["6 Conversation","Assistant en langage naturel, quotas et coûts IA.","Réponses structurées, plafonds respectés."],
["7 Interface","Écrans Android et états d’usage (chargement, erreur, partiel, hors ligne).","Tests d’usage sur connexion instable."],
["8 Commercialisation","Paiement vérifiable, renouvellement, mode consultation.","Événements de paiement vérifiés et idempotents."],
["9 Validation","Sécurité, calculs, événements, coûts, cas limites, revue juridique.","Recette signée."],
["10 Déploiement","Pilote contrôlé, corrections, supervision, mise en production.","Indicateurs de pilote et décision de généralisation."]],[70,215,185])
h2("19.1 Périmètre proposé pour la version 1")
b("Inclus : licence et essai, briefing d’ouverture, rapport de clôture, profil d’entreprise, recommandations sur les données des modules, assistant sur les modules disponibles.","Hors version 1 (à planifier) : veille concurrentielle, fiscalité détaillée, RH avancée, automatisations d’actions externes.")
todo("À valider : ce découpage de version 1 ; les domaines hors v1 restent décrits au chapitre 4 comme cibles.")

h1("20. Règles impératives de construction")
b("Le constructeur de l’application est Claude ; DOGUI MART PRO conserve Appwrite comme backend unique.","Commencer par un audit du projet et du backend existants ; ne pas modifier le code ou le schéma pendant l’audit.","Ne jamais inventer d’identifiants, de secrets, de données, de tables ou de résultats.","Ne pas dupliquer les fonctionnalités ni les sources de données existantes.","Présenter séparément faits observés, inconnues, risques et recommandations.","Toute modification ultérieure est progressive, testée, documentée et réversible lorsque possible.","Aucune promesse de conformité, de rendement financier ou de résultat commercial sans preuve.")

h1("21. Définition officielle")
p("MASTER DOGUI est un système intelligent de gestion, d’analyse et de pilotage commercial conçu pour comprendre et accompagner chaque entreprise utilisant DOGUI MART PRO. Il transforme les données opérationnelles en informations stratégiques, produit des rapports de début et de fin de journée, détecte les risques et opportunités, et aide le commerçant à prendre des décisions éclairées.")
note("« Une intelligence pour chaque boutique. Un directeur intelligent pour chaque commerçant. »")

h1("Annexe A — Identité visuelle")
p("Le logo officiel est un cerveau à circuit imprimé. Un pack vectoriel (SVG) accompagne ce document : symbole noir, blanc et or, icône disque, icône d’application arrondie, icône adaptative Android (maskable), icône simplifiée pour les petites tailles (16 à 64 px) et logos horizontaux sur fond clair et sombre.")
tbl([["Rôle","Couleur"],["Or (dégradé)","#FFE07A en haut, #F6B92B au centre, #E88409 en bas"],["Bleu nuit (fond)","#0B2A8A au centre vers #020A2C aux bords"],["Halo","#2F6BFF (usage discret)"],["Texte sur fond clair","#0A1F6B ; mot DOGUI en #D97A06"],["Texte sur fond sombre","#FFFFFF ; mot DOGUI en #FFD25A"]],[140,330])
b("Zone de protection : au moins la largeur d’un nœud du circuit autour du symbole.","Taille minimale : 48 px pour le symbole détaillé ; en dessous, utiliser l’icône simplifiée.","Sur photo ou fond chargé : version noire ou blanche, jamais le dégradé.","Interdits : déformer, pivoter, changer les couleurs, ajouter une ombre ou un halo supplémentaire, utiliser un fichier matriciel agrandi.")
h1("Annexe B — Journal des modifications (v1.0 vers v1.1)")
tbl([["Sujet","Modification"],
["Commercial","Modalités de règlement, fin de période, multi-boutiques, résiliation et changement de formule précisés (propositions à confirmer, 3.1) ; anti-contournement de l’essai (3.2)."],
["Rapports","Date commerciale, sessions simultanées, correction après coup, versions « remplacé » (6.3) ; événement serveur de clôture (6.2)."],
["Profil et mémoire","Qualification, gouvernance, effacement (5.1)."],
["IA et sécurité","Minimisation des données transmises, fournisseur IA, conservation et effacement (13.1, 13.2) ; base de connaissances datée et versionnée (9.3)."],
["Qualité","Jeu de questions de référence, seuils d’acceptation, tests d’injection et de coût (18.1)."],
["Hors ligne","Comportement sans réseau (11.1)."],
["Coûts IA","Seuils 80 % / 100 %, comportement au dépassement, kill switch (17)."],
["Intégration","Noms alignés : ICompta (et non ComptaI) ; Silent Count, Silent Smart Count, réclamations fournisseurs ajoutés (10)."],
["Plan","Phases avec livrables et critères de sortie ; noyau déterministe avant la conversation ; périmètre v1 proposé (19)."],
["Ajouts","Chapitre 1.1 (ce que MASTER DOGUI n’est pas) ; Annexe A (identité visuelle)."]],[100,370])
h1("Annexe C — Points restant à valider par la direction")
b("Règlement de la première période, renouvellement, délai de grâce et rappels (3.1, 12).","Identifiant retenu pour l’unicité de l’essai (3.2).","Licence par entreprise couvrant toutes les boutiques (3.1).","Fournisseur IA, localisation, clauses de confidentialité et revue juridique (13.1).","Visibilité des conversations par le propriétaire (13.2).","Périmètre de la version 1 (19.1).","Seuils d’acceptation de la qualité des réponses (18.1) et plafonds de coûts IA (17).")
