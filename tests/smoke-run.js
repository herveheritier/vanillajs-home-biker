'use strict';
/* Génère la page de smoke test, l'exécute sous Chrome headless et affiche le rapport.
 * Usage : node tests/smoke-run.js   (nécessite Chrome/Chromium)
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

execFileSync(process.execPath, [path.join(__dirname, 'smoke-gen.js')], { stdio: 'inherit' });

const chrome = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/opt/google/chrome/chrome']
  .find((p) => fs.existsSync(p));
if (!chrome) { console.error('Chrome/Chromium introuvable'); process.exit(1); }

const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-'));
try {
  const dom = execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-dev-shm-usage',
    `--user-data-dir=${profil}`, '--virtual-time-budget=30000', '--dump-dom',
    'file://' + path.join(__dirname, 'smoke-standalone.html'),
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
  const m = dom.match(/<pre id="out"[^>]*>([\s\S]*?)<\/pre>/);
  if (!m) { console.error('Rapport introuvable dans le DOM'); process.exit(1); }
  const lignes = m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim().split('\n');
  for (const l of lignes) console.log(l);
  const ko = lignes.filter((l) => l.startsWith('KO ') || l.includes('EXCEPTION'));
  process.exit(ko.length ? 1 : 0);
} finally {
  fs.rmSync(profil, { recursive: true, force: true });
}
