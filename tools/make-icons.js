'use strict';
/* Génère les icônes PWA (PNG 192 et 512) à partir de homeBiker.svg.
 * Zéro dépendance : rasterisation via le canvas natif de Chrome (headless),
 * pages temporaires ouvertes en file:// (aucun réseau).
 * Usage : node tools/make-icons.js   (nécessite Chrome/Chromium installé)
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const RACINE = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(RACINE, 'homeBiker.svg'), 'utf8');
const DIR = path.join(RACINE, 'icons');
fs.mkdirSync(DIR, { recursive: true });

const VB = svg.match(/viewBox="([\d.\s]+)"/)[1].trim().split(/\s+/).map(Number);
const [, , vw, vh] = VB;
const logoRatio = 0.78; // le logo occupe 78 % de l'icône (zone de sécurité maskable)
const b64 = Buffer.from(svg, 'utf8').toString('base64');

const chrome = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/opt/google/chrome/chrome']
  .find((p) => fs.existsSync(p));
if (!chrome) { console.error('Chrome/Chromium introuvable'); process.exit(1); }

const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'icons-'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'icons-page-'));
try {
  for (const cote of [192, 512]) {
    const page = path.join(tmp, `icon-${cote}.html`);
    fs.writeFileSync(page, `<!DOCTYPE html><canvas id="c" width="${cote}" height="${cote}"></canvas><script>
const img = new Image();
img.onload = () => {
  const ctx = document.getElementById('c').getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, ${cote}, ${cote});
  const taille = ${cote} * ${logoRatio};
  const echelle = taille / Math.max(${vw}, ${vh});
  const lw = ${vw} * echelle, lh = ${vh} * echelle;
  ctx.drawImage(img, (${cote} - lw) / 2, (${cote} - lh) / 2, lw, lh);
  const a = document.createElement('a');
  a.id = 'out'; a.textContent = document.getElementById('c').toDataURL('image/png');
  document.body.appendChild(a);
  document.title = 'OK';
};
img.onerror = () => { document.title = 'ERREUR'; };
img.src = 'data:image/svg+xml;base64,${b64}';
</script>`);
    const out = execFileSync(chrome, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-dev-shm-usage',
      `--user-data-dir=${profil}`, '--virtual-time-budget=5000', '--dump-dom',
      'file://' + page,
    ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60000 });
    const m = out.match(/<a id="out"[^>]*>(data:image\/png;base64,[A-Za-z0-9+/=]+)<\/a>/);
    if (!m) { console.error(`PNG ${cote} : data URL introuvable (title=${(out.match(/<title>([^<]*)<\/title>/) || [])[1]})`); process.exit(1); }
    const dest = path.join(DIR, `icon-${cote}.png`);
    fs.writeFileSync(dest, Buffer.from(m[1].split(',')[1], 'base64'));
    console.log(`${path.basename(dest)} écrit (${fs.statSync(dest).size} octets)`);
  }
} finally {
  fs.rmSync(profil, { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
}
