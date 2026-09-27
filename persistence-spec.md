# Spécification — Persistance du carnet malgré l'effacement du localStorage (« coffre de secours »)

- **Projet** : HomeBiker — carnet de séances de vélo d'appartement (`index.html` unique, vanilla JS, zéro dépendance, zéro build)
- **Date** : 2026-09-27
- **Statut** : **implémenté** (2026-09-27) — le coffre est livré dans `index.html` ; les écarts d'implémentation sont consignés en §17

---

## 1. Problème

L'application stocke tout dans le **localStorage** du navigateur :

| Clé | Contenu |
|---|---|
| `carnet-trajets-users` | liste des profils `{ id, name }` |
| `carnet-trajets-current` | profil actif |
| `carnet-trajets-u-<id>` | séances du profil (une clé par profil) |
| `carnet-trajets-chart-*` | préférences des couches du graphique |
| `carnet-trajets-v1` | (legacy, migré au premier lancement) |

Sur le téléphone de l'auteur, le navigateur utilisé est **DuckDuckGo (Android)**, qui efface **tout le stockage web à la fermeture** (mode éphémère par conception, bouton « Fire », effacement automatique des données de session). Résultat : **le carnet disparaît à chaque fermeture du navigateur**, et l'export CSV manuel — seul mécanisme actuel — n'est pas un réflexe fiable.

### Constat technique (recherche effectuée)

- DuckDuckGo Android vide localStorage **et** IndexedDB **et** le cache à la fermeture : **aucune API de stockage web ne peut y survivre**. Toute solution « magique » côté navigateur est exclue.
- En revanche, DuckDuckGo Android **enregistre les téléchargements** dans le dossier `Téléchargements` du téléphone (ils survivent à la fermeture), supporte le **presse-papiers** et expose généralement l'**API de partage natif** (`navigator.share`) — le rendu passe par le WebView système ; la disponibilité de `navigator.share` doit être **détectée à l'exécution** avec repli automatique.
- Même hors cas DuckDuckGo, Safari (ITP) supprime le stockage script-writable après 7 jours sans interaction : le problème dépasse le seul navigateur concerné aujourd'hui.

**Conclusion directrice** : puisque la mémoire du navigateur est condamnée dans le contexte cible, la persistance doit passer par des **sorties volontaires du navigateur** (fichier téléchargé, partage système, presse-papiers, QR code) qui vivent dans la mémoire du téléphone, pas dans le navigateur. L'app doit rendre cette sortie **quasi automatique, en un clic**, et la rentrée (restauration) **triviale**.

---

## 2. Décisions recueillies auprès de l'utilisateur (entretien)

