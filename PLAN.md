# Plan d'action - Déduplicateur

## Stack technique
- **Backend** : Rust (Tauri) - hachage xxhash, parallélisme Rayon
- **Frontend** : React + TypeScript + Tailwind CSS + shadcn/ui
- **Packaging** : `.exe` autonome via `tauri build`

---

## Phase 1 - Moteur exact + UI minimale ✅
**Objectif : avoir un `.exe` qui tourne sur un vrai dossier**

- [x] Initialiser le projet Tauri + React
- [x] Moteur Rust : grouper par taille de fichier
- [x] Moteur Rust : hash complet (xxhash) des candidats
- [x] UI : champ de sélection de dossier + bouton "Analyser"
- [x] UI : liste des groupes de doublons avec fichiers dépliables
- [x] Suppression vers la corbeille
- [x] Validé sur un vrai dossier (626 fichiers, 10 groupes, 11.4 Mo, 105 ms)

**Critère de validation : détecter et supprimer des doublons exacts dans un dossier plat**

---

## Phase 2 - Performance + filtrage en cascade ✅
**Objectif : tenir sur des dossiers de plusieurs milliers de fichiers**

- [x] Ajouter hash partiel (4 Ko) entre tri par taille et hash complet
- [x] Parallélisme avec Rayon
- [x] Barre de progression dans l'UI (fichiers traités / total)
- [x] Affichage du temps d'analyse et de l'espace récupérable
- [x] Sessions persistantes (JSON dans `~/.local/share/deduplicateur/sessions/`)
- [x] Pagination des résultats (50 groupes par page, chargement à la demande)
- [x] Annulation du scan en cours

**Critère de validation : analyser 50 000 fichiers en moins de 30 secondes**

---

## Phase 3 - Interface soignée ✅
**Objectif : UX agréable et utilisable**

- [x] Dark mode + thème cohérent
- [x] Gestion des erreurs (banner d'erreur, fichier absent ignoré silencieusement)
- [x] Liste des groupes avec colonnes (nom, date modifié, dossier)
- [x] Sélection intelligente : "tout cocher", "garder le plus récent", "garder le plus ancien"
- [x] Confirmation avant suppression avec récapitulatif (N fichiers, X Mo)

**Critère de validation : test utilisateur sur un vrai cas d'usage**

---

## Phase 4 - Sous-dossiers
**Objectif : traiter une arborescence entière, dossier par dossier**

- [x] Parcours récursif de l'arborescence (walkdir)
- [x] Option : inclure ou exclure les sous-dossiers (toggle + panneau d'exclusions)
- [x] Analyse indépendante par dossier (pas de comparaison cross-dossiers) - mode "Par sous-dossier"
- [x] UI : vue arborescente des résultats (dossier → groupes de doublons)

**Critère de validation : analyser `/Photos` avec 20 sous-dossiers sans mélanger les résultats**

---

## Phase 5 - Similarité images ✅
**Objectif : détecter les mêmes images en formats/résolutions différents**

- [x] Intégrer `image_hasher` (gradient hash, résolution-agnostique)
- [x] Pipeline séparé pour les fichiers image (jpg, png, webp, bmp, gif, tiff, avif)
- [x] Seuil de similarité configurable dans l'UI (slider 0-20 bits, défaut 10)
- [x] Thumbnails dans la liste des groupes (backend resize + base64 data URL)
- [x] Affichage côte à côte des doublons visuels (grille de thumbnails 120x120)
- [x] Les doublons exacts sont exclus de la phase pHash (pas de double signalement)
- [x] Option "Détecter les images similaires" - inactif par défaut (pas d'impact sur les scans sans images)

**Critère de validation : détecter photo.jpg (640x480) et photo_hd.webp (1920x1080) comme doublons**

---

### Optimisations pHash ✅
- [x] `ScanParams` struct (remplace les parametres individuels de `scan_folder`)
- [x] `phash_config.rs` : `PHashConfig` (13 champs, JSON, defauts raisonnables), 4 tests
- [x] `phash_cache.rs` : `HashCache` (mtime + tailles de hash = invalidation), 8 tests
- [x] `phash_perf.rs` : `PerfEntry` (timings, compteurs, snapshot config), JSONL, 4 tests
- [x] Optimisation 1 : filtre de taille minimale (s'active si n >= `min_images_size_filter`)
- [x] Optimisation 2 : filtre de ratio d'aspect (lecture d'en-tete, s'active si n >= `min_images_aspect_filter`)
- [x] Optimisation 3 : hash en 2 passes (coarse 4x4 + fine 8x8 en un decode, s'active si n >= `min_images_two_pass`)
- [x] Optimisation 4 : cache inter-scans (phash_cache.json, invalide si mtime ou tailles changent)
- [x] Optimisation 5 : comparaison parallele rayon (`flat_map_iter`, s'active si n >= `min_images_parallel_compare`)
- [x] Log de perf (phash_perf.jsonl, mode dev, desactive par defaut)
- [x] Commandes Tauri : `get_phash_config`, `set_phash_config`
- [x] UI : panneau avancé collapsible (taille min, tolerance ratio, cache, parallelisme, dev)
- [x] UI : taille individuelle par fichier dans les groupes similaires
- [x] 43 tests Rust (dont 5 nouveaux sur les optimisations)

---

## Phase 6 - Similarité vidéos
**Objectif : détecter les mêmes vidéos en formats/résolutions différents**

- [ ] Intégrer `ffmpeg-next` pour l'extraction de frames
- [ ] Échantillonnage de N frames à intervalles réguliers
- [ ] Comparaison de séquences de pHash (alignement temporel approximatif)
- [ ] Seuil de similarité configurable
- [ ] Affichage des métadonnées vidéo (durée, résolution, codec, poids)

**Critère de validation : détecter film.avi (480p) et film.mp4 (1080p) comme doublons**
