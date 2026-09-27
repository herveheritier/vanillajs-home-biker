/* HomeBiker — service worker minimal (v1)
 * Rôles :
 *  1. rendre l'app installable et disponible hors-ligne (précache de l'app) ;
 *  2. réacheminer vers la page le fichier/texte du coffre reçu via le
 *     partage système Android (share_target POST multipart) ;
 *  3. servir l'app depuis le cache d'abord, en se rafraîchissant en arrière-plan.
 * Zéro dépendance, zéro réseau sortant : seuls les fichiers de l'app sont mis en cache.
 */
const CACHE = 'homebiker-v1';
const PRECACHE = [
  './index.html',
  './manifest.json',
  './homeBiker.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (err) { /* optionnel */ }
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  // La page peut forcer l'activation immédiate après un changement de version.
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;

  // Partage entrant (share_target) : le POST multipart contient le coffre.
  // On l'extrait, on le dépose dans une clé de cache dédiée, puis on redirige
  // la page vers #partage-entrant : elle ira lire le cache.
  if (req.method === 'POST') {
    e.respondWith((async () => {
      try {
        const formulaire = await req.formData();
        const fichier = formulaire.get('coffre');
        const texte = formulaire.get('texte') || formulaire.get('titre') || '';
        let contenu = null;
        if (fichier && typeof fichier.text === 'function') contenu = await fichier.text();
        else if (texte && String(texte).startsWith('HMBK2:')) contenu = String(texte);
        if (contenu) {
          const cache = await caches.open('homebiker-partage');
          await cache.put('coffre-entrant', new Response(contenu, { headers: { 'content-type': 'text/plain' } }));
        }
      } catch (err) { /* corps illisible : la page affichera un message d'échec */ }
      try { await e.preloadResponse; } catch (err) { /* pas de preload */ }
      return Response.redirect('./index.html#partage-entrant', 303);
    })());
    return;
  }

  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // ne touche à rien d'externe

  // Navigation : cache d'abord (hors-ligne), réseau en fond si le SW est vieux.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try { const pre = await e.preloadResponse; if (pre) { caches.open(CACHE).then((c) => c.put('./index.html', pre.clone())); return pre; } } catch (err) { /* */ }
      const cache = await caches.open(CACHE);
      const enCache = (await cache.match('./index.html')) || (await cache.match(req));
      e.waitUntil((async () => {
        try {
          const frais = await fetch(req);
          if (frais && frais.ok) await cache.put('./index.html', frais.clone());
        } catch (err) { /* hors-ligne : le cache suffit */ }
      })());
      return enCache || fetch(req);
    })());
    return;
  }

  // Autres ressources de l'app : cache d'abord + rafraîchissement en arrière-plan.
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const enCache = await cache.match(req);
    e.waitUntil((async () => {
      try {
        const frais = await fetch(req);
        if (frais && frais.ok) await cache.put(req, frais.clone());
      } catch (err) { /* hors-ligne */ }
    })());
    return enCache || fetch(req);
  })());
});
