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

### Ameliorations UX ✅
- [x] Clic sur thumbnail ouvre l'image dans le visualisateur par defaut du systeme
- [x] Resultats partiels affiches en cas d'annulation (banner orange, `partial: bool` dans `ScanResult`)
- [x] Similarite minimum a 100% par defaut (seuil Hamming = 0 bits)
- [x] Noms de fichiers defilants sous la barre de progression (rafraichissement 100ms, architecture mutex+tache async)
- [x] Spinner dans les thumbnails en cours de chargement

### Qualite code ✅
- [x] `pair_passes_filters()` : logique de comparaison pHash extraite (supprime ~70 lignes en double entre branches parallele et sequentielle)
- [x] `resetResults()` : remise a zero du state React factorisee (4 occurrences)
- [x] `runSelection()` : `selectAllDuplicates` et `selectSmart` factorisees
- [x] `get_folder_groups_page` utilise `make_page()` (plus de pagination manuelle en double)
- [x] `after_aspect_filter` dans le log de perf : corrige pour refleter le vrai count post-filtre
- [x] `@keyframes spin` en double dans App.css supprime
- [x] 46 tests Rust (+3 : annulation pHash, invalidation cache mtime, filtre aspect ratio)
- [x] 13 tests TypeScript (+5 App.test.tsx : bouton retour, toggle, suppression, erreur) + setup jsdom/RTL

---

## Phase 6 - Similarité vidéos ✅
**Objectif : détecter les mêmes vidéos en formats/résolutions différents**

- [x] Subprocess ffmpeg/ffprobe (pas de crate ffmpeg-next, plus portable)
- [x] `video_hash.rs` : `get_video_metadata` (ffprobe JSON), `extract_frame_hashes` (N frames 8x8 gray → mean hash 64 bits), `extract_thumbnail` (base64 data URL), `sequence_distance`
- [x] `video_cache.rs` : cache inter-scans (clé mtime + size + n_frames), 8 tests
- [x] Phase 3 scanner.rs optimisée :
  - Métadonnées en parallèle (rayon, ffprobe)
  - Cache inter-scans (video_cache.json, invalide si mtime/size/n_frames change)
  - Extraction parallèle des frames manquantes (rayon, ffmpeg)
  - Filtre de durée (20% de tolérance, O(1) par paire, réduit le O(n²))
  - Comparaison parallèle rayon (`flat_map_iter`)
- [x] Seuil de similarité configurable dans l'UI (slider 60-100%, défaut 100%)
- [x] Vignettes vidéo : `get_video_thumbnail` (async + spawn_blocking), durée passée depuis le scan pour éviter le ffprobe redondant
- [x] Affichage des métadonnées (durée, résolution, codec) dans les groupes similaires vidéo
- [x] Sélecteur exclusif Fichiers / Images / Vidéos (remplace deux checkboxes)
- [x] `video_config.rs` : `VideoConfig` (n_frames, duration_tolerance, cache_enabled), JSON, get/set commands, 4 tests
- [x] Panneau avancé vidéo dans l'UI : frames par vidéo, tolérance de durée, cache entre scans
- [x] 62 tests Rust (+4 video_config)

**Critère de validation : détecter film.avi (480p) et film.mp4 (1080p) comme doublons**

---

## Phase 7 - Qualité + correctifs Windows ✅

- [x] Refactoring App.tsx : 26 useState → 3 useState + 4 hooks (useScanConfig, useScanExecution, useResults, useSelectionState)
- [x] Fusion ThumbnailStrip : composant unique avec prop `mode="image"|"video"`
- [x] i18n FR/EN : LangContext, toggles, persistance localStorage, 3 tests TypeScript
- [x] 29 tests TypeScript (11 i18n + 10 App + 8 utils) ; 66 tests Rust
- [x] Barre de progression : affiche le vrai total de fichiers scannés (`total_files`) au lieu des seuls candidats au hachage
- [x] Ouverture de fichier sur Windows : remplace `cmd /C start` par `explorer.exe path` (plus robuste)
- [x] Révéler dans l'explorateur sur Windows : `raw_arg("/select,\"path\"")` + `CREATE_NO_WINDOW` (gère les espaces dans les chemins)
- [x] Thumbnail vidéo : remplace le spinner infini par un placeholder statique en cas d'erreur (ex. ffmpeg absent)

---

## Phase 8 - UX améliorée ✅

**Objectif : réduire les frictions au quotidien**

- [x] Drag & drop : glisser un dossier sur la fenêtre déclenche la sélection (Tauri `onDragDropEvent` + overlay visuel)
- [x] Raccourcis clavier : `Del` pour supprimer la sélection, `Ctrl+A` pour tout cocher, `Echap` pour annuler/fermer
- [x] Filtre dans les résultats : champ texte pour filtrer les groupes par nom de fichier ou sous-chemin
- [x] Mode clair : toggle dark/light avec persistance localStorage, variables CSS + attribut `data-theme`
- [x] Tri des colonnes : clic sur l'en-tête "Nom", "Taille", "Date modifié" pour trier les fichiers dans chaque groupe
- [x] `check_path_is_dir` commande Rust pour valider le dossier droppé
- [x] 29 tests TypeScript (mock `@tauri-apps/api/webview` ajouté) ; 66 tests Rust

