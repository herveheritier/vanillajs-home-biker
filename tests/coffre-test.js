'use strict';
/* Harnais de test du « coffre de secours » HomeBiker.
 * Extrait le bloc pur (QR + codec HMBK2) de index.html et le valide :
 *  1. aller-retour QR (générateur embarqué → décodeur indépendant jsQR) ;
 *  2. codec HMBK2 (compression deflate-raw, repli JSON brut) ;
 *  3. pipeline réaliste : coffre 25 séances → QR → décodage → restauration identique ;
 *  4. dépassement de capacité QR (message attendu côté app).
 */
const fs = require('fs');
const assert = require('assert');
const jsQR = require('jsqr');
const path = require('path');
const RACINE = path.join(__dirname, '..'); // exécutable depuis n'importe quel répertoire

const html = fs.readFileSync(path.join(RACINE, 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(m, 'script introuvable dans index.html');
const src = m[1];

const start = src.indexOf('// ---- Encodeur QR embarqué');
const end = src.indexOf('// ---- Construction du coffre');
assert.ok(start > 0 && end > start, 'bloc QR/codec introuvable');
const pure = 'const COFFRE_PREFIX = \'HMBK2:\';\nconst COFFRE3_PREFIX = \'HMBK3:\';\n' + src.slice(start, end);

eval(pure + '\nglobalThis.__T = { qrMake, qrToSVG, b64urlEncode, b64urlDecode, encodeCoffreText, decodeCoffreText, encoderCoffreCompact, decoderCoffreCompact, encodeCoffreCourt };');
const { qrMake, qrToSVG, b64urlEncode, encodeCoffreText, decodeCoffreText, encoderCoffreCompact, decoderCoffreCompact, encodeCoffreCourt } = globalThis.__T;

// Rend le SVG QR en pixels RGBA (échelle + marge) puis le décode avec jsQR
function decodeQrSvg(svg) {
  const sizeM = parseInt(svg.match(/viewBox="0 0 (\d+) /)[1], 10);
  const scale = 4, margin = 4;
  const w = sizeM * scale + margin * 2;
  const rgba = new Uint8ClampedArray(w * w * 4).fill(255);
  const re = /M(\d+) (\d+)h1v1h-1z/g;
  let mm, dark = 0;
  while ((mm = re.exec(svg))) {
    dark++;
    const x = +mm[1], y = +mm[2];
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const i = ((margin + y * scale + dy) * w + (margin + x * scale + dx)) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = 0;
    }
  }
  assert.ok(dark > 100, 'QR quasi vide ?');
  const res = jsQR(rgba, w, w);
  return { text: res && res.data, version: (sizeM - 17) / 4 };
}

(async () => {
  // 1. Aller-retour QR sur des charges variées
  const loads = [
    ['court', 'HMBK2:R_abc'],
    ['moyen 500 o', 'HMBK2:Z_' + b64urlEncode(new Uint8Array(500).map((_, i) => (i * 31 + 7) & 0xFF))],
    ['v40 ~1700 o', 'HMBK2:Z_' + b64urlEncode(new Uint8Array(1700).map((_, i) => (i * 13 + 1) & 0xFF))],
    ['accents + emoji', 'HMBK2:Z_Hervé — séance 🚴 42,7 km ; 19:05→19:48'],
  ];
  for (const [nom, charge] of loads) {
    const qr = qrMake(new TextEncoder().encode(charge));
    const svg = qrToSVG(qr);
    const dec = decodeQrSvg(svg);
    assert.strictEqual(dec.text, charge, `QR aller-retour (${nom})`);
    console.log(`  QR OK  ${nom.padEnd(14)} version ${String(dec.version).padStart(2)} (${qr.size} modules)`);
  }

  // 2. Codec HMBK2
  const obj = {
    app: 'homebiker', format: 2, exporte: '2026-09-27T14:32:05.000Z',
    appareil: { ua: 'Mozilla/5.0 (Linux; Android 14) DuckDuckGo/5' },
    profils: [{ id: 'u1abcd', nom: 'Hervé', seances: [{ date: '2026-09-26', de: '19:05', a: '19:48', depart: 1240.5, arrivee: 1283.2, force: 4, distance: 42.7, maj: '2026-09-26T19:50:00.000Z' }] }, { id: 'u2efgh', nom: 'Camille', seances: [] }],
    prefs: { couches: { dist: '1', vit: '1', slot: '1' } },
  };
  const texte = await encodeCoffreText(obj);
  assert.ok(texte.startsWith('HMBK2:'), 'préfixe HMBK2 absent');
  const recu = await decodeCoffreText(texte);
  assert.strictEqual(JSON.stringify(recu), JSON.stringify(obj), 'aller-retour codec HMBK2');
  const brut = await decodeCoffreText(JSON.stringify(obj));
  assert.strictEqual(JSON.stringify(brut), JSON.stringify(obj), 'JSON brut accepté');
  console.log(`  Codec OK  mode ${texte[6]} (${texte.length} caractères) — aller-retour identique`);

  // 2bis. Codec compact HMBK3 (§17.2 : ~30 séances par QR au lieu de ~20)
  const texteCompact = encoderCoffreCompact(obj);
  assert.ok(texteCompact, 'codec compact refusé sur un coffre valide');
  const recuCompact = decoderCoffreCompact(texteCompact);
  assert.strictEqual(recuCompact.profils.length, obj.profils.length, 'HMBK3 : profils');
  // Le maj compacté est restitué sans les millisecondes ni le Z (précision seconde) :
  // on compare les séances sans ce suffixe.
  const sansMs = (p) => p.seances.map((t) => ({ ...t, maj: t.maj && t.maj.replace(/\.\d{3}Z$/, '') }));
  assert.strictEqual(JSON.stringify(recuCompact.profils.map(sansMs)), JSON.stringify(obj.profils.map(sansMs)), 'HMBK3 : séances identiques');
  assert.deepStrictEqual(recuCompact.prefs, obj.prefs, 'HMBK3 : préférences de couches');
  const viaCourt = await encodeCoffreCourt(obj);
  assert.ok(viaCourt.startsWith('HMBK3:'), 'encodeCoffreCourt choisit HMBK3 (plus court)');
  const recupere = await decodeCoffreText(viaCourt);
  assert.strictEqual(JSON.stringify(recupere.profils.map(sansMs)), JSON.stringify(obj.profils.map(sansMs)), 'HMBK3 : aller-retour via préfixe');
  // Valeurs hors domaine : repli HMBK2 (pas de codec compact)
  const horsDomaine = { ...obj, profils: [{ id: 'u1abcd', nom: 'Hervé', seances: [{ date: '2019-12-31', de: '19:05', a: '19:48', depart: 1240.5, arrivee: 1283.2, force: 4, distance: 42.7 }] }] };
  assert.strictEqual(encoderCoffreCompact(horsDomaine), null, 'HMBK3 : séance avant 2020 refusée');
  assert.ok((await encodeCoffreCourt(horsDomaine)).startsWith('HMBK2:'), 'repli HMBK2 hors domaine');
  console.log(`  Compact OK  HMBK3 (${texteCompact.length} car. vs HMBK2 ${texte.length}) — aller-retour identique, repli vérifié`);

  // 3. Pipeline réaliste : 25 séances → coffre → texte → QR → décodage → coffre
  const seances = Array.from({ length: 25 }, (_, i) => {
    const jour = new Date(Date.UTC(2026, 0, 5 + i * 2));
    const date = jour.toISOString().slice(0, 10);
    const depart = 1000 + i * 42.7;
    return { date, de: '19:05', a: '19:48', depart: +depart.toFixed(1), arrivee: +(depart + 42.7).toFixed(1), force: 4, distance: 42.7, maj: date + 'T19:50:00.000Z' };
  });
  const gros = { ...obj, profils: [{ id: 'u1', nom: 'Hervé', seances }] };
  const texteGros = await encodeCoffreCourt(gros);
  const qrGros = qrMake(new TextEncoder().encode(texteGros));
  const decGros = decodeQrSvg(qrToSVG(qrGros));
  assert.strictEqual(decGros.text, texteGros, 'QR aller-retour (25 séances)');
  const coffreRecu = await decodeCoffreText(decGros.text);
  assert.strictEqual(coffreRecu.profils[0].seances.length, 25);
  assert.strictEqual(JSON.stringify(coffreRecu.profils), JSON.stringify(gros.profils), 'coffre 25 séances restauré (séances identiques)');
  console.log(`  Pipeline OK  25 séances → ${texteGros.length} car. (${texteGros.slice(0, 5)}) → QR v${decGros.version} → restauration identique`);

  // 3bis. Capacité mesurée : nombre maximal de séances réalistes dans un QR v40,
  // via la vraie voie de l'app (encodeCoffreCourt : le plus court de HMBK3/HMBK2).
  // NB : sur des séances parfaitement uniformes, HMBK2 (deflate) redevient plus
  // court au-delà d'un seuil — c'est le format le plus court qui compte, quel qu'il soit.
  const capacite = async (gen, nom) => {
    let n = 1, dernierOk = 0;
    while (n <= 400) {
      const coffre = { ...obj, profils: [{ id: 'u1', nom: 'Hervé', seances: gen(n) }] };
      let texte;
      try { texte = await encodeCoffreCourt(coffre); } catch (e) { texte = null; }
      if (!texte) break;
      try { qrMake(new TextEncoder().encode(texte)); dernierOk = n; n++; } catch (e) { break; }
    }
    console.log(`  Capacité ${nom.padEnd(10)} ${dernierOk} séances dans un QR (v40)`);
    return dernierOk;
  };
  const genUniformes = (n) => Array.from({ length: n }, (_, i) => {
    const depart = 1000 + i * 42.7;
    return { date: '2026-09-' + String(1 + (i % 28)).padStart(2, '0'), de: '19:05', a: '19:48', depart: +depart.toFixed(1), arrivee: +(depart + 42.7).toFixed(1), force: 4, distance: 42.7, maj: '2026-09-26T19:50:00.000Z' };
  });
  const genVariees = (n) => Array.from({ length: n }, (_, i) => {
    const depart = 1000 + i * 37.3;
    return { date: '2026-' + String(1 + (i % 12)).padStart(2, '0') + '-' + String(1 + (i % 28)).padStart(2, '0'), de: '18:' + String(10 + (i % 45)).padStart(2, '0'), a: '19:' + String((15 + i * 2) % 60).padStart(2, '0'), depart: +depart.toFixed(1), arrivee: +(depart + 38 + (i % 9)).toFixed(1), force: i % 9, distance: +(38 + (i % 9)).toFixed(1), maj: '2026-09-2' + (i % 10) + 'T19:50:00.000Z' };
  });
  const capUni = await capacite(genUniformes, 'uniformes');
  const capVar = await capacite(genVariees, 'variées');
  assert.ok(capUni >= 30, `capacité insuffisante en séances uniformes (${capUni} < 30)`);
  assert.ok(capVar >= 28, `capacité insuffisante en séances variées (${capVar} < 28)`);

  // 4. Capacité dépassée : le générateur doit lever (l'app affiche alors le message de repli).
  // Séances volontairement très variées (déflate peu, comme un vrai carnet hétérogène).
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const trop = Array.from({ length: 150 }, () => {
    const depart = 1000 + rnd() * 9000;
    const duree = 30 + rnd() * 90;
    const h = Math.floor(rnd() * 22), mn = Math.floor(rnd() * 60);
    return { date: `202${Math.floor(rnd() * 7)}-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`, de: `${String(h).padStart(2, '0')}:${String(mn).padStart(2, '0')}`, a: `${String((h + Math.floor(duree / 60)) % 24).padStart(2, '0')}:${String((mn + Math.floor(duree % 60)) % 60).padStart(2, '0')}`, depart: +depart.toFixed(3), arrivee: +(depart + duree * 0.7).toFixed(3), force: Math.floor(rnd() * 9), distance: +(duree * 0.7).toFixed(3), maj: new Date(Date.UTC(2026, 0, 1) + rnd() * 3.15e10).toISOString() };
  });
  const texteTrop = await encodeCoffreText({ ...obj, profils: [{ id: 'u1', nom: 'Hervé', seances: trop }] });
  assert.throws(() => qrMake(new TextEncoder().encode(texteTrop)), /QR too long/, 'dépassement non détecté');
  console.log(`  Capacité OK  150 séances (${texteTrop.length} car.) → « QR too long » → message de repli prévu`);

  console.log('\nTOUS LES TESTS PASSENT');
})().catch((e) => { console.error('ÉCHEC :', e.message); process.exit(1); });
