'use strict';
/* Assemble une page de smoke test autonome : markup + script de l'application
 * + harnais, dans le même document (exécutable en file:// sans serveur).
 */
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// Extraction du <style>
const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];

// Extraction du markup <body> sans le <script> principal
const bodyMarkup = html.match(/<body>([\s\S]*?)\n  <script>/)[1];

// Extraction du script applicatif
const appScript = html.match(/  <script>([\s\S]*?)<\/script>/)[1];

// Polyfill localStorage pour file:// + harnais injecté après l'app
const harness = `
;(function () {
  const out = [];
  const A = (ok, label) => out.push((ok ? 'OK ' : 'KO ') + label);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const attendre = async (cond, timeout = 2500) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) { if (cond()) return true; await sleep(50); }
    return cond();
  };
  const q = (s) => document.querySelector(s);
  const byId = (s) => document.getElementById(s);
  const clic = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  const bouton = (label, racine) => [...(racine || q('#restore-actions')).querySelectorAll('button')].find((b) => b.textContent === label);
  const coller = (coffre) => { q('#restore-paste').value = JSON.stringify(coffre); };
  const restaurerVia = async (coffre) => {
    clic(q('#restore'));
    await attendre(() => q('#tab-paste'));
    clic(q('#tab-paste'));
    coller(coffre);
    clic(q('#restore-next'));
    await attendre(() => byId('restore-title').textContent === 'Restaurer ce coffre ?');
    clic(bouton('Restaurer'));
  };
  (async () => {
    try {
      await sleep(200);
      A(!!q('#save'), 'bouton Sauvegarder présent');
      A(!!q('#restore'), 'bouton Restaurer présent');
      A(q('#save-band').hidden !== false, 'bandeau masqué au départ');
      A(q('#tab-scan').hidden === !('BarcodeDetector' in window), 'onglet scan : visible ssi BarcodeDetector disponible');

      // ——— Restauration sur appareil vide : application directe + bascule de profil (§6, §8.2)
      await restaurerVia({ app: 'homebiker', format: 2, exporte: '2026-09-27T10:00:00Z', appareil: { ua: 'test' }, profils: [{ id: 'ux', nom: 'Test', seances: [{ date: '2026-09-01', de: '08:00', a: '08:30', depart: 0, arrivee: 10, force: 2, distance: 10 }] }], prefs: { couches: {} } });
      await attendre(() => /restauré/.test(byId('toast').textContent));
      A(/restauré/.test(byId('toast').textContent), 'toast de restauration directe : ' + JSON.stringify(byId('toast').textContent));
      A(q('#liste').children.length === 1, 'séance du coffre visible dans le tableau');
      A(byId('user-select').selectedOptions[0].textContent === 'Test', 'profil restauré devenu actif (§6)');

      // ——— Fusion : doublon ignoré, nouvelle séance ajoutée (§8.3)
      await restaurerVia({ app: 'homebiker', format: 2, exporte: '2026-09-27T11:00:00Z', appareil: { ua: 'test' }, profils: [{ id: 'ux', nom: 'Test', seances: [{ date: '2026-09-01', de: '08:00', a: '08:30', depart: 0, arrivee: 10, force: 2, distance: 10 }, { date: '2026-09-02', de: '09:00', a: '09:40', depart: 10, arrivee: 50, force: 3, distance: 40 }] }], prefs: { couches: {} } });
      const fusionBtn = await (async () => { await attendre(() => bouton('Fusionner')); return bouton('Fusionner'); })();
      if (fusionBtn) {
        clic(fusionBtn);
        await attendre(() => /ajoutée/.test(byId('toast').textContent));
        A(q('#liste').children.length === 2, 'fusion : 1 doublon ignoré, 1 ajout → 2 séances');
        A(/1 ajoutée/.test(byId('toast').textContent), 'récapitulatif de fusion : ' + JSON.stringify(byId('toast').textContent));
      } else {
        A(false, 'choix Fusionner non proposé');
      }

      // ——— Ajout d'une séance → bandeau visible (§9)
      q('#f-date').value = '2026-09-27';
      q('#f-de').value = '07:00';
      q('#f-a').value = '07:45';
      q('#f-depart').value = '50';
      q('#f-arrivee').value = '92.7';
      q('#form').dispatchEvent(new Event('submit', { cancelable: true }));
      await attendre(() => q('#save-band').hidden === false);
      A(q('#save-band').hidden === false, 'bandeau visible après ajout');
      A(q('#liste').children.length === 3, 'séance ajoutée au tableau (3 au total)');

      // ——— Modale Sauvegarder : les 4 sorties (§7)
      clic(q('#save'));
      await attendre(() => byId('restore-title').textContent === 'Sauvegarder le carnet');
      const btns = [...q('#restore-actions').querySelectorAll('button')].map((b) => b.textContent);
      A(btns.some((t) => t.includes('Télécharger')), 'action Télécharger proposée');
      A(btns.some((t) => t.includes('Copier le coffre')), 'action Copier proposée');
      A(btns.some((t) => t.includes('QR')), 'action QR proposée');
      A(!btns.some((t) => t.includes('Partager')), 'pas de Partage natif dans un navigateur sans canShare');
      clic(bouton('Annuler'));
      await attendre(() => q('#restore-overlay').hidden);
      A(q('#restore-overlay').hidden, 'modale Sauvegarder fermée');

      // ——— Rejet propre d'un contenu étranger (§13)
      clic(q('#restore'));
      await attendre(() => q('#tab-paste'));
      clic(q('#tab-paste'));
      q('#restore-paste').value = '{"pas":"un coffre"}';
      clic(q('#restore-next'));
      await attendre(() => byId('restore-title').textContent === 'Coffre illisible');
      A(byId('restore-title').textContent === 'Coffre illisible', 'JSON étranger rejeté proprement');
      clic(bouton('Fermer'));
      await sleep(300);
      A(q('#liste').children.length === 3, 'données locales intactes après rejet');

      // ——— Le bandeau reste cohérent après la sauvegarde via bouton du bandeau
      A(q('#save-band').hidden === false, 'bandeau toujours visible (sauvegarde non faite)');

      document.title = 'SMOKE_DONE';
      byId('out').textContent = out.join('\\n');
    } catch (e) {
      document.title = 'SMOKE_DONE';
      byId('out').textContent = out.join('\\n') + '\\nEXCEPTION ' + (e && e.message);
    }
  })();
})();
`;

const page = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Smoke</title>
<style>${style}</style>
</head>
<body>
${bodyMarkup}
<script>
try { window.localStorage.getItem('x'); } catch (e) {
  const m = new Map();
  Object.defineProperty(window, 'localStorage', { value: {
    getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null),
    setItem: (k, v) => m.set(String(k), String(v)),
    removeItem: (k) => m.delete(String(k)),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  }});
}
</script>
<script>
${appScript}
</script>
<script>${harness}</script>
<pre id="out" style="position:fixed;top:0;left:0;background:#fff;color:#000;z-index:9999;font-size:11px;padding:6px;max-width:100vw;white-space:pre-wrap;">EN COURS</pre>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'smoke-standalone.html'), page);
console.log('smoke-standalone.html généré :', page.length, 'octets');