| Question | Décision |
|---|---|
| Navigateur mobile concerné | **DuckDuckGo (Android)** |
| Périmètre de « la saisie » à persister | **Le carnet enregistré** (pas le brouillon du formulaire) |
| Données dans le cloud | **Non — 100 % local, aucun serveur, aucune dépendance** (contrainte absolue) |
| Multi-appareils | **Oui, téléphone + ordinateur, carnets synchronisés** |
| Compromis « installer en PWA via Safari/Chrome » | **Refusé — rester sur le navigateur actuel et trouver une parade** |
| Méthode de transfert | **Combinaison** : fichier + texte à coller + QR code |
| Fréquence de saisie | Irrégulière (rattrapage de plusieurs séances d'un coup) |
| OS mobile | **Android** |
| Déclenchement de la sauvegarde | **Automatique après modification + manuel** (bandeau 1 clic) |
| Portée des sauvegardes | **Tout** : tous les profils et tous les carnets dans un seul fichier |
| Format | **JSON complet** (profils, séances, préférences, horodatage) |
| Friction acceptable | **Bandeau discret « sauvegarde à faire » → 1 clic** |
| Restauration sur appareil non vide | **Choix à l'import** : fusionner (anti-doublons) ou remplacer — comme l'import CSV actuel |
| QR code | **Carnet compressé** ; au-delà de la capacité, message invitant à utiliser fichier/partage |
| Nommage des fichiers | **Daté** : `homebiker-sauvegarde-YYYY-MM-DD-HHMM.json` |

---

## 3. Objectifs

1. **Ne plus jamais perdre le carnet** dans un navigateur éphémère : après chaque session de saisie, l'utilisateur peut — en un geste — faire sortir une sauvegarde complète hors du navigateur.
2. **Restaurer en quelques secondes** sur le même appareil (nouvelle session DuckDuckGo) ou sur un autre appareil (synchro manuelle téléphone ↔ ordinateur).
3. **Rester 100 % local** : aucun réseau, aucun compte, aucun service tiers ; les données ne quittent l'appareil que si l'utilisateur le décide (partage système).
4. **Conserver les contraintes du projet** : un seul `index.html`, vanilla JS, zéro dépendance externe, zéro build, hébergement GitHub Pages inchangé.
5. Garder l'**export/import CSV existant** intact (compatibilité Excel/LibreOffice), la sauvegarde JSON venant s'ajouter à côté.

## 4. Non-objectifs (explicitement exclus)

- Persister le **brouillon** du formulaire en cours (hors périmètre retenu).
- Tout stockage « qui survit » dans le navigateur éphémère (impossible par conception) — y compris IndexedDB/OPFS : ils subissent le même sort dans DuckDuckGo, et ITP Safari les purge aussi à 7 jours. Un miroir IndexedDB n'apporterait rien au cas cible.
- Synchronisation automatique en arrière-plan, serveur de synchro, chiffrement cloud, PWA/manifest/service worker (refusés par l'utilisateur pour le cas cible ; pourraient faire l'objet d'une spec séparée).
- Découpage multi-QR (chaînage de plusieurs QR codes) : une seule image QR, avec repli sur fichier au-delà de la capacité.

---

## 5. Solution proposée : le « coffre de secours » HomeBiker

### 5.1 Vue d'ensemble

Un nouveau module JS interne au `index.html`, organisé autour de 4 briques :

1. **Format de sauvegarde JSON « coffre »** (§6) — snapshot complet et fidèle de l'app.
2. **Moteur de sortie** (§7) — génère le coffre et le fait sortir par le meilleur canal disponible : téléchargement, partage natif, presse-papiers, QR code.
3. **Moteur d'entrée** (§8) — restaure un coffre : fichier (`.json`), texte collé, QR scanné — avec modale de fusion/remplacement par profil.
4. **Bandeau de sauvegarde** (§9) — rappel discret après toute modification, sauvegarde en un clic.

### 5.2 Principe de détection de capacité

À chaque sortie, l'app détecte dans l'ordre :

1. `navigator.canShare?.({ files: [file] })` → **partage natif** (Android/iOS : feuille de partage, l'utilisateur envoie vers Drive, WhatsApp, « Fichiers », etc.) ;
2. sinon téléchargement via Blob + `<a download>` (**tous navigateurs**, DuckDuckGo inclus — vérifié) ;
3. `navigator.clipboard.writeText` pour le canal texte (bouton dédié, pas automatique).

La disponibilité réelle dans DuckDuckGo (WebView) devra être **vérifiée à l'exécution** et jamais supposée : chaque bouton applique le repli automatiquement, et un toast confirme ce qui s'est passé.

---

## 6. Format du coffre de sauvegarde (JSON v2)

```json
{
  "app": "homebiker",
  "format": 2,
  "exporte": "2026-09-27T14:32:05.000Z",
  "appareil": { "ua": "<navigator.userAgent tronqué>", "nom": "Optionnel — alias lisible de l'appareil" },
  "profils": [
    {
      "id": "u1abcd",
      "nom": "Hervé",
      "seances": [
        {
          "date": "2026-09-26", "de": "19:05", "a": "19:48",
          "depart": 1240.5, "arrivee": 1283.2, "force": 4,
          "distance": 42.7,
          "maj": "2026-09-26T19:50:00.000Z"
        }
      ]
    },
    { "id": "u2efgh", "nom": "Camille", "seances": [] }
  ],
  "prefs": { "couches": { "dist": "1", "vit": "1", "slot": "1" } }
}
```

Règles :

- **Un seul fichier pour tout** : profils, carnets, préférences de graphique, horodatage d'export. Le profil actif n'est pas restauré comme « actif » (l'appareil garde le sien) mais le premier profil du fichier est proposé par défaut si l'appareil est vide.
- **Champ `maj`** (horodatage de dernière modification) ajouté à chaque séance *au moment de l'ajout/correction* : c'est lui qui arbitre les conflits de fusion (§8.3). Les données existantes n'ont pas de `maj` : elles sont traitées comme « plus anciennes » et reçoivent `maj = date d'export` lors de leur première exportation dans un coffre.
- `format: 2` permet d'évoluer plus tard sans casser ; l'import d'un format inconnu → message clair, rien n'est modifié.
- Le CSV existant **reste inchangé** (compatibilité Excel, import « maison »). Le coffre n'est pas lisible dans Excel, c'est voulu : il est fidèle et complet, le CSV reste le format d'échange bureautique.

---

## 7. Sorties (boutons et déclencheurs)

### 7.1 Bouton « 💾 Sauvegarder » ( Manuel)

- Dans la barre d'actions du carnet (à côté d'« Exporter en CSV ») **et** dans le bandeau (§9).
- Un clic = génération du coffre + sortie par le meilleur canal (§5.2) + toast « ✓ Sauvegarde prête » (ou « ✓ Partagée » si `navigator.share`).
- La sortie par défaut est **le téléchargement du fichier daté** — c'est le canal le plus fiable sur DuckDuckGo Android.

### 7.2 « 📤 Partager » (partage natif, quand disponible)

- Génère le même fichier JSON mais passe par `navigator.share({ files: [File] })` → la feuille de partage Android s'ouvre (Drive, Telegram, « Enregistrer dans Fichiers »…).
- Si `navigator.share` ou le partage de fichiers n'est pas disponible : repli silencieux sur le téléchargement (même comportement que 7.1), toast l'indiquant.

### 7.3 « 📋 Copier le coffre » (texte)

- Génère le coffre JSON **compressé + encodé** en une ligne : préfixe `HMBK2:` + base64url du JSON compressé (§10 compression). Exemple : `HMBK2:eNrtW…`
- Copie dans le presse-papiers, toast de confirmation. L'utilisateur peut coller ce texte dans WhatsApp/e-mail/notes — il survivra à l'effacement du navigateur.
- Le texte collé sera importable via la même modale que le fichier (§8.2) : la modale détecte le préfixe `HMBK2:`.

### 7.4 « 🔳 Afficher le QR » (appareil → appareil, sans fil)

- Génère le coffre compressé (même charge utile que 7.3), l'affiche en **QR code** dans une modale (SVG, thème clair/sombre respecté).
- **Générateur QR embarqué** dans le `index.html` : encodeur QR minimal (~250–300 lignes, implémentation du type domaine public / MIT réécrite), niveau de correction d'erreur `M`, mode byte. Zéro dépendance réseau — la contrainte « aucune dépendance » est préservée.
- **Capacité** : un QR version 29/40 en mode byte tient ~1 000–1 800 octets utiles ; avec la compression (~40–50 octets/séance compressée, cf. §10), l'objectif est de couvrir **un carnet de 20 à 30 séances**. Au-delà, la modale affiche : *« Carnet trop volumineux pour un QR code — utilisez Sauvegarder (fichier) ou Copier le coffre. »* — aucun découpage multi-QR (exclusion §4).
- **Lecture** (§8.4) : l'appareil récepteur scanne avec l'appareil photo via l'API `BarcodeDetector` (disponible sur les navigateurs Chromium Android récents, dont les WebView système récents) ; si l'API est absente, le bouton scanner est masqué et un texte invite à utiliser fichier/copier-coller.

### 7.5 Nommage du fichier

- `homebiker-sauvegarde-<AAAA-MM-JJ>-<HHMM>.json` (heure locale). Le datage évite l'accumulation ambiguë de `fichier (1).json` et matérialise un historique naturel dans `Téléchargements/`.
- Option de l'ancien nom fixe non retenue.

---

## 8. Entrées (restauration / synchronisation)

### 8.1 Point d'entrée unique

Un bouton **« ♻ Restaurer »** (à côté de « Importer un CSV ») ouvre une modale avec trois onglets/choix :

1. **Fichier** — `<input type="file" accept=".json,application/json">` (sélecteur Android : Derniers fichiers → `Téléchargements`).
2. **Coller un coffre** — zone de texte ; détecte `HMBK2:` (décompression) ou JSON brut.
3. **Scanner un QR** — visible seulement si `BarcodeDetector` est disponible ; ouvre la caméra (`getUserMedia`), décode, charge.

L'import CSV existant garde son bouton et son flux propres — aucune régression.

### 8.2 Modale de restauration (aperçu avant application)

Avant toute modification, la modale présente :

- date de la sauvegarde, appareil d'origine ;
- par profil : nom, nombre de séances, emprise sur les données locales (profil existant / à créer / conflits) ;
- deux boutons d'action :
  - **Fusionner** (recommandé, défaut) : anti-doublons + résolution de conflits (§8.3) ;
  - **Remplacer** : chaque profil présent dans le coffre écrase intégralement son homologue local ; les profils locaux absents du coffre **sont conservés** (jamais de perte silencieuse) ;
  - **Annuler** (Échap) : rien n'est modifié.

La restauration d'un **appareil vide** (cas DuckDuckGo après effacement : carnet vide) saute la modale de choix et applique directement le coffre **en remplacement** avec un toast « ✓ Carnet restauré (X séances, Y profils) » — c'est le chemin le plus fréquent, il doit être le plus court.

### 8.3 Fusion et conflits

- **Clé d'identité d'une séance** : `(profil, date, heure début, heure fin, compteur début, compteur fin)` — la même que l'anti-doublon CSV actuel, étendue au profil.
- Séance présente des deux côtés avec **valeurs identiques** → ignorée (déjà comptée « doublon ignoré » dans le récapitulatif).
- Même clé mais **valeurs différentes** (ex. résistance ou compteur corrigé sur un appareil) → **la version au `maj` le plus récent gagne** ; l'ancienne est remplacée. Sans `maj` comparable, la version du **coffre** gagne (il vient d'être exporté exprès).
- La fusion **re-chaîne** le carnet : les séances sont retriées chronologiquement ; si la fusion crée une incohérence de chaînage (compteur début N < compteur fin N−1), un avertissement est affiché dans le récapitulatif final (même logique d'esprit que le blocage « distance négative » de l'édition) sans bloquer l'import.
- Récapitulatif final en toast + détail dans la modale : `X ajoutée(s) · Y mise(s) à jour · Z doublon(s) ignoré(s) · W profil(s) créé(s)`.

### 8.4 Scan QR (récepteur)

- Modale avec flux vidéo, cadre de visée, décodage continu via `BarcodeDetector` ; dès décodage d'un payload `HMBK2:` → fermeture caméra, puis §8.2.
- Autorisation caméra refusée / API absente → message avec alternative (fichier, copier-coller).

---

## 9. Bandeau « sauvegarde à faire » (anti-oubli)

- **Déclenchement** : après tout ajout, correction (inline ou propagée), suppression ou effacement de séances — c'est-à-dire après tout `save()` qui modifie un carnet. La **restauration n'est pas** une modification (l'état vient d'être écrit : bandeau masqué).
- **Forme** : bandeau discret sous le formulaire ou dans l'en-tête du carnet — `💾 Sauvegarde à faire — dernière il y a 2 séances` + bouton **Sauvegarder** (1 clic, §7.1) + bouton fermer (✕, se réaffiche à la prochaine modification).
- **Mémoire de l'état** :
  - Compteur `nonSauvegarde` (nombre de modifications depuis la dernière sortie de coffre) conservé en mémoire de session et reflété dans le localStorage quand il est disponible (navigateurs persistants : le bandeau tient compte de l'historique).
  - Dans un navigateur éphémère, le localStorage repart de zéro à chaque session : après restauration, le compteur repart de 0 ; après saisie, il repasse à 1 → le bandeau réapparaît, ce qui est **le comportement voulu** (la sauvegarde doit être refaite à chaque session de saisie).
- **Ton non agressif** : pas de bloquant, pas de temporisation ; l'utilisateur reste maître (fréquence « irrégulière » assumée — c'est le bandeau qui rattrape, pas une contrainte).

---

## 10. Compression (canal texte/QR)

- Utiliser l'API native **`CompressionStream('deflate-raw')`** (Chromium récent — présent dans les WebView Android récents) avec repli : si l'API est absente, le canal texte envoie le JSON tel quel (base64 sans compression) et le QR affiche l'estimation réelle ; aucun échec silencieux.
- Ordre : JSON → `TextEncoder` → deflate-raw → base64url → `HMBK2:` + charge. À l'entrée : détection du préfixe, base64url → inflate → `JSON.parse`.
- Une séance ≈ 130 octets de JSON ≈ 40–50 octets compressés ; objectif QR ~25 séances, cohérent avec §7.4.

---

## 11. Matrice de comportement par navigateur

| Environnement | Stockage | Sortie coffre | Effet attendu |
|---|---|---|---|
| **DuckDuckGo Android** (cible) | effacé à la fermeture | téléchargement ✔ (partage natif à confirmer à l'exécution) | Saisie → bandeau → 1 clic → fichier dans `Téléchargements/`. Session suivante : Restaurer → fichier → carnet retrouvé. |
| Safari iOS (ITP) | purgé après ~7 jours sans visite | partage natif ✔ | Le coffre file sert de filet ; visite régulière = carnet intact. |
| Chrome Android / desktop | persistant | téléchargement + partage + presse-papiers | Le coffre devient l'outil de synchro inter-appareils. |
| Vue « appareil neuf » | vide | — | Restauration directe en remplacement (§8.2). |

---

## 12. Scénarios nominaux (à couvrir par les tests d'acceptation)

1. **Session DuckDuckGo type** : ouvrir l'app → restaurer le dernier coffre (`Téléchargements/`) → saisir 2 séances → bandeau → Sauvegarder → fermer le navigateur → rouvrir → stockage vide → restaurer → les 2 séances sont là.
2. **Synchro téléphone → ordinateur** : sur le téléphone, Sauvegarder → envoyer le fichier à l'ordinateur (Drive/mail) → sur l'ordinateur, Restaurer → Fusionner → les nouvelles séances apparaissent, les doublons sont ignorés.
3. **Synchro ordinateur → téléphone par QR** : ordinateur affiche le QR → téléphone scanne → restauration fusionnée (~25 séances max).
4. **Conflit** : résistance corrigée sur l'ordinateur, compteur corrigé sur le téléphone → fusion → pour chaque séance en conflit, la version au `maj` le plus récent gagne, récapitulatif exact.
5. **Refus/annulation** : annuler la feuille de partage, fermer la modale de restauration, refuser la caméra → aucun changement d'état, messages appropriés.
6. **Coffre corrompu / format inconnu / fichier CSV donné au sélecteur JSON** → message d'erreur clair, données locales intactes.
7. **Coffre trop gros pour le QR** → message invitant au fichier/copier-coller.
8. **Non-régression** : export/import CSV (y compris multi-profils, anciens en-têtes, séparateur `,`/`;`), édition chaînée, propagation, profils — inchangés.

## 13. Cas limites et règles de protection

- **Jamais de perte silencieuse** : toute entrée passe par un aperçu ; « Remplacer » ne touche que les profils présents dans le coffre.
- **Double comptage impossible** : clé d'identité stable (§8.3) ; l'export n'ajoute jamais de champ qui changerait la clé.
- **Profils renommés entre deux exports** : la fusion se fait par `id` si l'id existe encore, sinon par nom normalisé (comme l'import CSV) ; un même carnet ne doit pas se dupliquer en deux profils — en cas d'ambiguïté (même nom, ids différents), la modale demande.
- **Horloge locale faussée** : le `maj` reste comparable entre appareils d'un même utilisateur ; un `maj` futur (> maintenant + 5 min) est signalé dans l'aperçu mais accepté.
- **Téléchargement échoué** (fichier 0 octet, quotas) : détecter l'échec quand possible et proposer le canal copier-coller en repli.
- **Accessibilité** : modales existantes réutilisées (focus piégé, Échap/Entrée, rôles ARIA déjà en place) ; le QR porte un `aria-label` descriptif ; la caméra a un bouton Fermer clavier-accessible.
- **Taille du fichier unique** : +~10–14 Ko (encodeur QR + logique coffre) sur un fichier déjà ~65 Ko — acceptable, pas de séparation en plusieurs fichiers (contrainte projet).

## 14. Confidentialité

- Aucun réseau ajouté : la compression, le QR et le JSON sont produits localement ; `navigator.share` délègue à l'OS **au geste explicite de l'utilisateur**.
- Le coffre contient des données de santé/sport légères mais personnelles (profils) : le canal texte invite à ne le coller que dans des canaux privés (mention dans la modale).
- Section README « Données & confidentialité » mise à jour : remplacer le conseil « pensez à exporter en CSV » par la description du coffre automatique + CSV pour Excel.

## 15. Livrables

1. `index.html` : module coffre (sorties §7, entrées §8, bandeau §9, compression §10, encodeur QR embarqué), champ `maj` sur les séances, CSS du bandeau et des modales (thème clair/sombre, mobile first).
2. `README.md` : sections « Fonctionnalités », « Mode d'emploi » (nouvelle sous-section « Sauvegarder / Restaurer / Synchroniser vos appareils »), « Données & confidentialité », « Technique » (toujours un seul fichier, zéro dépendance).

## 16. Questions ouvertes (non bloquantes)

- Confirmer à l'exécution sur DuckDuckGo Android : `navigator.share` avec fichiers, `CompressionStream`, `BarcodeDetector` (la spec prévoit déjà les replis pour chaque absence).
- Le repli « JSON non compressé » du canal texte peut dépasser la commodité du copier-coller pour de très gros carnets : acceptable (canal secondaire) ou plafonner avec renvoi vers le fichier.

## 17. Écarts d'implémentation (constatés pendant la réalisation)

1. **Boutons de sortie** : les quatre canaux (fichier, partage, copie, QR) sont regroupés dans la modale **💾 Sauvegarder** plutôt que dispersés dans la barre d'actions — un seul point d'entrée, la disponibilité du partage natif est détectée avant d'afficher les choix. Le canal téléchargement reste la sortie par défaut du bandeau (§7.1) et du canal partage en cas d'annulation ou d'échec.
2. **Chiffres QR (§7.4)** : en niveau M la version 40 embarque 2 334 octets de données ; après l'inflation base64 (~1,33×), le plafond utile est d'environ 1 650 octets, soit **~20 séances réelles** plutôt que 25. L'encodage auto-alphabétique des dates peut être envisagé plus tard (format 3) pour remonter à ~25–30 ; l'app affiche déjà le message de repli au-delà de la capacité.
3. **Restauration, choix fusion/remplacement** : l'aperçu (§8.2) montre l'emprise par profil (existant / à créer, séances déjà présentes) avec avertissements §13 (horodatages futurs, profils même-nom/ids-différents), puis un choix global s'applique à tous les profils du coffre — la variante « choix par profil » n'est pas offerte (UI plus simple, couvre les scénarios §12).
4. **Profil actif sur appareil vide** : la restauration applique le coffre puis rend actif le **premier profil du coffre** (sinon l'utilisateur verrait un carnet vide après restauration) ; la spec §6 disait « proposé par défaut ».
5. **Tri, chaînage, avertissement §8.3** : la fusion retire de la carte les sort par date+heure croissants ; l'avertissement de chaînage du §8.3 (chevauchement de compteurs) n'est pas affiché — le chaînage est contrôlé à la saisie/édition, une fusion restaure des valeurs historiques ; à considérer dans une itération si le besoin se confirme.
6. **Tests** : harnais Node (`.freebuff/coffre-test.js`) validant l'encodeur QR (aller-retour via le décodeur indépendant jsQR, versions 1→40), le codec HMBK2 et le pipeline 25 séances ; smoke UI headless Chromium (`.freebuff/smoke-gen.js` → `.freebuff/smoke-standalone.html`, 19 vérifications : restauration directe + bascule de profil, fusion anti-doublons, bandeau, modales, rejet de contenu étranger).
