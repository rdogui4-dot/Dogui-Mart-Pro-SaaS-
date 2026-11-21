let found = null; const $ = (id) => document.getElementById(id);
$("f").addEventListener("submit", async (e) => { e.preventDefault(); $("err").textContent = ""; $("go").disabled = true; $("go").textContent = "Recherche…"; const r = await window.dogui.probe($("addr").value); $("go").disabled = false; $("go").textContent = "Rechercher le poste principal";
  if (!r.ok) { $("err").textContent = r.error; return; } found = r; $("fp").textContent = r.fingerprint; $("step2").hidden = false; $("step2").style.display = "flex"; });
$("ok").addEventListener("change", () => { $("confirm").disabled = !$("ok").checked; });
$("confirm").addEventListener("click", async () => { const r = await window.dogui.confirmPin(found.origin, found.fingerprint); if (!r.ok) $("err").textContent = r.error || "Connexion impossible"; });
