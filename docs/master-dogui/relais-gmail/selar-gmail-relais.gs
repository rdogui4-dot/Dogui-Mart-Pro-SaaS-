/**
 * Relais gratuit « e-mail de vente Selar -> MASTER DOGUI » (Google Apps Script, compte Gmail du vendeur).
 *
 * Principe : Selar envoie un e-mail à chaque vente ; ce script lit ces e-mails, en extrait référence, montant et e-mail de
 * l'acheteur, puis les envoie en POST à la réception de paiement MASTER DOGUI. Le jeton reste dans les « Propriétés du script »
 * (jamais dans une URL publique). L'activation n'a lieu que si le montant ET l'e-mail correspondent à UNE demande de paiement
 * préparée dans l'application ; sinon la notification va en file d'examen chez l'administrateur.
 *
 * IMPORTANT : le format des e-mails Selar n'est PAS présumé. Les 3 expressions régulières ci-dessous sont des PLACEHOLDERS
 * à ajuster sur un vrai e-mail de vente (voir README.md). Tant qu'elles ne trouvent rien, le script envoie le texte brut à la
 * file d'examen (statut « non lu ») pour permettre le calibrage, et n'active rien.
 */
var CFG = {
  // Expéditeur et libellé Gmail des ventes (à vérifier sur un vrai e-mail).
  SEARCH: 'from:selar.co OR from:selar.com subject:(sale OR vente OR order OR commande)',
  LABEL_DONE: 'master-dogui-traite',
  // PLACEHOLDERS : une capture par expression (groupe 1). À remplacer après lecture d'un vrai e-mail.
  RE_REF: /(?:order|commande|reference|référence)\s*(?:id|no|#|:)?\s*[:#]?\s*([A-Za-z0-9\-]{6,40})/i,
  RE_AMOUNT: /(?:amount|montant|total)\s*[:\-]?\s*(?:XOF|FCFA|CFA|F)?\s*([0-9][0-9\s.,]*)/i,
  RE_EMAIL: /([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})/,
  // Adresses à ignorer quand on cherche l'e-mail de l'acheteur (la vôtre, celles de Selar).
  IGNORE_EMAILS: [/selar\.(co|com)$/i],
  MAX_THREADS: 30
};

function props_() { return PropertiesService.getScriptProperties(); }

/** À lancer UNE fois : crée le déclencheur toutes les 5 minutes. */
function installer() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'relais') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('relais').timeBased().everyMinutes(5).create();
}

/** À lancer UNE fois après avoir collé vos valeurs dans les deux variables ci-dessous, puis EFFACEZ-LES du code. */
function configurer() {
  var URL_RECEPTION = 'https://dmp-hooks-dogui.fra.appwrite.run'; // adresse de réception, SANS ?k=
  var JETON = 'COLLEZ_ICI_LE_JETON';                               // jeton régénéré dans l'administration
  if (JETON === 'COLLEZ_ICI_LE_JETON') throw new Error('Collez votre jeton dans configurer(), lancez, puis effacez-le du code.');
  props_().setProperties({ URL: URL_RECEPTION, JETON: JETON });
}

function amount_(s) {
  var n = String(s || '').replace(/[\s ]/g, '');
  if (/^\d+[.,]\d{2}$/.test(n)) n = n.replace(/[.,]\d{2}$/, '');   // centimes éventuels
  n = n.replace(/[.,]/g, '');
  return /^\d+$/.test(n) ? Number(n) : null;
}

function relais() {
  var p = props_().getProperties(); if (!p.URL || !p.JETON) throw new Error('Lancez d\'abord configurer().');
  var label = GmailApp.getUserLabelByName(CFG.LABEL_DONE) || GmailApp.createLabel(CFG.LABEL_DONE);
  var threads = GmailApp.search('(' + CFG.SEARCH + ') -label:' + CFG.LABEL_DONE + ' newer_than:7d', 0, CFG.MAX_THREADS);
  threads.forEach(function (th) {
    var allOk = true;
    th.getMessages().forEach(function (m) {
      var done = props_().getProperty('m_' + m.getId()); if (done) return;
      var text = (m.getPlainBody() || '').slice(0, 8000);
      var ref = (CFG.RE_REF.exec(text) || [])[1] || '';
      var amount = amount_((CFG.RE_AMOUNT.exec(text) || [])[1]);
      var emails = (text.match(new RegExp(CFG.RE_EMAIL.source, 'g')) || []).filter(function (e) { return !CFG.IGNORE_EMAILS.some(function (r) { return r.test(e); }); });
      var body = ref && amount && emails.length
        ? { ref: ref, amount: amount, email: emails[0].toLowerCase(), status: 'success', source: 'gmail-selar' }
        // Extraction impossible : on n'active RIEN ; le texte part en file d'examen pour calibrer les expressions.
        : { ref: '', amount: 0, email: '', status: 'non-lu', source: 'gmail-selar', texte: text.slice(0, 1500) };
      var res = UrlFetchApp.fetch(p.URL + '?k=' + encodeURIComponent(p.JETON), { method: 'post', contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true });
      if (res.getResponseCode() >= 200 && res.getResponseCode() < 300) props_().setProperty('m_' + m.getId(), '1'); else allOk = false;
    });
    if (allOk) th.addLabel(label);
  });
}
