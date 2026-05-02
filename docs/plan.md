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

## Phase 9 - Comparateur d'images ✅

**Objectif : permettre de choisir en connaissance de cause laquelle des deux images garder**

- [x] Ouverture d'une vue plein écran au clic sur un groupe d'images similaires (bouton "Comparer" dans l'en-tête du groupe)
- [x] Affichage côte à côte des deux images en taille réelle (ou mise à l'échelle fenêtre)
- [x] Slider de comparaison (overlay avec handle draggable - bouton ⧉ pour activer)
- [x] Affichage des métadonnées complètes sous chaque image : dimensions, taille fichier, format, date EXIF si disponible
- [x] Navigation entre groupes depuis la vue plein écran (flèches ◀▶ + raccourcis ArrowLeft/ArrowRight/Esc)
- [x] Bouton "Garder celui-ci" directement depuis la vue (marque les autres comme à supprimer)
- [x] Sélecteur de fichier pour les groupes avec 3+ images
- [x] `get_image_meta` commande Rust : dimensions (header-only), format, date EXIF via `kamadak-exif`
- [x] `ImageComparator.tsx` composant séparé ; 66 tests Rust, 29 tests TypeScript
- [x] Sélecteurs L/R indépendants (deux groupes d'onglets, auto-swap si même fichier choisi)
- [x] Deux `useEffect` séparés pour gauche/droite (changer un panneau ne recharge pas l'autre)
- [x] Spinner sur le bouton "Reprendre" pendant le chargement d'une session
- [x] Effacement des résultats précédents au lancement d'un nouveau scan

**Critère de validation : comparer photo.jpg (1920x1080, 4 Mo) et photo_resized.jpg (800x600, 400 Ko) et choisir en un geste**

---

## Phase 10 - Scan incrémental + filtres ✅

**Objectif : rendre le rescan rapide et réduire le bruit dans les résultats**

- [x] Cache des hashes exacts : `exact_cache.json` (clé = chemin absolu, valeur = mtime + taille + partial_hash + full_hash), même modèle que `phash_cache.rs`
- [x] Rescan incrémental : au relancement d'un scan sur le même dossier, réutiliser les hashes des fichiers dont mtime et taille n'ont pas changé
- [x] Filtre d'extensions - mode exclusion : liste d'extensions à ignorer (ex. `tmp`, `DS_Store`, `Thumbs.db`), avec défauts raisonnables
- [x] Filtre d'extensions - mode inclusion : restreindre le scan à certaines extensions (ex. uniquement `jpg`, `png`)
- [x] Filtre taille globale : min et max en Ko configurables dans l'UI, appliqués avant toute phase de hash
- [x] UI : panneau "Filtres" collapsible dans les options de scan (extensions exclues, extensions incluses, taille min, taille max, cache exact)
- [x] `exact_cache.rs` : `ExactCache` (mtime + taille = invalidation, partial_hash + full_hash), 8 tests
- [x] `passes_filters()` : logique de filtrage extraite, partagée entre le path recursif et non-recursif
- [x] `ScanParams` : 5 nouveaux champs (exact_cache_enabled, exclude_extensions, include_extensions, min_file_size_kb, max_file_size_kb)
- [x] 91 tests Rust (+25 : 8 exact_cache + 9 passes_filters + 4 filtres scan + 2 cache exact + 2 existants), 69 tests TypeScript (+5 FiltersPanel + 17 ImageComparator)

**Critère de validation : rescan d'un dossier de 50 000 fichiers après ajout de 100 nouveaux fichiers en moins de 5 secondes**

---

## Phase 11 - Export et profils de scan ✅

**Objectif : workflow professionnel et scans récurrents sans reconfiguration**

- [x] Export CSV : liste des fichiers avec chemin, taille, statut (kept/duplicate), ID groupe
- [x] Export rapport HTML : page autonome avec stats (fichiers scannés, groupes, espace récupérable), groupes cliquables, liens `file://` système, dates formatées via JS
- [x] Commande Tauri `export_results(session_id, format, output_path)` + boutons dans la stats-row post-scan
- [x] `profiles.rs` : `ScanProfile` struct (14 champs), CRUD (`list_profiles`, `save_profile`, `delete_profile`), UUID auto-généré
- [x] `ProfilesPanel` : panneau collapsible (même pattern que FiltersPanel), saisie de nom, liste avec bouton lancement (▶) et suppression (×)
- [x] Lancement rapide : cliquer sur ▶ charge la config du profil ET lance immédiatement le scan
- [x] `dialog:allow-save` ajouté dans `capabilities/default.json`
- [x] 96 tests Rust (+5 profiles.rs), 69 tests TypeScript (+6 ProfilesPanel + 3 export) - 112/72 après Phase 12

---

## Phase 12 - Audio similaire ✅

**Objectif : détecter les mêmes fichiers audio en formats ou qualités différents**

- [x] Appel subprocess `fpcalc` (AcoustID/chromaprint) pour empreinte acoustique
- [x] `audio_hash.rs` : extraction de l'empreinte (fingerprint 32 bits x N), distance de Hamming sur vecteurs, 8 tests
- [x] `audio_cache.rs` : cache inter-scans (clé mtime + taille), même modèle que `phash_cache.rs`, 4 tests
- [x] `audio_config.rs` : `AudioConfig` (tolérance durée + cache), JSON persistant, 4 tests
- [x] Extensions audio supportées : mp3, flac, ogg, m4a, aac, wav, wma, opus, aiff, ape
- [x] Filtre de durée audio (tolérance %) avant comparaison O(n²), comme pour les vidéos
- [x] Pipeline intégré au scanner : phase 4 optionnelle après hash exact, images et vidéos
- [x] Seuil de similarité audio configurable dans l'UI (slider, défaut 80%)
- [x] `AudioAdvancedPanel` : tolérance durée + cache
- [x] Affichage durée dans les groupes audio (colonne Durée), icône 🎵, label "fichiers audio"
- [x] Détection automatique absence de fpcalc - bandeau d'avertissement
- [x] 115 tests Rust (+3 scanner audio phase), 75 tests TypeScript (+3 section J : params scan, bannière fpcalcMissing, tag SessionCard)

**Critère de validation : détecter chanson.mp3 (320kbps) et chanson.flac comme doublons audio**