**Critère de validation : un utilisateur peut filtrer 200 groupes, naviguer au clavier et glisser un dossier sans ouvrir de sélecteur**

---

## Phase 9 - Comparateur d'images

**Objectif : permettre de choisir en connaissance de cause laquelle des deux images garder**

- [ ] Ouverture d'une vue plein écran au clic sur un groupe d'images similaires
- [ ] Affichage côte à côte des deux images en taille réelle (ou mise à l'échelle fenêtre)
- [ ] Slider de comparaison (masquage alternant gauche/droite pour voir les différences de qualité/détail)
- [ ] Affichage des métadonnées complètes sous chaque image : dimensions, taille fichier, format, date EXIF si disponible
- [ ] Navigation entre groupes depuis la vue plein écran (flèches ou raccourcis)
- [ ] Bouton "Garder celui-ci" directement depuis la vue (marque l'autre comme à supprimer)

**Critère de validation : comparer photo.jpg (1920x1080, 4 Mo) et photo_resized.jpg (800x600, 400 Ko) et choisir en un geste**

---

## Phase 10 - Scan incrémental + filtres

**Objectif : rendre le rescan rapide et réduire le bruit dans les résultats**

- [ ] Cache des hashes exacts : `exact_cache.json` (clé = chemin absolu, valeur = mtime + taille + hash), même modèle que `phash_cache.rs`
- [ ] Rescan incrémental : au relancement d'un scan sur le même dossier, réutiliser les hashes des fichiers dont mtime et taille n'ont pas changé
- [ ] Filtre d'extensions - mode exclusion : liste de globs à ignorer (ex. `*.tmp`, `*.DS_Store`, `Thumbs.db`), avec défauts raisonnables
- [ ] Filtre d'extensions - mode inclusion : restreindre le scan à certaines extensions (ex. uniquement `*.jpg`, `*.png`)
- [ ] Filtre taille globale : min et max en Ko/Mo configurables dans l'UI, appliqués avant toute phase de hash
- [ ] UI : panneau "Filtres" dans les options de scan (extensions exclues, extensions incluses, taille min, taille max)

**Critère de validation : rescan d'un dossier de 50 000 fichiers après ajout de 100 nouveaux fichiers en moins de 5 secondes**

---

## Phase 11 - Export et profils de scan

**Objectif : workflow professionnel et scans récurrents sans reconfiguration**

- [ ] Export CSV : liste des fichiers à supprimer avec chemin absolu, taille, doublon conservé, espace récupéré
- [ ] Export rapport HTML : page autonome avec résumé statistique, groupes cliquables, liens fichiers système
- [ ] Commande Tauri `export_results(format, session_id)` + bouton dans l'UI post-scan
- [ ] Profils de scan : sauvegarder une configuration complète (dossier, mode, type, seuil, filtres) sous un nom
- [ ] Gestion des profils : liste dans la sidebar, sélection, suppression, renommage
- [ ] Lancement rapide : cliquer sur un profil lance le scan directement sans passer par les options

**Critère de validation : créer un profil "Photos", le relancer d'un clic, exporter les résultats en CSV**

---

## Phase 12 - Audio similaire

**Objectif : détecter les mêmes fichiers audio en formats ou qualités différents**

- [ ] Intégration `rusty-chromaprint` ou appel subprocess `fpcalc` (AcoustID) pour empreinte acoustique
- [ ] `audio_hash.rs` : extraction de l'empreinte (fingerprint 32 bits x N), distance de Hamming sur vecteurs
- [ ] `audio_cache.rs` : cache inter-scans (clé mtime + taille), même modèle que `phash_cache.rs`
- [ ] Extensions audio supportées : mp3, flac, ogg, m4a, aac, wav, wma, opus, aiff
- [ ] Filtre de durée audio (tolérance %) avant comparaison O(n²), comme pour les vidéos
- [ ] Pipeline intégré au scanner : phase 4 optionnelle après hash exact, images et vidéos
- [ ] Seuil de similarité audio configurable dans l'UI (slider)
- [ ] Panneau avancé audio : tolérance durée, cache, outil d'empreinte (fpcalc/rusty-chromaprint)
- [ ] Affichage métadonnées dans les groupes : durée, bitrate, codec (via `ffprobe` déjà disponible)
- [ ] Détection automatique absence de fpcalc si choix subprocess - bandeau d'avertissement

**Critère de validation : détecter chanson.mp3 (320kbps) et chanson.flac comme doublons audio**
