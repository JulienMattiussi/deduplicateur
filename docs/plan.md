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

## Phase 4 - Sous-dossiers ✅
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
- [x] Seuil de similarité audio configurable dans l'UI (slider, défaut 100%)
- [x] `AudioAdvancedPanel` : tolérance durée + cache
- [x] Affichage durée dans les groupes audio (colonne Durée), icône bouton play (SVG), label "fichiers audio"
- [x] Miniature bouton play cliquable dans les groupes audio : clic ouvre le fichier dans l'app par défaut
- [x] Scan audio filtre les fichiers : seuls les fichiers audio sont passes dans la phase exacte en mode audio-only (correction bug doublons non-audio)
- [x] Détection automatique absence de fpcalc - bandeau d'avertissement
- [x] 115 tests Rust (+3 scanner audio phase), 75 tests TypeScript (+3 section J : params scan, bannière fpcalcMissing, tag SessionCard)

**Critère de validation : détecter chanson.mp3 (320kbps) et chanson.flac comme doublons audio**

---

## Phase 13 - Plug and play audio/video ✅

**Objectif : rendre ffmpeg et fpcalc disponibles sans configuration manuelle**

- [x] `tool_finder.rs` : `find_tool(name)` cherche dans l'ordre : binaire bundte (a cote de l'exe), chemins systeme OS-specifiques (Chocolatey, Scoop, Homebrew, apt...), puis fallback PATH ; 2 tests unitaires
- [x] `audio_hash.rs` : `run_fpcalc` utilise `tool_finder::find_tool("fpcalc")` en premier
- [x] `video_hash.rs` : `is_ffmpeg_available`, `get_video_metadata`, `extract_frame_hashes`, `extract_thumbnail` utilisent `tool_finder::find_tool("ffmpeg"/"ffprobe")`
- [x] `externalBin: ["binaries/fpcalc"]` dans `src-tauri/tauri.conf.json` - Tauri bundle fpcalc a cote de l'exe
- [x] `src-tauri/build.rs` : cree un placeholder vide si le binaire n'existe pas encore (evite l'echec du build en dev local)
- [x] `scripts/download-fpcalc.sh` : telecharge fpcalc v1.5.1 depuis GitHub, detecte le triple Rust, place dans `src-tauri/binaries/fpcalc-{triple}`
- [x] `.github/workflows/build.yml` : step "Download fpcalc" avant le build CI (cross-platform)
- [x] `.gitignore` : `src-tauri/binaries/fpcalc*` ignore les binaires telecharges
- [x] `lib.rs` : commande Tauri `check_tools()` retourne `{ffmpeg_available, fpcalc_available}`
- [x] `MissingToolBanner.tsx` : composant riche remplace les simples `div.partial-banner` pour ffmpeg/fpcalc - instructions OS-specifiques, bouton Telecharger (shell open), bouton Verifier a nouveau (invoke check_tools)
- [x] `i18n.ts` : 5 nouvelles cles (toolMissingTitle, toolMissingDesc, toolInstallWindows/Mac/Linux, toolDownload, toolCheckAgain, toolFound)
- [x] `App.tsx` : remplace les deux banners texte par `<MissingToolBanner>` avec callback `onAvailable`
- [x] `MissingToolBanner.test.tsx` : 8 tests (rendu, boutons, shell open, check_tools, onAvailable, message trouvé)
- [x] 117 tests Rust (+2 tool_finder), 84 tests TypeScript (+8 MissingToolBanner, +1 audio improvements)


**Critère de validation : lancer l'app sans fpcalc ni ffmpeg, voir la banniere avec instructions, cliquer Telecharger**

---

## Refactoring code quality ✅

- [x] `lib.rs` : suppression du parametre `summary` inutilise dans `generate_csv`
- [x] `lib.rs` : helpers `load_cfg` / `save_cfg` - les 6 commandes de config (get/set phash/video/audio) utilisent ces helpers au lieu de repeter le pattern `app_data_dir + ok_or`
- [x] `AdvancedPanelWrapper.tsx` : composant wrapper partage pour les 3 panneaux avances (toggle, reset, body) - `AdvancedPanel`, `VideoAdvancedPanel`, `AudioAdvancedPanel` refactores pour l'utiliser
- [x] `App.test.tsx` : remplacement des 3 `document.querySelector` par des queries RTL (`getByTestId`, `within`, `getAllByRole`) ; `data-testid` ajoutes sur `stats-row` (App.tsx) et `group-files` (GroupCard.tsx)
- [x] `ImageComparator.test.tsx` : remplacement des `document.querySelector` par `getByTestId` + `within` ; `data-testid` ajoutes sur les deux groupes d'onglets et les divs corps du comparateur
- [x] `FileThumbnail.test.tsx` : 8 tests (mode audio SVG + click, mode image invoke + rendu + erreur + click, mode vidéo invoke + args + erreur)
- [x] `AdvancedPanelWrapper.test.tsx` : 7 tests (ouverture/fermeture, reset visible seulement ouvert, click reset, disabled toggle et reset)
- [x] `GroupCard` section K dans App.test.tsx : 7 tests (tri nom asc/desc/reset, indicateurs ↑↓, tri date)
- [x] `SessionCard` section L dans App.test.tsx : 11 tests (relativeDate 4 cas, sessionTags 5 cas, active/resuming)
- [x] `cache_io.rs` : 5 tests (round-trip, absent, non-dirty, dirty reset, JSON invalide)
- [x] `tool_finder.rs` : +1 test (binaries/ sous-dossier)
- [x] 123 tests Rust, 118 tests TypeScript

---

## Phase 14 - Règles de sélection par métadonnées ✅

**Objectif : choisir automatiquement quel fichier garder selon des critères objectifs**

- [x] Règle "garder la plus haute résolution" : vidéos via `VideoMetadata.width*height`, images via lecture d'en-tête (`image::image_dimensions`), tie-break size puis newest
- [x] Règle "garder le plus grand fichier" (`largest_size`) : utile pour audio/vidéo, tie-break newest
- [x] Règle "garder le fichier dans le dossier X" (`priority_folder`, chemin configurable) : si plusieurs matchent, garde le plus récent ; si aucun ne matche, groupe ignoré (aucun fichier coché)
- [x] Règle "garder le plus récent" et "garder le plus ancien" conservées (désormais dans le dropdown)
- [x] `select_files_to_delete` : fonction pure extraite de `smart_select` (testable sans Tauri)
- [x] `smart_select` rendue async + spawn_blocking (I/O image header pour highest_resolution)
- [x] UI : dropdown + bouton "Appliquer" dans la toolbar (remplace les deux boutons séparés)
- [x] UI : input "Chemin prioritaire" affiché uniquement quand la règle priority_folder est sélectionnée
- [x] `SmartMode` type exporté depuis `useSelectionState.ts`
- [x] `highest_resolution` : si aucun fichier du groupe n'a de résolution détectable, le groupe est ignoré (aucun fichier coché) ; si mélange image/autre, les fichiers sans résolution reçoivent 0 px et sont supprimés
- [x] 134 tests Rust (+11 : largest_size, tiebreak, priority_folder x3, highest_resolution video x2, groupe vide, no-metadata skip, mixed group)
- [x] 127 tests TypeScript (+9 section M : dropdown options, input conditionnel, appels smart_select, groupe ignoré retourne [], fichiers retournés cochés dans l'UI)

**Critère de validation : sur un groupe image HD + miniature, "garder la plus haute résolution" coche automatiquement le bon fichier**

---

## Phase 15 - Liste d'ignorés ✅

**Objectif : ne plus voir resurgir des groupes que l'utilisateur a décidé de laisser en place**

- [x] `ignore_list.rs` : persistance JSON dans `~/.local/share/deduplicateur/ignore_list.json`, clé = chemins triés et joints par `|` (stable et canonique même pour groupes pHash/vidéo/audio)
- [x] Commande Tauri `ignore_group(group_id)` : ajoute la paire de chemins du groupe à la liste, avec `display_names` et timestamp
- [x] Commande Tauri `get_ignore_list()` / `clear_ignore_entry(key)` / `clear_all_ignored()`
- [x] `scanner.rs` : filtrage post-scan - les groupes dont la clé est dans `ignored_keys` (HashSet chargé au début du scan) sont exclus des résultats
- [x] UI : bouton "✕" sur chaque `GroupCard` (à côté du bouton Comparer), visible dans tous les modes
- [x] UI : panneau `IgnoredPanel` affiché sous la barre de filtre dans la vue résultats - liste les entrées ignorées avec noms, date, bouton "Retirer" par entrée et bouton "Tout effacer"
- [x] `FolderSection` : prop `onIgnore` transmise aux `GroupCard` imbriquées
- [x] Tests Rust : 8 tests dans `ignore_list.rs` (canonicité, add/contains, remove, clear, round-trip JSON, tri par date) + 3 tests scanner (groupe exclu, autres groupes conservés, hashset vide ne filtre rien)
- [x] Tests TypeScript : 11 tests `IgnoredPanel.test.tsx` (badge, dropdown fermé/ouvert, Retirer, Tout effacer, entrées multiples) + 7 tests section N `App.test.tsx` (bouton visible, appels invoke, groupe disparaît, panneau dans header, entrées affichées, Retirer, Tout effacer) + 3 tests `FolderSection.test.tsx` (bouton absent sans prop, bouton présent, onIgnore transmis avec le bon id)
- [x] 145 tests Rust / 148 tests TypeScript - tous au vert

**Critère de validation : ignorer un groupe, relancer le scan, le groupe n'apparait plus ; aller dans les paramètres et le "désignorer"**

---

## Phase 16 - Documentation intégrée (aide F1) ✅

**Objectif : permettre à l'utilisateur de comprendre chaque fonctionnalité sans quitter l'application**

- [x] `src/help/content.ts` : 12 sections, 29 articles bilingues (FR/EN) couvrant la totalité des fonctionnalités
- [x] Structure `HelpArticle` : champs `id`, `sectionId`, `title`, `keywords`, `body` en FR et EN
- [x] `HelpPanel.tsx` : drawer fixe côté droit avec overlay, sidebar nav par sections, rendu d'article avec `**gras**`, \`code\`, `- bullets`, `\n\n` paragraphes
- [x] Recherche temps réel dans `title`, `keywords` et `body` - résultats en liste plate, navigation par sections quand vide
- [x] Déclenchement : touche F1 ou bouton "?" dans le header (à côté des profils)
- [x] Fermeture : touche Escape ou clic sur l'overlay
- [x] i18n : 4 nouvelles clés `helpOpen`, `helpTitle`, `helpSearch`, `helpNoResults`
- [x] Tests TypeScript : 8 tests `HelpPanel.test.tsx` (rendu, nav, recherche, aucun résultat, fermeture ✕, Escape, overlay) + 5 tests section O `App.test.tsx` (bouton visible, clic ouvre, F1 ouvre, Escape ferme, ✕ ferme)
- [x] 145 tests Rust / 162 tests TypeScript - tous au vert
- [x] Règle AGENTS.md ajoutée : mettre à jour `src/help/content.ts` avec chaque feature visible

**Critère de validation : appuyer F1, chercher "ignorer", trouver l'article dédié ; chercher "xyz", voir "Aucun résultat" ; Escape ferme le panneau**

---

## Phase 17 - Notifications système ✅

**Objectif : prévenir l'utilisateur quand un scan long se termine, même si l'app est en arrière-plan**

- [x] Ajouter le plugin `tauri-plugin-notification` dans `Cargo.toml` et `package.json`
- [x] Déclarer `notification:default` dans `capabilities/default.json`
- [x] Rust / `lib.rs` : émettre une notification OS en fin de scan (titre + résumé : N groupes, X Mo récupérables)
- [x] Notification uniquement si le scan a duré plus de N secondes (seuil configurable via `notification_threshold_secs`, défaut 10s) - pas de notification pour les scans rapides
- [x] Windows : notification native via le centre de notifications (tauri-plugin-notification -> notify-rust)
- [x] macOS : notification native via UNUserNotificationCenter (tauri-plugin-notification)
- [x] Linux : notification via libnotify / org.freedesktop.Notifications (tauri-plugin-notification -> notify-rust)
- [x] Tests Rust : 11 tests unitaires sur `should_notify` et `format_notification_body` (fonctions pures extraites, testables sans runtime Tauri)
- [x] i18n : 4 nouvelles cles (notifTitle, notifBodyNone, notifBodyOne, notifBodyMany) en FR et EN
- [x] `src/help/content.ts` : article "Notifications de fin de scan" dans une nouvelle section "Notifications"
- [x] Langue de la notification = langue active de l'UI au moment du lancement du scan
- [x] 156 tests Rust (+11 notifications) / 162 tests TypeScript - tous au vert

### Tests TypeScript manquants ajoutés (post-Phase 17)

- [x] `src/components/AdvancedPanel.test.tsx` : rendu, toggle, inputs numériques, checkboxes, bouton Reset (12 tests)
- [x] `src/components/AudioAdvancedPanel.test.tsx` : rendu, toggle, input tolérance, checkbox cache, bouton Reset (7 tests)
- [x] `src/components/VideoAdvancedPanel.test.tsx` : rendu, toggle, input n_frames (avec clamping), input tolérance, checkboxes, bouton Reset (12 tests)
- [x] `src/components/ProfilesPanel.test.tsx` : rendu, toggle, onSave, onLaunch, onDelete, disabled, click outside (13 tests)
- [x] `src/App.test.tsx` section P - notifications : `notificationThresholdSecs: 10`, `notificationLang` en FR et EN (3 tests)
- [x] 209 tests TypeScript (+47) / 156 tests Rust - tous au vert

**Critère de validation : lancer un scan de 50 000 fichiers, basculer sur une autre fenêtre, voir la notification apparaitre en fin de scan**

---

## Phase 18 - Comparateur vidéo ✅

**Objectif : comparer deux vidéos côte à côte avec lecture synchronisée avant de choisir laquelle supprimer**

- [x] `VideoComparator.tsx` : composant plein écran, même structure que `ImageComparator.tsx`
- [x] Deux lecteurs `<video>` natifs côte à côte, synchronisation play/pause/seek via événements cross-ref
- [x] Barre de scrubbing commune : déplacer le slider avance les deux vidéos au même timestamp
- [x] Affichage des métadonnées par fichier : résolution, durée, codec (via `get_video_metadata`), taille
- [x] Bouton "Garder celui-ci" (gauche / droite) - même pattern que `ImageComparator`
- [x] Navigation clavier entre groupes (mêmes raccourcis que le comparateur images)
- [x] Bouton d'accès au comparateur sur les `GroupCard` vidéo (déjà présent pour les images)
- [x] Tests TypeScript : rendu, synchronisation play/pause, bouton "Garder", navigation clavier
- [x] Commande Tauri `get_video_metadata` exposée (async + spawn_blocking)
- [x] `src/help/content.ts` : 3 articles bilingues dans la section "Comparateur de vidéos"
- [x] 156 tests Rust / 244 tests TypeScript - tous au vert

**Critère de validation : ouvrir deux vidéos similaires, appuyer play, les deux démarrent en même temps ; scrubber à 30s sur l'une, l'autre saute aussi à 30s**

### Tests TypeScript manquants ajoutés (post-Phase 18)

- [x] `src/components/ProgressETA.test.tsx` : 8 tests (etat initial current=0/total=0, total=0 sans crash, estimating au demarrage, almostDone a 95%+, estimation en secondes apres 15s, almostDone a 100%, duree en minutes en phase stable, classe CSS)
- [x] `src/VideoComparator.test.tsx` section E2 : seek sync via slider - verifie que currentTime des deux videos est mis a jour
- [x] `src/VideoComparator.test.tsx` section E3 : groupe avec 1 seul fichier - retourne null sans crash
- [x] `src/components/ProfilesPanel.test.tsx` : clic Sauvegarder sans nom n'appelle pas onSave ; clic Sauvegarder avec nom d'espaces uniquement n'appelle pas onSave
- [x] 156 tests Rust / 244 tests TypeScript - tous au vert

---

## Phase 19 - Mode "Comparer avec un autre dossier" ✅

**Objectif : détecter les doublons entre un dossier source et un dossier de référence, sans signaler les doublons internes à chaque dossier**

Les 3 modes de scan :
- "Comparer tout le dossier" (existant)
- "Comparer par sous-dossier" (existant)
- "Comparer avec un autre dossier" (nouveau)

En mode "Comparer avec un autre dossier" : dossier source S et dossier de référence R. Seuls les fichiers présents dans les deux dossiers sont signalés. Un doublon interne à S ou interne à R n'apparait pas.

- [x] `ScanParams` : champ `secondary_folder: Option<String>`
- [x] `scanner.rs` : `FileSource` enum (Primary/Secondary), collecte séparée des fichiers S et R avec marquage, hash en cascade identique sur l'union, filtre `is_cross_source_group` appliqué aux 4 phases (exact, pHash, video, audio)
- [x] `lib.rs` : paramètre `secondary_folder: Option<String>` dans la commande Tauri `scan_folder`
- [x] `types.ts` : champ `source?: "primary" | "secondary"` dans `DuplicateFile`
- [x] UI : troisième option "Comparer avec un autre dossier" dans le sélecteur de mode
- [x] UI : second sélecteur de dossier "Dossier de référence" visible uniquement dans ce mode (même pattern que le sélecteur principal, avec protection anti-double-clic)
- [x] UI : badge `Réf.` sur les fichiers provenant du dossier de référence dans `GroupCard`
- [x] `i18n.ts` : 3 nouvelles clés (scanCompareFolder, secondaryFolderLabel, secondaryFolderPick, badgeReference)
- [x] `src/help/content.ts` : article "Mode Comparer avec un autre dossier" bilingue + mise à jour de l'article "Modes de scan"
- [x] Tests Rust : 5 tests (groupe croisé détecté avec sources correctes, groupe interne S ignoré, groupe interne R ignoré, fichier présent dans un seul dossier ignoré, mode normal sans secondary_folder inchangé)
- [x] Tests TypeScript : 10 tests sections Q et Q2 (sélecteur secondaire absent/présent, clic picker, path affiché, scan_folder invoqué avec secondaryFolder, badge Réf., badge original absent en mode source)
- [x] 161 tests Rust / 254 tests TypeScript - tous au vert

**Critère de validation : dossier source = `Photos/`, dossier référence = `Backup/Photos/` - seules les photos présentes dans les deux dossiers sont signalées, pas les photos uniques dans l'un ou l'autre**

---

## Phase 20 - Qualité sessions + gestion du cache ✅

**Objectif : sessions fiables et espace disque maitrisé**

- [x] `lib.rs` : `delete_files` met à jour la session active en mémoire et sur disque après chaque suppression (`purge_deleted_from_session`, `recalc_wasted_bytes`, `save_session`)
- [x] `lib.rs` : `load_session` filtre les fichiers absents du disque avant de charger la session (filtre défensif, resauvegarde si changé)
- [x] `App.tsx` : `handleDeleteComplete` recalcule `total_wasted_bytes` en plus de `total_groups`
- [x] Comparateur vidéo : video de droite muette par défaut (`muted={!master}`) - pattern maitre/esclave sans risque de boucle synchronisation
- [x] `lib.rs` : commande Tauri `get_cache_size()` - somme les tailles de `phash_cache.json`, `video_cache.json`, `audio_cache.json`, `exact_cache.json`
- [x] `lib.rs` : commande Tauri `purge_cache()` - supprime ces 4 fichiers cache
- [x] `App.tsx` : section "Mes analyses" toujours visible (`showSessionPicker = !summary && !scanExec.scanning`), bouton "← Mes analyses" toujours visible dans la barre d'outils
- [x] `App.tsx` : état vide "Aucune analyse enregistrée" quand `sessions.length === 0`
- [x] `App.tsx` : section cache en bas de la liste - affiche la taille et un bouton "Purger" avec confirmation inline
- [x] `i18n.ts` : 4 nouvelles clés (`noSessions`, `cacheSize`, `purgeCache`, `purgeCacheQuestion`) en FR et EN
- [x] `src/help/content.ts` : article "Analyses précédentes" mis à jour - mise à jour automatique à la suppression, cache de détection, purge
- [x] Tests Rust : 4 tests unitaires (`get_cache_size` et `purge_cache` sur dossier temp)
- [x] Tests TypeScript : 7 tests section R (`App.test.tsx`) - vide, titre visible, cache > 0, cache = 0, confirmation, annulation, purge invoquée
- [x] 171 tests Rust / 268 tests TypeScript - tous au vert

---

## Phase 21 - Performance pHash + stabilité scan ✅

**Objectif : éliminer les scans bloquants et réduire le temps de calcul sur cache froid/chaud**

- [x] `scanner/hash.rs` : `get_image_dimensions` réécrite - lit au plus 64 Ko et parse les headers PNG (IHDR) et JPEG (scan SOF) manuellement, sans décodage image ni subprocess. Retourne `None` pour les formats non reconnus (WebP, TIFF...) - le filtre d'aspect est alors ignoré pour ces fichiers
- [x] `scanner/phash_phase.rs` : progression émise pendant la passe de hash (cache misses) quand la majorité des fichiers sont des misses (cache froid) - le pourcentage avance en continu même sur un premier scan
- [x] `video/cache.rs` : `VideoCacheEntry` stocke maintenant `duration_secs`, `width`, `height`, `codec` (métadonnées complètes pour reconstruire `VideoMetadata` sans ffprobe)
- [x] `scanner/video_phase.rs` : vérification du cache avant ffprobe - ffprobe (subprocess) n'est lancé que pour les misses ; les hits reconstruisent `VideoMetadata` depuis le cache directement
- [x] `App.tsx` : `get_cache_size` rafraîchi via `useEffect` sur `showSessionPicker` (déclenché à chaque ouverture de "Mes analyses")
- [x] `components/FileThumbnail.tsx` : lazy loading via `IntersectionObserver` avec marge de 300px (~2 cards) - `invoke` n'est déclenché que quand la card approche du viewport, évite la vague de requêtes au rendu initial
- [x] `components/ProgressETA.tsx` : formatage en heures (`X.X h`) quand le temps restant dépasse 120 min
- [x] `src/test-setup.ts` : mock global `IntersectionObserver` (déclenche immédiatement `isIntersecting: true`) pour que les tests existants continuent de fonctionner
- [x] Tests Rust : 8 nouveaux tests dans `scanner/hash.rs` (PNG valide, mauvaise magic, buffer court, JPEG valide, mauvaise magic, SOF absent, SOS avant SOF, format non reconnu)
- [x] Tests TypeScript : 2 nouveaux tests `FileThumbnail` (invoke absent hors viewport, invoke présent dans viewport)
- [x] 181 tests Rust / 291 tests TypeScript - tous au vert

---

## Phase 22 - Comparateur audio + bouton dossier + filtre date ✅

**Objectif : comparer deux fichiers audio cote a cote, ouvrir le dossier depuis les comparateurs, filtrer les fichiers par date de modification**

- [x] `AudioComparator.tsx` : composant plein ecran, meme structure que `VideoComparator.tsx` - deux lecteurs `<audio>` cote a cote, synchronisation play/pause/seek (pattern maitre/esclave), bouton "Garder celui-ci"
- [x] Media server utilise pour les URLs audio (meme serveur HTTP local que les videos - Range support)
- [x] `AudioMetaBlock` : affiche nom, dossier, taille, duree (depuis `file.audio_metadata.duration_secs`)
- [x] `comparatorShared.tsx` : bouton 📂 "Ouvrir le dossier" dans `MetaBlockBase` via `revealInFolder()` - present dans les 3 comparateurs (images, videos, audio)
- [x] `filters.rs` : `passes_filters` etendue avec `modified: u64, min_modified_timestamp: u64, max_modified_timestamp: u64` - 5 nouveaux tests (min exclut, min ok, max exclut, max ok, plage)
- [x] `scanner/types.rs` : `ScanParams` + `min_modified_timestamp`, `max_modified_timestamp` (default 0)
- [x] `scanner/fs.rs` : `collect_files` passe `modified` a `passes_filters` (branche recursive et non-recursive)
- [x] `commands/scan.rs` : 2 nouveaux params optionnels `min_modified_timestamp`, `max_modified_timestamp`
- [x] `components/FiltersPanel.tsx` : section "Date de modification" avec deux `<input type="date">`, activeCount mis a jour
- [x] `hooks/useScanConfig.ts` : `minModifiedDate` / `maxModifiedDate` (string ISO, default "")
- [x] `App.tsx` : conversion date ISO -> timestamp Unix avant invoke, `audioGroups` useMemo, `audioComparatorIdx` state, rendu `<AudioComparator>`, `onCompareAudio` cable dans GroupCard et FolderSection
- [x] `components/GroupCard.tsx` + `FolderSection.tsx` : prop `onCompareAudio` + bouton "Comparer" sur les groupes audio
- [x] `i18n.ts` : 5 nouvelles cles (`audioComparator`, `filterModifiedDate`, `minModifiedDate`, `maxModifiedDate`, `revealInFolderBtn`) en FR et EN
- [x] `src/help/content.ts` : section "audio-comparator" + 2 articles bilingues (ouvrir, garder) + article "filters-date" bilingue
- [x] Tests TypeScript : `AudioComparator.test.tsx` 8 tests (rendu, audio-left/right, controls maitre/esclave, garder, duree, bouton dossier, groupe vide, Escape) + 3 tests `FiltersPanel` (section date visible, onChangeMinDate, count avec dates)
- [x] 186 tests Rust (+5 filters.rs date) / 302 tests TypeScript (+11) - tous au vert

**Critere de validation : ouvrir deux fichiers audio similaires, appuyer lecture, les deux jouent en meme temps ; filtrer par "modifie apres 2024-01-01" et relancer le scan ; cliquer 📂 dans un comparateur ouvre le dossier**

---

## Phase 23 - UX résultats + progression temps réel ✅

**Objectif : enrichir l'affichage des résultats et donner un retour visuel pendant le scan**

- [x] `scanner/types.rs` : `ScanParams` + champ `groups_counter: Option<Arc<AtomicUsize>>` (défaut `None` - zéro impact sur les tests existants)
- [x] `scanner/mod.rs` : création ou récupération du counter, passé à chaque phase via `&groups_counter`
- [x] `scanner/{exact,phash,video,audio}_phase.rs` : paramètre `groups_counter: &Arc<AtomicUsize>` ajouté à `run()`, `fetch_add` après chaque `groups.extend()`
- [x] `commands/scan.rs` : `Arc<AtomicUsize>` créé, injecté dans `ScanParams`, lu dans la tâche d'émission toutes les 100 ms et ajouté au payload `scan:progress` en tant que `groups_found`
- [x] `types.ts` : champ `groups_found?: number` dans `ScanProgress`
- [x] `App.tsx` : compteur affiché sur une ligne dédiée en bleu sous la progression, visible uniquement quand `groups_found > 0`
- [x] `i18n.ts` : clé `groupsFoundSoFar` bilingue ("{n} doublon(s) trouvé(s) au total" / "{n} duplicate(s) found so far")
- [x] `components/FileThumbnail.tsx` : mode `"other"` + `FileTypeIcon` SVG inline par catégorie (pdf, archive, code, document, tableur, présentation, générique) - pas d'appel invoke ni d'IntersectionObserver
- [x] `components/GroupCard.tsx` : colonne miniature toujours visible (suppression de la condition media), `thumbMode` déduit du type de groupe, `sharedDirs` useMemo (dirs avec 2+ fichiers du même groupe), `SharedDirDot` (point orange + tooltip) sur les lignes concernées, chemin avec `title` pour infobulle full path, bouton dossier remplacé par `FolderIcon` SVG toujours visible
- [x] `App.css` : `.btn-reveal` toujours visible (opacity 0.4 au repos), `.file-col-dir-text` avec `direction: rtl` pour troncature par la gauche, `.shared-dir-dot` amber, `.file-thumb-other` + `.file-thumb-icon`, `.progress-groups-found`
- [x] `i18n.ts` : clé `sameDirTooltip` bilingue
- [x] `src/help/content.ts` : articles `launch-cancel`, `file-types` et `reveal` mis à jour (compteur doublon, icônes type, chemin RTL, point orange, bouton dossier)
- [x] Tests TypeScript : 4 tests `FileThumbnail` mode "other" (SVG sans invoke, classe file-thumb-other) + 3 tests `GroupCard` same-dir (point présent/absent/mixte) - total 186 Rust / 309 TypeScript - tous au vert

**Critere de validation : pendant un scan, le compteur de doublons monte en temps réel ; les groupes de fichiers ZIP/PDF affichent une icône adaptée ; les chemins longs sont tronqués par la gauche avec tooltip ; deux fichiers dans le même dossier montrent un point orange**

---

## Phase 24 - Optimisations pHash avancées (EXIF thumbnail + bucket index + tri aspect + cache binaire) ✅

**Objectif : réduire le temps de scan pHash sur les grandes collections (10K-100K images)**

- [x] `phash/config.rs` : 3 nouveaux champs `use_exif_thumbnail` (defaut true), `use_bucket_index` (defaut true), `use_sorted_aspect` (defaut true) ; tests mis a jour
- [x] `phash/cache.rs` : champ `thumbnail_setting: bool` dans `CacheEntry` (invalidation si l'option change) ; `get()` avec 5e parametre `use_exif_thumbnail` ; format binaire `phash_cache.bin` (magic PHCB + entrees compactes ~79 octets vs ~350 en JSON) ; repli JSON en lecture pour retrocompatibilite ; 4 nouveaux tests (binaire ecrit, round-trip avec aspect+thumbnail, repli JSON, binaire prioritaire sur JSON)
- [x] `scanner/hash.rs` : extraction manuelle du thumbnail EXIF (`try_extract_exif_thumbnail` : scan APP1, parsing TIFF IFD0->IFD1, tags 0x0201/0x0202) ; `compute_two_pass_hashes` avec 4e param `use_exif_thumbnail` ; 3 nouveaux tests (PNG retourne None, JPEG sans APP1, JPEG avec APP1 non-EXIF)
- [x] `scanner/phash_phase.rs` : `cache.get()` et `compute_two_pass_hashes()` mis a jour avec le nouveau parametre ; `thumbnail_setting` stocke dans `CacheEntry` ; comparaison en 3 branches :
  - **Bucket index** (`use_bucket_index && coarse_threshold==0`) : HashMap coarse->indices, O(n * bucket_size)
  - **Tri par aspect** (`use_sorted_aspect && use_aspect_filter`) : sort + partition_point, elimine les paires incompatibles en O(log n)
  - **Fallback O(n^2)** : code existant inchange
- [x] `types.ts` : 3 nouveaux champs dans `PHashConfig` (`use_exif_thumbnail`, `use_bucket_index`, `use_sorted_aspect`)
- [x] `hooks/useScanConfig.ts` : 3 nouvelles valeurs par defaut (toutes true dans `DEFAULT_PHASH_CONFIG`)
- [x] `i18n.ts` : 8 nouvelles cles bilingues (fastDecoding, exifThumbnail, tipExifThumbnail, compareOptimization, bucketIndex, tipBucketIndex, sortedAspect, tipSortedAspect)
- [x] `components/AdvancedPanel.tsx` : 2 nouvelles sections avec 3 checkboxes (thumbnail EXIF, bucket index, tri aspect)
- [x] `src/help/content.ts` : article "advanced-images" mis a jour - 5 optim -> 8 optim, description EXIF/bucket/tri/cache binaire, nouveaux mots-cles
- [x] Tests Rust : 2 nouveaux tests d'integration (`phash_bucket_index_meme_resultat_que_fallback`, `phash_sorted_aspect_meme_resultat_que_fallback`)
- [x] Tests TypeScript : 3 nouveaux tests AdvancedPanel (checkbox use_exif_thumbnail, use_bucket_index, use_sorted_aspect)
- [x] `i18n.ts` : cle `tipCompareOptimization` ajoutee (tooltip section titre)
- [x] `components/AdvancedPanel.tsx` : tooltip `tipCompareOptimization` sur le titre de section
- [x] 196 tests Rust / 312 tests TypeScript - tous au vert

---

## Phase 25 - Refonte de la progression : barre mobile + heartbeat counter ✅

**Objectif : la barre de progression ne gèle plus pendant la phase de comparaison pHash (qui peut durer plusieurs minutes sur de grandes collections)**

**Problème** : `total_work` ne comptabilisait pas la phase de comparaison. Après le hachage de toutes les images, `current` atteignait `total_to_hash + phash_estimate` et restait immobile pendant toute la comparaison (bucket index, sorted_aspect ou fallback O(n²)), quelle que soit la durée.

**Solution** :
- [x] `scanner/mod.rs` : `phash_compare_estimate = phash_estimate` ; `total_work += phash_compare_estimate` ; champ ajouté dans `Ctx`
- [x] `scanner/phash_phase.rs` : `compare_base = total_to_hash + phash_estimate` ; `compare_counter: Arc<AtomicUsize>` ; `on_progress(compare_base + cnt, ...)` ajouté dans les 6 sous-branches (bucket/sorted_aspect/fallback × séquentiel/parallèle)
- [x] `scanner/video_phase.rs` : offset mis à jour (`+ phash_compare_estimate`)
- [x] `scanner/audio_phase.rs` : offset mis à jour (`+ phash_compare_estimate`)
- [x] `i18n.ts` : clé `heartbeatCounter` bilingue ("● {n} opérations traitées" / "● {n} operations processed")
- [x] `App.tsx` : bulles de phase (✓ fait / ● actif / ○ en attente) + compteur heartbeat toujours croissant (`progress.current`)
- [x] `App.css` : `.progress-steps`, `.progress-step`, `.progress-step--{done|active|pending}`, `.progress-heartbeat`
- [x] 196 tests Rust / 312 tests TypeScript - tous au vert


---

## Phase 26 - Double installeur light/full ✅

**Objectif : proposer deux variantes du binaire - une légère (fpcalc seul) et une complète (fpcalc + ffmpeg + ffprobe bundlés), pour que les utilisateurs sans ffmpeg système puissent utiliser toutes les fonctionnalités sans installation supplémentaire**

- [x] `scripts/download-ffmpeg.sh` : télécharge ffmpeg et ffprobe en builds statiques LGPL depuis BtbN/FFmpeg-Builds (Linux x86_64/arm64 et Windows x86_64) ; affiche les instructions Homebrew pour macOS
- [x] `src-tauri/tauri.conf.full.json` : surcharge partielle appliquée via `tauri build --config` ; remplace `externalBin` pour inclure `fpcalc`, `ffmpeg` et `ffprobe` (Tauri 2 merge automatique)
- [x] `src-tauri/build.rs` : boucle sur les 3 binaires (fpcalc, ffmpeg, ffprobe) pour créer les placeholders vides en dev - le placeholder permet à `tauri_build::build()` de ne pas rejeter le build en l'absence du binaire réel
- [x] `package.json` : scripts `build:light` (`tauri build`) et `build:full` (`tauri build --config src-tauri/tauri.conf.full.json`)
- [x] `.gitignore` : ajout de `src-tauri/binaries/ffmpeg*` et `src-tauri/binaries/ffprobe*`
- [x] `README.md` : table de téléchargement mise à jour (2 variantes), section Build mise à jour, counts de tests mis à jour

**Critère de validation : `npm run build:light` produit un installeur sans ffmpeg ; `npm run build:full` après `download-ffmpeg.sh` produit un installeur avec ffmpeg et ffprobe inclus automatiquement dans tous les formats (MSI, NSIS, AppImage, deb)**

---

## Phase 27 - Scan d'archives

**Objectif : détecter les archives (ZIP, tar.gz, 7z...) dont le contenu est dupliqué entre elles**

### Principes transverses

- Une archive apparait toujours comme **une seule ligne** dans les résultats - le détail des entrées n'est visible que dans le comparateur d'archives.
- Le contenu d'une archive est comparé **uniquement avec le contenu d'autres archives** - jamais avec les fichiers disque ordinaires.
- Les archives imbriquées (ZIP dans un ZIP) sont ignorées silencieusement.
- Les archives protégées par mot de passe sont ignorées silencieusement.
- Les entrées non-fichiers (répertoires, liens symboliques) sont filtrées silencieusement.
- Les entrées > 100 Mo sont extraites dans un `tempfile::NamedTempFile` (auto-supprimé) au lieu d'être lues en RAM.
- Chaque entrée d'archive compte comme un fichier dans la barre de progression.
- Suppression vers la corbeille uniquement si **toutes** les entrées de l'archive sont dupliquées dans au moins une autre archive (`can_delete = true`). Sinon : comparateur en lecture seule.

### Formats d'archives supportés

| Format | Extensions | Crate |
|---|---|---|
| ZIP | `.zip`, `.cbz` (Comic Book ZIP) | `zip` |
| Tar+gzip | `.tar.gz`, `.tgz` | `tar` + `flate2` |
| Tar+bzip2 | `.tar.bz2`, `.tbz2` | `tar` + `bzip2` |
| Tar+xz | `.tar.xz`, `.txz` | `tar` + `xz2` |
| Tar+zstd | `.tar.zst` | `tar` + `zstd` |
| 7-Zip | `.7z` | `sevenz-rust2` |
| RAR | `.rar`, `.cbr` (Comic Book RAR) | **non supporté** (pas de crate libre fiable) - ignoré silencieusement |

---

### Phase 27A - Mode Fichier (doublons exacts entre archives) ✅

**A1. Option UI et `ScanParams`**
- `ScanParams` : champ `scan_archives: bool` (défaut false)
- `useScanConfig.ts` : champ `scanArchives` (défaut false) - transmis à `invoke("scan_folder")`
- UI : checkbox "Analyser les archives" dans le panneau principal de configuration du scan, visible **uniquement en mode Fichier** pour cette phase - même niveau que "Récursif"
- `i18n.ts` : clés `scanArchives`, `scanArchivesTooltip` bilingues

**A2. Module `archive/` Rust**
- `src-tauri/src/archive/mod.rs` : `ArchiveEntry { internal_path: String, size: u64 }` + trait `fn read_entry_bytes(path, internal_path, size_threshold) -> Result<EntryContent>` où `EntryContent = Bytes(Vec<u8>) | TempFile(NamedTempFile)`
- `src-tauri/src/archive/zip_reader.rs` : implémentation ZIP via crate `zip` - itère les entrées, filtre les répertoires et les entrées protégées (password-needed = skip silencieux), dispatche sur seuil 100 Mo
- `src-tauri/src/archive/tar_reader.rs` : implémentation tar.gz / tar.bz2 / tar.xz / tar.zst - décompression via le crate adapté, même logique de filtrage et de seuil
- `src-tauri/src/archive/sevenz_reader.rs` : implémentation 7z via `sevenz-rust`
- `src-tauri/src/archive/mod.rs` : `fn detect_archive_format(path) -> Option<ArchiveFormat>` (par extension, insensible à la casse) + `fn list_entries(path) -> Result<Vec<ArchiveEntry>>` - retourne `Err` silencieusement converti en log pour RAR
- `Cargo.toml` : ajouter `zip`, `tar`, `flate2`, `bzip2`, `xz2`, `zstd`, `sevenz-rust`, `tempfile`

**A3. Phase de scan archives dans `scanner/`**
- `scanner/archive_phase.rs` : `fn run(files: &[PathEntry], params: &ScanParams, on_progress) -> Vec<ArchiveGroupResult>`
  1. Filtrer les `PathEntry` qui sont des archives détectées
  2. Pour chaque archive : `list_entries()` + lecture des bytes / temp file de chaque entrée
  3. Hacher chaque entrée (xxhash, même pipeline que les fichiers ordinaires) - chaque entrée émet un tick de progression
  4. Grouper les entrées par hash - ne garder que les groupes dont les entrées proviennent d'**au moins deux archives différentes** (pas de groupe "interne" à une seule archive)
  5. Pour chaque archive impliquée dans au moins un groupe : calculer `total_entries`, `duplicated_entries`, `can_delete`
  6. Construire les `ArchiveGroupResult` via Union-Find (même pattern que pHash) : deux archives sont dans le même groupe si elles partagent au moins un hash en commun
- Appel de `archive_phase::run()` depuis `scanner/mod.rs` si `params.scan_archives` et mode Fichier

**A4. Structures de résultats**
- `scanner/types.rs` : nouveaux types
  ```rust
  pub struct ArchiveInGroup {
      pub path: String,
      pub total_entries: usize,
      pub duplicated_entries: usize,
      pub can_delete: bool,      // duplicated_entries == total_entries && total_entries > 0
      pub wasted_bytes: u64,     // somme des tailles des entrées dupliquées
  }
  pub struct ArchiveGroupResult {
      pub id: String,            // UUID stable pour l'UI
      pub archives: Vec<ArchiveInGroup>,
      pub shared_entry_count: usize,  // nb de hashes distincts partagés
  }
  ```
- `ScanResult` : nouveau champ `archive_groups: Vec<ArchiveGroupResult>` (vide si `scan_archives=false`)
- Commande Tauri `get_archive_comparison(archive_path_a: String, archive_path_b: String) -> Result<ArchiveComparison, String>` : appelée en lazy uniquement quand l'utilisateur ouvre le comparateur - relit les entrées et reconstitue la comparaison détaillée entrée par entrée
  ```rust
  pub struct ArchiveEntryResult {
      pub internal_path: String,
      pub size: u64,
      pub status: String,          // "duplicate" | "unique"
      pub duplicate_in: Option<String>,  // internal_path dans l'autre archive
  }
  pub struct ArchiveDetail {
      pub path: String,
      pub entries: Vec<ArchiveEntryResult>,
  }
  pub struct ArchiveComparison {
      pub a: ArchiveDetail,
      pub b: ArchiveDetail,
  }
  ```

**A5. Types TypeScript**
- `src/types.ts` : `ArchiveInGroup`, `ArchiveGroupResult`, `ArchiveEntryResult`, `ArchiveDetail`, `ArchiveComparison`
- `ScanResult` : champ `archive_groups?: ArchiveGroupResult[]`

**A6. Composant `ArchiveGroupCard.tsx`**
- Affiche une ligne par paire/groupe d'archives impliquées
- Pour chaque archive : nom de fichier, chemin, `X/Y fichiers dupliqués`, taille récupérable
- Badge "Supprimable" si `can_delete=true`
- Bouton "Voir le contenu" → ouvre `ArchiveComparator`
- Bouton "Supprimer" uniquement si `can_delete=true` (`invoke("delete_files", ...)` existant, corbeille)
- Section dédiée dans `App.tsx` sous les groupes de fichiers ordinaires, visible si `archive_groups.length > 0`

**A7. Composant `ArchiveComparator.tsx`**
- Modal plein écran, même pattern d'ouverture/fermeture que `ImageComparator`
- Deux colonnes : archive A (gauche) et archive B (droite)
- En-tête de colonne : nom d'archive, chemin complet, ratio `X/Y fichiers en commun`
- Liste des entrées dans chaque colonne : icône type de fichier (`FileThumbnail` mode "other"), nom interne, taille, badge vert "doublon" ou gris "unique"
- Pour les entrées "doublon" : infobulle ou texte discret indiquant le chemin correspondant dans l'autre archive
- Pas d'action de suppression sur les entrées individuelles
- Si `can_delete` sur une archive : bouton "Supprimer cette archive" en bas de la colonne
- Navigation entre plusieurs comparaisons si le groupe contient 3+ archives (sélecteur de paire)
- Fermeture : Escape ou clic sur overlay
- `i18n.ts` : clés `archiveComparator`, `archiveEntries`, `archiveDuplicate`, `archiveUnique`, `archiveCanDelete`, `archiveDeleteThis`, `archiveViewContent` bilingues

**A8. Tests Rust**
- `archive/zip_reader.rs` : lecture entrées d'un ZIP en mémoire (fixture .zip créée dans le test), répertoires filtrés, ZIP vide retourne liste vide
- `archive/zip_reader.rs` : ZIP avec entrée > seuil → TempFile créé et contenu correct
- `archive/tar_reader.rs` : lecture entrées d'un tar.gz basique
- `archive/mod.rs` : `detect_archive_format` - extensions connues et inconnues
- `scanner/archive_phase.rs` : deux ZIPs avec contenu identique → groupe avec `can_delete=true` sur les deux
- `scanner/archive_phase.rs` : deux ZIPs avec contenu partiellement identique → groupe avec `can_delete=false`
- `scanner/archive_phase.rs` : deux ZIPs sans contenu commun → aucun groupe
- `scanner/archive_phase.rs` : entrées internes à une seule archive → pas de groupe (comparaison intra-archive ignorée)

**A9. Tests TypeScript**
- `ArchiveGroupCard.test.tsx` : rendu de base, badge "Supprimable" présent/absent, clic "Voir le contenu" appelle callback, bouton Supprimer visible uniquement si `can_delete`
- `ArchiveComparator.test.tsx` : rendu colonnes A/B, badge "doublon"/"unique", bouton Supprimer si can_delete, fermeture Escape, groupe vide retourne null
- `App.test.tsx` section S : section archives absente si `archive_groups=[]`, présente si non vide, invoke `get_archive_comparison` au clic "Voir le contenu"

**A10. Documentation**
- `src/help/content.ts` : article "Analyser les archives" bilingue dans nouvelle section "Archives"
- `README.md` : fonctionnalité ajoutée dans la section Fonctionnalités

**Réalisé**
- [x] Module `src-tauri/src/archive/` : zip_reader, tar_reader (gz/bz2/xz/zst), sevenz_reader, mod avec detect_format + hash_archive_entries
- [x] `scanner/archive_phase.rs` : Union-Find inter-archives, can_delete, progress
- [x] Commandes Tauri : `get_archive_groups`, `get_archive_comparison`
- [x] `ArchiveGroupCard.tsx` + `ArchiveComparator.tsx` + leurs tests
- [x] `App.tsx` : groupes d'archives integres dans la liste principale (pas de section separee), tries par espace gaspille au meme titre que les autres doublons
- [x] `i18n.ts` : 13 cles bilingues (archive*) + `phaseArchives` + `typeArchives` ("fichiers archives")
- [x] `src/help/content.ts` : article "archive-scan" bilingue
- [x] 7z fonctionnel via `sevenz-rust2` (fork actif de sevenz-rust qui resout les contraintes HRTB)
- [x] Format `.cbz` (Comic Book ZIP) traite comme ZIP. `.cbr` ignore comme `.rar`

**Ameliorations post-merge (correctifs)**
- [x] **Bug session** : `archive_groups` n'etaient pas persistes. `SessionFile` etendu avec `archive_groups: Vec<ArchiveGroupResult>` (rétrocompatible via `#[serde(default)]`), `save_session` les ecrit, `load_session` les restaure avec filtre defensif sur les chemins inexistants. `delete_files` purge aussi `archive_groups` du cache et du disque. 2 tests de round-trip ajoutes.
- [x] **Bug pairing** : `compute_comparison` utilisait une `HashMap<u64, &ArchiveEntry>` qui ecrasait les entrees ayant le meme hash. Resultat : si A avait 3 fichiers identiques et B en avait 1, l'UI affichait 3 fois la meme entree B. Fix : ajout du champ `hash: String` (hex) dans `ArchiveEntryResult`, refactor de `alignEntries` pour faire un pairing greedy par hash.
- [x] **Bug progression** : la phase `archives` n'etait pas dans `ScanPhase` cote TS, donc le label tombait sur "fichiers audio" en fallback. Ajout du type + clés i18n + insertion conditionnelle dans `relevantPhases` selon `scanArchives`.
- [x] **Bug bulles de progression** : flex-wrap causait des sauts de ligne en cours de scan. CSS passe a `flex-wrap: nowrap`, `phaseExact` renomme "Comparaisons exactes" pour gagner de la place.
- [x] **Refonte du comparateur d'archives** : plein ecran via nouveau `ComparatorBasicShell` (factorise dans `comparatorShared.tsx`), alignement face-a-face des doublons par hash avec lignes vides pour combler, scroll synchronise entre les 2 colonnes, footer méta par cote (nom/dossier/taille/date/ratio), filtre "Doublons uniquement", icones type de fichier colorees par categorie, ellipsis a gauche sur les chemins.
- [x] **Refonte ArchiveGroupCard** : layout identique a GroupCard (memes classes CSS), case a cocher seulement si `can_delete=true` sinon icone 🚫 avec tooltip sur toute la cellule.
- [x] **Factorisation** : `basename()` extrait dans `utils.ts`, `toMediaUrl()` et `KeepButton` extraits dans `comparatorShared.tsx`, `FolderIcon` extrait dans `components/icons.tsx`, `FileTypeIcon` exporte depuis `FileThumbnail.tsx`. ~50 lignes de duplication supprimees.
- [x] **Decoupage App.tsx** : 1056 -> 825 lignes via extraction de `ScanProgressView`, `SessionPicker`, `ScanResultsToolbar`, `ConfirmDeleteModal` (composants) + `useDragDrop`, `useKeyboardShortcuts` (hooks).
- [x] 229 tests Rust / 397 tests TypeScript - tous au vert

---

### Phase 27B - Mode Image (pHash sur contenu d'archives) ✅ (B-min)

**B1. pHash sur entrées d'archives image**
- `scanner/archive_phase.rs` : si mode Image, après la phase de hachage exact, lancer la phase pHash sur les entrées image des archives
  - Entrées `Bytes(Vec<u8>)` → `image::load_from_memory()` pour décoder (pas de fichier disque nécessaire)
  - Entrées `TempFile` → chemin normal (déjà sur disque)
  - Le cache pHash utilise une clé composite `archive_path::internal_path` + mtime de l'archive parente pour l'invalidation
- Les groupes pHash archives suivent les mêmes règles : comparaison inter-archives uniquement, pas de croisement avec les images disque
- `ArchiveGroupResult` : champ `match_type: "exact" | "similar"` + `similarity_score: Option<f32>` pour les groupes pHash
- `ScanParams` : la phase pHash archives est activée si `scan_archives=true && find_similar=true`
- Option UI : checkbox visible en mode Image (même condition d'affichage que pour mode Fichier)

**B2. ArchiveComparator étendu**
- Entrées image "doublon similaire" : badge orange "similaire" (à la place de vert "doublon exact")
- Affichage du score de similarité en pourcentage
- Thumbnail lazy de l'entrée image si disponible (via `get_image_thumbnail` avec le chemin tempfile ou via appel dédié pour les bytes)

**B3. Tests Rust et TypeScript**
- `archive_phase.rs` : deux ZIPs avec la même image en résolutions différentes → groupe similaire
- `ArchiveComparator.test.tsx` : badge "similaire" avec score, badge "doublon exact" restant

**B-min (livre) - Realise**
- [x] `ArchiveEntry` Rust etendu avec `phash: Option<(Vec<u8>, Vec<u8>)>`
- [x] Helpers `compute_hashes_from_bytes` et `is_image_path` exposes dans `scanner::hash`
- [x] zip_reader, tar_reader, sevenz_reader : decodage in-memory (jusqu'a 50 Mo) pour les entrees image quand `compute_phash=true`
- [x] `archive_phase::run` : 2e passe d'appariement par pHash sur les entrees image non-matchees en exact, integration au Union-Find
- [x] `compute_comparison(path_a, path_b, find_similar, sim_threshold)` : appariement greedy par pHash apres l'exact, status="similar" + similarity_score (% sur la taille du hash fin)
- [x] `ArchiveEntryResult` etendu : `status: "duplicate" | "similar" | "unique"` + `similarity_score: Option<f32>`
- [x] UI : checkbox "Analyser les archives" disponible aussi en mode Images
- [x] `ArchiveComparator` : alignEntries gere la 3e categorie "similar" (paires via duplicate_in), badge orange + score % sur les lignes similaires
- [x] CSS : `.archive-entry-row--similar` (fond orange tres clair) + `.archive-row-score`
- [x] 2 nouveaux tests Rust (image similaire detectee avec find_similar, non-image ignoree)
- [x] 2 nouveaux tests TS (similar pairing + passage des params find_similar/sim_threshold a invoke)
- [x] 231 tests Rust / 412 tests TypeScript - tous au vert

**B-full (differee)** : cache pHash dedie pour archives + thumbnails lazy des entrees image dans le comparateur. A faire si besoin de perfs (re-scan rapide).

**B-revised (livre) - Refonte par extraction temp dir**
- [x] Module `archive/extractor.rs` : extrait les entrees image vers un sous-dossier de `app_data/scan_temp/<uuid>/`, support ZIP / tar.* / 7z, callback per-entry pour progress + annulation, cleanup automatique via TempDir Drop
- [x] Helpers `estimate_extraction_size(archives)` (lit headers sans decompresser) et `available_disk_space(path)` (via crate `fs2`)
- [x] `archive_phase::run` : Phase 1 (xxh3 streaming, in-memory) + Phase 2 (extraction + pHash parallele rayon avec EXIF thumbnail via `compute_two_pass_hashes`) + Phase 3 (Union-Find groups)
- [x] Pre-check espace disque avant scan : commande Tauri `check_archive_disk_space(archives)` retourne `{ needed_bytes, available_bytes, needs_warning, deficit_bytes }`. Marge de securite 1 Go.
- [x] Modale `DiskSpaceWarningModal` (FR/EN) : titre, corps avec valeurs Mo/Go adaptatives, boutons "Annuler" / "Continuer sans analyser les images archivees"
- [x] Flag `skip_archive_phash: bool` dans `ScanParams` : si user opte pour "continuer sans", la Phase 2 est sautee mais Phase 1 (xxh3) reste active
- [x] Cleanup au boot de l'app : `setup` supprime `app_data/scan_temp/` en entier (silencieux) en cas de temp dir orphelin laisse par un crash
- [x] Commande `list_archive_paths(folder, recursive)` : list rapide des archives d'un dossier pour le pre-check frontend
- [x] Tests : `extract_filtre_les_non_images`, `extraction_bytes_correspondent_au_zip_source`, `temp_dir_supprime_apres_drop`, `cancel_via_callback_arrete_l_extraction`, `estimate_compte_uniquement_les_images`, `estimate_archives_inexistantes_retourne_zero`, `skip_phash` dans le test similar
- [x] 237 tests Rust / 418 tests TypeScript - tous au vert / 0 warning clippy

**Benefices mesurables vs B-min** :
- Parallelisme rayon sur le decodage pHash → speedup proportionnel au nb de cores
- EXIF thumbnail (via `compute_two_pass_hashes(use_exif_thumbnail=true)`) → JPEG decodage 5-10x plus rapide
- Architecture prete pour 27C (audio fpcalc requiert un fichier disque)
- Cleanup robuste meme apres crash (boot-time cleanup)

---

### Phase 27C - Mode Son archives (empreinte acoustique sur entrées audio) ✅

**Objectif** : symétriser la détection inter-archives entre images et audio. Quand l'utilisateur scanne en mode Audio avec "Analyser les archives", les entrées audio des archives sont extraites et comparées via fpcalc, comme les entrées image en mode Image. Cas d'usage attendu : faible (collections de samples ou backups iTunes archivés). Implémenté pour la complétude par symétrie avec 27B.

**Architecture** (héritée de 27B-revised) :
- Pattern temp dir + extraction parallèle. fpcalc requiert un chemin disque, donc l'extraction est obligatoire (pas d'in-memory comme 27B-min).
- Réutilise le squelette d'`archive::extractor` : étendre pour gérer le filtre audio en plus du filtre image, ou ajouter une fonction sœur `extract_audio_entries`.
- Le matching est silencieux (pas d'`on_progress` par paire), comme pour 27B Phase 2 → sync de fin de phase rattrape.

**Drapeau d'extraction unifié** :
- Le flag `skip_archive_phash` actuel est renommé/unifié en `skip_archive_extraction` (un seul flag bool, couvre les deux usages : extraction d'images en mode Image, extraction d'audio en mode Audio). L'utilisateur ne peut pas analyser les deux dans la même analyse (mode mutuellement exclusif), donc un drapeau unique suffit.
- Migration : les sessions persistantes ne stockent pas ce flag (paramètre éphémère du scan). Le rename est interne, pas de souci de rétro-compat.

#### C1. Backend : extraction + fingerprint + cache + progression ✅

**C1.1 Helper de détection audio** (`audio::hash`) :
- [x] Réutilisation de l'existant `audio::is_audio(path: &str) -> bool` (au lieu de créer `is_audio_path`) avec la liste `AUDIO_EXTS = ["mp3","flac","ogg","m4a","aac","wav","wma","opus","aiff","aif","ape"]`. Cohérent avec ce que `collect_files` reconnaît déjà.
- [x] Test : `audio::hash::tests::is_audio_detects_formats`.

**C1.2 Comptage** :
- [x] `archive::count_archive_audio_entries(path)` (wrapper sur `count_archive_entries_filtered` avec prédicat `audio::is_audio`). ZIP/7z exact via headers, tar.* via itération du stream.
- [x] Test ZIP `count_archive_audio_entries_zip_compte_que_les_audios` + test générique `count_archive_entries_filtered_predicat_arbitraire`. Le moteur sous-jacent (`count_entries_fast`) est déjà couvert pour 7z/tar.

**C1.3 Extraction temp dir** (`archive/extractor.rs`) :
- [x] Refactor en `extract_entries_filtered(...)` paramétré par closure (DRY). `extract_image_entries` et `extract_audio_entries` sont des wrappers.
- [x] `estimate_extraction_size_filtered(archive_paths, predicat)` - utilisé via `commands/archive.rs` qui passe `is_audio` ou `is_image_path` selon le mode.
- [x] Tests : couverture générique via les tests existants (extraction, taille estimée, cancel) ; le filtre est testé indirectement par `count_archive_entries_filtered_predicat_arbitraire`.

**C1.4 Phase audio archives** (`scanner/archive_phase.rs`) :
- [x] PASSE 3 dans `archive_phase::run` qui s'active si `find_similar_audio=true && !skip_archive_extraction`. Mutuellement exclusive avec PASSE 2 (modes find_similar et find_similar_audio non simultanés côté ScanParams).
- [x] Extraction des entrées audio non encore matchées en exact via filter sur `duplicated_entries`.
- [x] fpcalc parallèle via `rayon::par_iter` sur les chemins extraits ; subprocess fpcalc avec `creation_flags(0x08000000)` sous Windows hérité de `audio::compute_fingerprint`.
- [x] Matching inter-archive : `audio::fingerprint_distance` (Hamming normalisé) + tolérance de durée (`audio_duration_tolerance`).
- [x] Update `duplicated_entries` et `shared_count_per_pair` pour les paires audio similaires.
- [x] Persiste fingerprints dans `all_entries[i].audio_fp` puis dans `entries_cache` (`audio_fingerprint` + `audio_duration_secs` via `ArchiveEntryHash`).

**C1.5 Cache** (`archive::ArchiveEntryHash`) :
- [x] Champs `audio_fingerprint: Option<Vec<i32>>` et `audio_duration_secs: Option<f64>` ajoutés avec `#[serde(default)]` (rétro-compat).
- [x] `recompute_group_duplicated_entries` étendue avec paramètres `audio_sim_threshold` + `audio_duration_tolerance` ; reconnaît les matches audio (Hamming sur fingerprints i32 + tolérance de durée) en plus des xxh3 et pHash.
- [x] `ensure_cache_for_groups` : alternative retenue (sessions pré-cache audio restent sans fingerprint, `audio_fingerprint: None`). Pas de re-fpcalc au load. Acceptable car le mode Audio archives est une feature récente.

**C1.6 Progression** (`scanner/mod.rs`) :
- [x] Constante `EMITS_ARCH_AUDIO = 2` (extraction + fpcalc, matching silencieux).
- [x] Phase id `archives_audio` dans `ScanPhase` (Rust string + `src/types.ts`).
- [x] `total_work` étendu : `+ archive_audio_count * EMITS_ARCH_AUDIO` quand `find_similar_audio && scan_archives && !skip_archive_extraction`.
- [x] Sync final `sync_to(total_work, "archives_phash", ...)` couvre l'audio aussi (PASSE 2 et PASSE 3 sont mutuellement exclusives, le sync final rattrape les emits manquants quel que soit le mode).
- [ ] Test d'invariant dédié `progression_atteint_total_avec_archives_audio` (pendant à `progression_atteint_total_avec_archives` qui ne couvre que mode Image). Cas de régression à ajouter.

**C1.7 ScanParams + commande `scan_folder`** :
- [x] `skip_archive_phash` renommé en `skip_archive_extraction` côté Rust (`ScanParams.skip_archive_extraction`) et TS (`skipArchiveExtraction`). Le frontend (`useScanExecution`, `App.tsx::continueWithoutArchivePhash`) passe le bon nom.
- [x] La modale d'espace disque conserve son trigger avec texte adapté selon le mode.

**C1.8 Tests Rust** :
- [ ] `archive_phase::tests::deux_zips_avec_audio_similaire_donnent_groupe` : test e2e avec fichiers audio synthétiques + fingerprint identique. À faire (le test actuel `recompute_detecte_match_audio_via_fingerprint` ne couvre que la fonction de recompute, pas la pipeline complète).
- [x] `archive::tests::recompute_detecte_match_audio_via_fingerprint` couvre `recompute_group_duplicated_entries` avec paires audio (équivalent fonctionnel à l'item `audio_archives_count_dans_duplicated_entries` du plan).
- [ ] Tests de `count_archive_audio_entries` pour 7z et tar.* (ZIP couvert ; le mécanisme générique est testé par `count_archive_entries_filtered_predicat_arbitraire`, mais une couverture explicite par format serait plus rassurante).

#### C2. Frontend : comparateur d'archives avec lecteur audio ✅

**C2.1 Détection des entrées audio** :
- [x] `isAudioPath(p: string)` exporté depuis `src/components/FileThumbnail.tsx`, symétrique à `isImagePath`.

**C2.2 Composant `ArchiveEntryAudioPlayer`** (`src/components/FileThumbnail.tsx`) :
- [x] Bouton play / pause minimal (`data-testid="archive-audio-btn"`).
- [x] À l'activation : `invoke<string>("get_archive_entry_url", { archivePath, internalPath })`.
- [x] Lecture via `<audio src={url}>` HTML5 standard, géré par WebKit.
- [x] Spinner overlay pendant l'extraction.
- [x] Style aligné sur la cellule miniature image.

**C2.3 Backend `get_archive_entry_url`** (`src-tauri/src/commands/files.rs`) :
- [x] Extrait l'entrée vers `app_data/archive_preview/<id>_<filename>` (réutilise le sous-dossier purgé au boot).
- [x] Retourne `http://127.0.0.1:<media_server_port>/<absolute_path_url_encoded>` via le media server existant (`media_server.rs`).
- [x] Même logique de cleanup que `open_archive_entry` (purge au boot, persistance pendant la session).

**C2.4 ArchiveComparator étendu** :
- [x] `EntryCell` : utilise `ArchiveEntryAudioPlayer` pour les entrées audio, `ArchiveEntryThumbnail` pour les images, fallback `FileTypeIcon` pour le reste.
- [ ] `ScoreCell` : non différencié audio vs pHash (le pourcentage seul est affiché). Décision design : symbole/texte additionnel jugé visuellement bruité, à reconsidérer si retour utilisateur.
- [x] Affichage de la durée de l'entrée audio à côté du lecteur (côté centre), même police que `archive-row-size`. Donnée déjà en cache (fpcalc retourne `(fingerprint, duration)`), propagée via `ArchiveEntryResult.audio_duration_secs` ; pas de re-extraction. Format `mm:ss` ou `h:mm:ss` via `formatDurationSecs`.

**C2.5 Tests TS** (`src/ArchiveComparator.test.tsx`) :
- [x] Test `affiche un bouton play (au lieu de la miniature) sur les entrees audio`.
- [x] Tests `affiche la duree audio (mm:ss) a cote du lecteur` + `n'affiche pas de duree quand audio_duration_secs est absent` (couvre les sessions pré-cache).
- [ ] Mock de `get_archive_entry_url` + vérification du `<audio src>` après clic. Couverture supplémentaire à ajouter (interaction click → URL fetch → `<audio>` injection).
- [ ] Score audio (couplé au C2.4 ScoreCell, donc moot tant que pas différencié).

#### C3. Pré-check espace disque + modale ✅

**C3.1 Estimation étendue** :
- [x] `commands::archive::check_archive_disk_space` paramétré par `mode: "image" | "audio"` ; appelle `estimate_extraction_size_filtered` avec le bon prédicat.
- [x] Le frontend (`App.tsx::handleScan`) passe le mode courant (`detectionMode === "audio" ? "audio" : "image"`).

**C3.2 Modale d'avertissement** (`DiskSpaceWarningModal`) :
- [x] Texte adapté selon le mode : `diskWarningBodyAudio` vs `diskWarningBody` ; bouton continuer `diskWarningContinueWithoutAudio` vs `diskWarningContinueWithoutImages`.
- [x] Le bouton "Continuer sans analyser" set `skipArchiveExtraction=true`.
- [x] Tests `DiskSpaceWarningModal.test.tsx` : `mode image : message et bouton mentionnent les images` + `mode audio : message et bouton mentionnent les sons`.

**C3.3 Pre-check côté App.tsx** :
- [x] Trigger sur `config.scanArchives && (config.detectionMode === "images" || config.detectionMode === "audio")`.

#### C4. Documentation + cleanup ✅

- [x] `src/help/content.ts` : article `archive-scan` mis à jour FR + EN avec le mode Audio (extraction + fingerprint Chromaprint + lecteur play dans le comparateur).
- [x] `README.md` : ligne "Scan d'archives" mentionne le mode Audio (`fingerprint Chromaprint (fpcalc)`, bouton play inline, pré-check d'espace disque adapté au mode).
- [x] `AGENTS.md` : `EMITS_ARCH_AUDIO=2` ajouté à la liste des constantes (ligne 105) ; `archives_audio` ajouté aux phases du tableau.
- [x] Counts de tests à jour : 251 Rust + 431 TS dans README.
- [x] Rename `skip_archive_phash` → `skip_archive_extraction` partout (Rust, TS, tests).

#### Reliquat Phase 27C

Items résiduels non bloquants (peuvent être traités à part si besoin) :
- Test d'invariant `progression_atteint_total_avec_archives_audio` (C1.6).
- Test e2e `deux_zips_avec_audio_similaire_donnent_groupe` (C1.8) ; tests `count_archive_audio_entries` pour 7z/tar (C1.8).
- Test TS du flow `<audio src>` après mock `get_archive_entry_url` (C2.5).
- Différenciation visuelle `ScoreCell` audio vs pHash (C2.4) - décision design, à reconsidérer si retour utilisateur.

**Découpage en livrables** : C1 d'abord (backend complet, testable seul via `cargo test`), puis C2 + C3 ensemble (frontend cohérent), puis C4 (cleanup + doc).

**Note sur le mode Vidéo archives** : non implémenté et **abandonné**. Personne ne zippe des vidéos, et si ça arrivait par accident, ce ne serait pas un cas à dédoublonner. Pas la peine d'investir dans le miroir 27D pour la complétude formelle.

---

## Phase 28 - Refonte progression + comparateur d'archives v2 ✅

**Objectif : barre de progression fiable (jamais de recul, atteint pile 100% à la fin) et comparateur d'archives plus utilisable (miniatures, clic-pour-ouvrir, layout en grille).**

### Comparateur d'archives v2 ✅
- [x] Layout : remplacement des 2 panneaux à scroll synchronisé par une **grille unique à 3 colonnes** (archive A | score % | archive B). Miniatures collées au centre, tailles aux bords externes, score (`100%` exact / `99%` similar / vide pour unique) en colonne centrale unique.
- [x] Miniatures : nouveau composant `ArchiveEntryThumbnail` avec **lazy load** via IntersectionObserver. Backend `get_archive_entry_thumbnail(archivePath, internalPath, maxSize)` qui décode l'entrée en mémoire et renvoie une JPEG base64. Repli sur `FileTypeIcon` pour les non-images ou en cas d'erreur.
- [x] Clic miniature : nouvelle commande Tauri `open_archive_entry(archive_path, internal_path)` qui extrait l'entrée vers `app_data/archive_preview/<id>_<filename>` et ouvre avec le viewer par défaut. Spinner overlay pendant l'opération. Cleanup du dossier `archive_preview/` au boot de l'app.
- [x] Style : taille en italique + gap 1rem pour démarquer visuellement de nom de fichier ; sync du `simThreshold` du comparateur avec celui du scan (plus de hardcoded `10`).
- [x] Recompute des compteurs au load_session : `recompute_group_duplicated_entries` + `ensure_cache_for_groups` qui ré-itère les archives pour les sessions pré-cache. Cohérence du badge "Supprimable" avec ce que voit l'utilisateur dans le comparateur.

### Modèle de progression unifié ✅
- [x] **Compteur global atomique** : nouveau `progress_counter: Arc<AtomicUsize>` partagé entre toutes les phases via un wrapper `wrapped_on_progress` qui ignore le `current` calculé localement et utilise `pc.fetch_add(1)` à la place. Garantit l'incrément +1 par emit, peu importe la sous-phase ou le parallélisme rayon.
- [x] **`total_work` accurate** : constantes par phase (`EMITS_EXACT=1`, `EMITS_IMAGES=3`, `EMITS_VIDEOS=2`, `EMITS_AUDIO=2`, `EMITS_ARCH_P1=1`, `EMITS_ARCH_P2=2`) basées sur l'audit du nombre réel d'`on_progress` émis. Plus d'over/undershoot du calcul de `total_work`.
- [x] **Sync de fin de phase** : `sync_to(budget_after_X)` après chaque phase via `fetch_max` rattrape les emits manquants (cache warm, exclusions par filtres, matching silencieux d'archives Phase 2). Garantit qu'on atteint exactement `total_work` à la fin = 100% pile.
- [x] **Filtre snapshot max** : `commands/scan.rs` n'écrase la valeur courante que si `new_current >= existing`. Sans ce filtre, des emits parallèles arrivant out-of-order pouvaient faire reculer le snapshot vu par le frontend.
- [x] **Comptage exact tar/7z** : `count_entries_fast` et `count_archive_image_entries` itèrent maintenant tar/7z (au lieu de `size / 100000`) pour avoir des budgets accurate. Quelques secondes ajoutées au démarrage du scan, en échange d'une barre fiable.
- [x] **`almostDone` simplifié** : `phase_total - phase_current < 10` dans la dernière phase (au lieu d'une heuristique rate/pct). Plus de clignotement ni faux positif.
- [x] Tests : `progression_atteint_total_avec_phases_simples`, `progression_atteint_total_avec_archives`, `progression_apres_filtre_snapshot_max_strictement_monotone`. Vérifient que `current ≤ total` toujours, que le max atteint == `total`, et que la séquence filtrée est strictement monotone.

### Misc UX ✅
- [x] Tooltips checkbox "Sous-dossiers" et "Analyser les archives" mentionnent explicitement que l'option **multiplie la durée du scan**.
- [x] AGENTS.md : 3 règles impératives ajoutées (Vision d'ensemble avant patch local, Sémantique de la progression, Architecture cache pour opérations lazy, Cohérence des seuils, Diagnostic par logs avant code) ; section "Sémantique de la progression" mise à jour avec le nouveau modèle.
- [x] 245 tests Rust / 426 tests TypeScript / tsc clean.

---

## Correctifs post-1.0.0

### Liste d'ignorés appliquée au rechargement de session ✅

**Bug** : au chargement d'une session historisée, les groupes ajoutés à la liste d'ignorés *après* le scan d'origine réapparaissaient dans la liste affichée. La liste d'ignorés n'était appliquée qu'à la création du scan, pas au reload.

- [x] [src-tauri/src/commands/session.rs::load_session](../src-tauri/src/commands/session.rs) charge `IgnoreList::keys_set()` avant le `spawn_blocking` puis applique le filtre **après** `save_session`. La session sur disque garde tous les groupes originaux ; le filtre n'est qu'une vue affichée. Permet à `clear_ignore_entry` de restaurer le groupe au prochain reload.
- [x] Nouvelle fonction pure `apply_ignore_filter(groups, summary, ignored_keys) -> (groups, summary)` qui recalcule `total_groups` et `total_wasted_bytes` quand au moins un groupe est filtré ; no-op si la liste est vide.
- [x] 3 tests Rust : `apply_ignore_filter_retire_les_groupes_dans_la_liste`, `apply_ignore_filter_passthrough_si_aucun_match`, `apply_ignore_filter_no_op_si_liste_vide`.
- [x] 272 tests Rust / 440 tests TypeScript / tsc clean.

---

## Phase 29 - Remux étendu sans réencodage audio ✅

**Objectif : élargir la couverture du comparateur vidéo en remuxant davantage de conteneurs (notamment `.avi` et `.wmv` quand le codec interne est compatible mp4), sans jamais réencoder l'audio. Si le remux pur échoue, le fichier reste classé `Unsupported` et l'UI propose le lecteur système.**

### Backend - extension de la classification ✅
- [x] `video/playback.rs::is_remux_candidate_extension` : `avi`, `wmv`, `asf`, `f4v` ajoutés à la liste, à côté des conteneurs déjà supportés (`flv`, `mkv`, `ts`, `m2ts`, `mts`, `mov`, `3gp`, `3g2`).
- [x] `video/playback.rs::prepare_for_playback` : branche de fallback `-c:a aac` supprimée. `-c copy -movflags +faststart` reste l'unique tentative ; en cas d'échec, retour direct en `PreparedVideo::Unsupported`. Plus de blocage UI plusieurs secondes pour rien sur les fichiers audio incompatibles mp4.
- [x] Tests de classification ajoutés : `classify_remux_pour_avi_h264` (h264 + hevc), `classify_remux_pour_wmv_et_asf_h264`, `classify_remux_pour_f4v_h264`. Test existant `classify_unsupported_pour_avi_mpeg4` enrichi avec `wmv3` et `asf+wmv3`.
- [x] Les tests existants (`classify_unsupported_pour_avi_mpeg4`, `classify_unsupported_si_codec_inconnu`, etc.) restent verts : l'extension passe désormais le filtre, mais le codec recale au niveau de `is_remux_compatible_codec`.
- [x] Note documentaire : un `.avi` H.264 + MP3 → `-c copy` réussit (mp3 légal en mp4 ISO BMFF). Un `.avi` H.264 + AC3 → `-c copy` échoue → `Unsupported` (comportement attendu, sera couvert par la Phase 30).

### Frontend - aucun changement de logique ✅
- [x] `VideoComparator` continue à afficher placeholder + bouton "ouvrir dans le lecteur système" pour les nouveaux cas `Unsupported` (audio incompatible). Pas de modif frontend.

### Documentation ✅
- [x] AGENTS.md : section "WebView2/WebKit : conteneurs vidéo non lus nativement" mise à jour avec la nouvelle liste (`avi`, `wmv`, `asf`, `f4v`) et la mention explicite "Pas de fallback de réencodage audio".
- [x] `src/help/content.ts` : article "Ouvrir le comparateur de vidéos" mis à jour FR + EN (liste élargie des conteneurs remuxés + mention "ni audio" + précision sur les codecs audio incompatibles).
- [x] README.md : pas de mise à jour (pas de feature visible majeure ; les fonctionnalités du comparateur restent décrites au même niveau).
- [x] 275 tests Rust / 440 tests TypeScript / tsc clean.

### Critères de validation (à tester manuellement)
- Un `.avi` H.264 + MP3 ouvre directement dans le comparateur (remux instantané, premier scrub fluide).
- Un `.avi` MPEG-4 ASP (Xvid/DivX) affiche le placeholder "ouvrir dans le lecteur système" comme avant.
- Un `.flv` H.264 + Speex (qui passait en réencodage audio) affiche désormais le placeholder. Acceptable : ce cas est rare et sera couvert par la Phase 30.

---

## Phase 30 - Lecteur vidéo natif embarqué (libmpv) ✅

**Objectif : lire dans le comparateur tous les formats que ffmpeg sait décoder, sans transcodage et sans dépendre des codecs supportés par WebView2/WebKitGTK. Couvre les cas que la Phase 29 laisse en `Unsupported` (codecs anciens type MPEG-4 ASP, WMV3, audio non-mp4 type AC3/WMA/Vorbis).**

**Approche livrée** : `libmpv2` 5.0.3 (binding Rust récent et maintenu), embarqué via `wid=<HWND/XID>` dans une fenêtre fille créée par-dessus un placeholder DOM. Deux instances libmpv côté Rust, sync maître/esclave via les commandes `play_pair` / `pause_pair` / `seek_pair`. Frontend : composant `<NativeVideo>` + `<NativeComparatorBody>` qui pilotent les deux instances, bascule automatique depuis le `<video>` HTML5 quand au moins un côté du comparateur est `Unsupported`. Wayland non supporté (placeholder fallback) ; macOS pas implémenté (feature flag off).

### Backend Rust - moteur de lecture ✅
- [x] Nouveau top-level module `native_player/` (mod.rs, platform.rs, player.rs, registry.rs).
- [x] `NativePlayer::create(parent_handle, rect, audio)` crée la fenêtre native fille (HWND child Win32 sur Windows, sous-fenêtre X11 via x11rb sur Linux), instancie `Mpv::with_initializer` avec `wid`, `hwdec=auto-safe`, `osc=no`, `pause=yes`, `keep-open=yes`, `mute=true` quand audio=false (slave).
- [x] Méthodes : `load`, `play`, `pause`, `seek`, `set_geometry`, `set_visible`, `set_muted`, `state` (snapshot `current_time / duration / paused / eof / loaded`).
- [x] Drop ordonné : libmpv2 termine `Mpv` automatiquement avant le drop de `NativeWindow` qui détruit la HWND/XID.
- [x] Gestion DPI : conversion CSS px → physical px via `tauri::Window::scale_factor()` dans les commandes `create` / `set_geometry`.
- [x] Send+Sync : `unsafe impl` sur `NativePlayer` et `NativeWindow` ; toutes les opérations passent par les Mutex du registre, libmpv est documenté thread-safe.

### Registre + commandes Tauri ✅
- [x] `NativePlayerRegistry` : `Mutex<HashMap<u64, Arc<Mutex<NativePlayer>>>>` + `AtomicU64` pour les ids stables. Sur Linux, `Mutex<Option<NativeWindowFactory>>` partage la connexion X11 entre toutes les instances.
- [x] `with_pair(left, right, f)` : lock ordering ascendant pour éviter les deadlocks ; cas spécial `left == right` traité via `with` simple (sinon double-lock du même Mutex).
- [x] `is_wayland_session()` détecte WAYLAND_DISPLAY / XDG_SESSION_TYPE et fait échouer `create` tôt avec "wayland_unsupported" au lieu d'une erreur cryptique.
- [x] 10 commandes Tauri dans `commands/native_player.rs` : `available`, `create`, `destroy`, `load`, `play_pair`, `pause_pair`, `seek_pair`, `set_geometry`, `set_visible`, `get_state`. Toutes gated `#[cfg(feature = "native-player")]` ; quand off, retournent `feature_disabled` au lieu d'erreurs cryptiques.

### Frontend React ✅
- [x] `src/components/NativeVideo.tsx` : composant `forwardRef<NativeVideoHandle>` avec `useImperativeHandle` exposant `load / play / pause / seek / getState / getId`. Crée le player au mount, le détruit au unmount. ResizeObserver + scroll listener pour `set_geometry`, IntersectionObserver pour `set_visible` quand hors viewport. Prop `hidden` pour masquer manuellement (modal DOM par-dessus).
- [x] `isNativePlayerAvailable()` : invoke + cache module pour éviter les requêtes répétées.
- [x] `src/components/NativeComparatorBody.tsx` : orchestre deux `<NativeVideo>` (gauche audio=true / droite audio=false), barre de contrôles `position: fixed` (play/pause, scrubber, time/duration), polling `get_state` à 250 ms tant que le composant est monté.

### Intégration au comparateur vidéo ✅
- [x] `VideoComparator.tsx` : `useNative = nativeAvailable && (leftUnsupported || rightUnsupported)`. Si vrai, render `NativeComparatorBody` ; sinon comportement existant `<video>` HTML5. Conserve donc les Direct/Remuxed sur le moteur HTML5 pour leur excellente intégration DOM.
- [x] Slot pattern : `leftMetaSlot`, `rightMetaSlot`, `leftKeepSlot`, `rightKeepSlot` permettent à `NativeComparatorBody` de réutiliser les méta-blocks et boutons "Garder" du comparateur normal.

### Plateforme Wayland / macOS - fallback placeholder ✅
- [x] Wayland : `is_wayland_session()` détecte la session, `create` retourne "wayland_unsupported", le frontend retombe sur le placeholder + bouton "ouvrir dans le lecteur système" exactement comme avant la Phase 30.
- [x] macOS : feature `native-player` désactivée par défaut sur macOS dans le job CI dédié (`--no-default-features` lors du build .dmg). Pas d'overhead libmpv sur Mac.

### Build et dépendances ✅
- [x] `Cargo.toml` : feature `native-player` (default ON) qui active `libmpv2 = "5"`, `raw-window-handle = "0.6"`, `windows = "0.59"` (target Windows uniquement), `x11rb = "0.13"` (target Linux uniquement). Buildable sans la feature pour review/CI minimaliste : `cargo build --no-default-features`.
- [x] `scripts/download-mpv.sh` : télécharge libmpv-2.dll + mpv.lib + headers depuis zhongfly/mpv-winbuild (release figée pour stabilité). No-op sur Linux/macOS.
- [x] `build.rs` : crée un placeholder vide `binaries/libmpv-2.dll` quand absent (dev sans build script lancé), comme pour fpcalc/ffmpeg/ffprobe.
- [x] `tauri.conf.json` : `bundle.resources` ajoute `binaries/libmpv-2.dll` → installé à côté du .exe sur Windows. Sur Linux le placeholder vide est bundlé mais inoffensif (libmpv vient de `libmpv2` système via `apt install libmpv-dev`).
- [x] `.github/workflows/build.yml` : `libmpv-dev` ajouté à la liste apt-get Linux ; étape `Download libmpv (Windows)` exécute `scripts/download-mpv.sh` ; `LIBMPV_PATH` exporté pour libmpv2-sys ; macOS build avec `--no-default-features`.

### Documentation ✅
- [x] AGENTS.md : nouvelle section "Lecteur video natif libmpv : fenetre fille + wid + paire master/slave" décrivant l'architecture (HWND child / X11 sub-window / wid), les pièges (z-order modal, screenshots WebView, DPI scaling, dépendances build), la liste des fichiers clés, et la stratégie feature flag.
- [x] README.md : ajout de "lecteur natif libmpv pour les codecs anciens" dans la section Comparateurs côté à côte ; nouvelle ligne "Lecteur vidéo natif | libmpv (Phase 30)" dans Stack technique ; ajout de `libmpv-dev` à la liste des paquets Linux requis pour la compilation.
- [x] `src/help/content.ts` : article "Ouvrir le comparateur de vidéos" mis à jour FR + EN pour mentionner le lecteur natif (couvre tous les formats restants après la Phase 29).

### Tests ✅
- [x] Tests Rust : 3 tests dans `native_player::registry::tests` (id strictement croissant, destroy id inexistant ne panic pas, destroy_all vide la map). Couvre la logique de registry sans nécessiter un display server.
- [x] Tests TypeScript : 8 tests dans `src/components/NativeVideo.test.tsx` (mock invoke + ResizeObserver + IntersectionObserver dans test-setup.ts) - create au mount, destroy au unmount, onReady avec id, onError sur wayland_unsupported, load via ref, getState via ref, getState par défaut quand pas initialisé, isNativePlayerAvailable cache.
- [x] 278 tests Rust / 448 tests TypeScript / tsc clean.

### Critères de validation (à tester sur Windows)
- Un `.avi` MPEG-4 ASP (Xvid) qui affichait le placeholder en Phase 29 s'ouvre désormais dans le comparateur via le lecteur natif et joue correctement.
- Un `.flv` H.264 + Speex audio (qui était en `Unsupported` en Phase 29) joue avec son.
- Sur Windows : redimensionner la fenêtre principale ou scroller fait suivre les deux fenêtres natives ; latence visible < 50 ms (acceptable).
- Sur Linux Wayland : le comparateur retombe sur le placeholder existant, comme en Phase 29.
- Build "light" / "full" : compile + bundle, libmpv-2.dll présent à côté de l'exe sur Windows.
- Build sans la feature : `cargo build --no-default-features` réussit, les commandes `native_player_*` retournent `feature_disabled`.

## Phase 31 : pre-check espace disque integre comme phase 0 du scan ✅

**Objectif** : eliminer l'attente "Précheck running…" devant la barre de progression du scan,
fusionner l'estimation d'extraction avec la phase `counting_archives` qui itere deja les
en-tetes d'archives, et faire afficher la modale d'alerte disque par-dessus la barre de
progression au moment ou le scan a besoin de la decision (pas avant).

### Backend ✅
- [x] `archive::count_and_estimate_archive_image_entries(path) -> (usize, u64)` et `count_and_estimate_archive_audio_entries` : combinent count + estimation taille decompressee en une seule passe sur les en-tetes (ZIP/7z par entry.size, tar.* par heuristique `size * 4`).
- [x] Suppression des wrappers `count_archive_image_entries` / `count_archive_audio_entries` (dead code apres bascule).
- [x] `DiskDecision { Skip, Cancel }` + `DiskDecisionState { Mutex<Option<...>> + Condvar }` dans `lib.rs` : rendez-vous bloquant entre thread de scan (spawn_blocking) et commande Tauri. `wait` poll le `cancelled` flag toutes les 200 ms et sort en `Cancel` si l'utilisateur appuie sur Annuler au lieu de repondre via la modale.
- [x] `ScanParams.disk_warning_handler: Option<DiskWarningHandler>` (type = `Box<dyn Fn(needed, available, deficit, mode) -> DiskDecision + Send + Sync>`) : injecte par la commande Tauri, sans dependance directe du scanner sur Tauri.
- [x] Scanner : pendant `counting_archives`, accumule `bytes_p2` / `bytes_p3` ; apres la boucle, si extraction prevue + handler fourni, compare `available - 1 Go` < `needed` et appelle le handler qui bloque jusqu'a la decision. `Skip` bascule `effective_skip_extraction = true` (au lieu de muter `params`) ; `Cancel` set le `cancelled` flag.
- [x] Commande `respond_disk_warning(decision: "skip" | "cancel")` : `state.set(...)` reveille le scan en attente. Reset du state avant chaque scan pour eviter qu'une decision stale d'un scan precedent ne soit consommee.
- [x] Suppression des commandes `check_archive_disk_space` et `list_archive_paths` (dead code).

### Frontend ✅
- [x] Suppression du bloc precheck dans `handleScan` : plus de `list_archive_paths` ni `check_archive_disk_space` avant `scan_folder`. Suppression des states `precheckRunning`, `precheckAbortedRef`, fonction `cancelPrecheck`, fonction `continueWithoutArchivePhash`, bouton `cancel-precheck-btn`, bloc UI "precheck-running".
- [x] Listener global `scan:disk_warning` dans App.tsx : recoit `{ needed_bytes, available_bytes, deficit_bytes, mode }` du backend pendant le scan et affiche la modale `DiskSpaceWarningModal` par-dessus la barre de progression.
- [x] Boutons de la modale : `onCancel` -> `respond_disk_warning("cancel")` (scan retourne partial), `onContinueSkipping` -> `respond_disk_warning("skip")` (scan continue sans extraction). Le scan ne s'arrete plus a la modale ; il poursuit dans le meme appel `scan_folder`.
- [x] Cle i18n `precheckMessage` supprimee (FR + EN), plus utilisee.

### Tests ✅
- [x] Tests Rust : `count_and_estimate_zip_renvoie_taille_decompressee_des_entrees_filtrees` (count + bytes), `disk_decision_state_set_avant_wait_renvoie_immediatement`, `disk_decision_state_set_pendant_wait_reveille_thread`, `disk_decision_state_wait_sort_si_cancel_flag_passe_a_true`, `disk_decision_state_reset_efface_decision_precedente`.
- [x] 288 tests Rust / 461 tests TypeScript / tsc clean.

### Criteres de validation (manuel)
- Dans un dossier contenant beaucoup d'archives (50+), cliquer Analyser en mode Images avec "Analyser les archives" coche : la barre demarre immediatement sur "Lecture des fichiers" puis "Comptage des archives" (pas de "Verification de l'espace disque" prealable).
- Si l'espace dispo est insuffisant : la modale apparait apres la phase counting_archives, par-dessus la barre de progression. Le bouton Annuler du scan reste cliquable derriere la modale ; cliquer ailleurs / le bouton Annuler de la modale annule le scan.
- Cliquer "Continuer sans extraction" reprend le scan immediatement (sans relancer), Phase 2 (pHash dans archives) est sautee, le compteur de progression rattrape via le sync final.
- Mode Files (pas d'extraction) : pas de modale meme avec "Analyser les archives" coche.
- Mode Videos : "Analyser les archives" est ignore (gating frontend), pas d'iteration des archives en backend.

---

## Phase 32 : verification magic bytes des archives (anti-blocage `.cbz` menteur) ✅

**Objectif** : eviter qu'un fichier dont l'extension annonce un format d'archive supporte (typiquement `.cbz`) mais dont le contenu est en realite d'un autre format (typiquement RAR) ne fasse bloquer ou ralentir massivement la phase `counting_archives`. Le crate `zip` scanne le fichier a la recherche de la signature EOCD inexistante, et certains autres decoders peuvent boucler ou prendre plusieurs minutes par fichier.

### Backend ✅
- [x] `archive::verify_archive_magic(path, &format) -> bool` : lit les premiers octets et confronte aux magic bytes du format detecte par extension. Magic numbers couverts : ZIP (`50 4B 03 04` / `05 06` / `07 08`), 7z (`37 7A BC AF 27 1C`), gzip (`1F 8B`), bzip2 (`42 5A 68`), xz (`FD 37 7A 58 5A 00`), zstd (`28 B5 2F FD`), tar (signature `ustar` a l'offset 257). Erreur d'I/O -> retourne true (on laisse passer, le decoder echouera proprement). Fichier trop court pour contenir le magic -> retourne false (structurellement invalide).
- [x] `archive::detect_archive_format_verified(path) -> Option<ArchiveFormat>` : combinaison extension + magic. Wrapper utilise aux deux entry points qui filtrent la liste des archives (`scanner/mod.rs` boucle counting_archives, `scanner/archive_phase.rs` filtre archives). Les fichiers "menteurs" sont silencieusement exclus de la phase archives mais restent dans la dedup classique par hash.

### Tests ✅
- [x] Tests Rust : 13 nouveaux tests `archive::tests::verify_magic_*` couvrant ZIP valide accepte, `.cbz` contenant des octets RAR rejete, `.cbz` ZIP valide accepte par la version verified, fichier tres court rejete, 7z valide, 7z avec octets ZIP rejete, tar.gz / tar.bz2 / tar.xz / tar.zst valides, tar.gz mauvais magic rejete, tar avec signature ustar accepte, tar sans signature rejete.
- [x] 301 tests Rust / 462 tests TypeScript / tsc clean.

### Criteres de validation (manuel)
- Un fichier `.cbz` qui contient en realite du RAR (renomme manuellement, ou produit par un outil bugue) ne fait plus bloquer la phase `counting_archives`. Il est exclu de la phase archives mais reste presence dans le scan general (dedup exacte sur le fichier).
- Cout ajoute imperceptible : 1 ouverture + 6 octets lus par archive, fait une seule fois dans le filtre amont (avant la double iteration count_entries_fast + count_and_estimate_*).

---

## Phase 33 : refactor cache ignore-list + GIF animes + titre OS ✅

Lot de petites ameliorations post-1.1.1, chacune avec son propre changement focus mais regroupees dans la meme phase de doc parce qu'elles ne sont pas suffisamment grosses pour justifier des sections separees.

### A. Cache et liste d'ignores independants ✅

- [x] `LoadedSession.groups` + `LoadedSession.summary` stockent desormais la liste BRUTE non filtree.
- [x] Filtre dynamique a chaque lecture via les helpers `commands/session.rs::current_ignored_keys` (recharge `ignore_list.json` du disque a chaque appel) + `commands/session.rs::filtered_view` (filtre + recalcul de `total_groups` / `total_wasted_bytes`).
- [x] Commandes affectees : `load_session` (fast-path inclus), `get_groups_page`, `get_folder_groups_page`, `list_folder_keys`, `select_all_duplicates`, `smart_select`.
- [x] `ignore_group` et `clear_ignore_entry` ne touchent plus du tout au cache.
- [x] Test sentinelle : `filtered_view_invariant_cache_brut_apres_retrait_ignore` simule "ignorer un groupe puis le de-ignorer sans toucher au cache" et verifie que le groupe revient.
- [x] Effet : retirer un groupe de la liste d'ignores le fait reapparaitre immediatement a la prochaine pagination, plus besoin de recharger la session.

### B. GIF animes dans le comparateur d'images ✅

- [x] Nouvelle commande Rust `commands/files.rs::get_image_url(path, max_size) -> String` : pour les `.gif` (extension + magic bytes `GIF87a` / `GIF89a`), retourne une URL du media server local (`http://127.0.0.1:port/...`) qui sert le fichier original. Pour les autres formats, retourne une data URL JPEG redimensionnee (pipeline `get_image_thumbnail` existant).
- [x] MIME `image/gif` ajoute a `video/media_server.rs::video_mime`.
- [x] Frontend `ImageComparator.tsx` appelle `get_image_url` au lieu de `get_image_thumbnail`. Le `<img>` HTML5 anime nativement les GIF servis avec MIME `image/gif`.
- [x] 7 tests Rust `is_animated_gif_*` couvrant la matrice extension x magic.
- [x] 1 test TS `ImageComparator` section F qui verifie qu'un `.gif` retourne bien une URL media server vs data URL JPEG sinon.
- [x] Article d'aide "Modes cote a cote et superposition" mis a jour FR+EN avec la mention des GIF animes.

### C. Pourcentage de scan dans le titre de fenetre OS ✅

- [x] `App.tsx` useEffect sur `scanExec.scanning` + `scanExec.progress` : appelle `getCurrentWindow().setTitle("XX % - Deduplicateur")` pendant les phases avec barre (total > 0) et `setTitle("Deduplicateur")` quand pas de scan ou en phase preliminaire (total = 0, afficher 0 % serait trompeur).
- [x] Permission `core:window:allow-set-title` ajoutee a `src-tauri/capabilities/default.json`.
- [x] Piege documente dans AGENTS.md : `document.title` ne se propage PAS au titre OS sous WebView2 (Windows) ni WebKitGTK (Linux). L'API native Tauri est obligatoire.
- [x] Try/catch silencieux dans le useEffect pour ne pas casser les tests jsdom ou les builds sans Tauri.

### D. Elargissement des boutons compare / ignore ✅

- [x] `App.css::.group-header` : padding vertical reduit a 3px (vs 10px avant).
- [x] `.btn-compare` et `.btn-ignore` utilisent `align-self: stretch` + `display: inline-flex; align-items: center` (pour le X centre verticalement) : ils remplissent quasi toute la hauteur de la ligne du groupe.
- [x] Effet : zone "misclick qui collapse le groupe" reduite a une bande de 3px en haut et en bas (vs ~7px avant) et la ligne du groupe est plus compacte d'environ 14px.

### Tests ✅
- [x] 309 tests Rust / 463 tests TypeScript / tsc clean.

---

## Correctifs post-1.2.0

### Compteur de dossiers fige pendant le traitement (mode by_folder) ✅

**Bug** : en mode "par sous-dossiers", supprimer ou ignorer le dernier groupe d'un dossier le retirait bien de la liste affichee mais `summary.total_folders` n'etait jamais decremente. Le compteur "X dossiers" reste fige sur sa valeur d'origine pendant tout le traitement. Symetriquement, dans `commands/session.rs::filtered_view` cote backend, `total_groups` et `total_wasted_bytes` etaient recalcules apres filtrage par les ignores, mais pas `total_folders` : un `load_session` ne refletait pas la verite filtree.

- [x] Backend [src-tauri/src/commands/session.rs::filtered_view](../src-tauri/src/commands/session.rs) recalcule aussi `total_folders` quand `by_folder=true`, par HashSet des `folder_key` distincts dans les groupes filtres.
- [x] Frontend [src/App.tsx::handleIgnoreGroup](../src/App.tsx) et `handleDeleteComplete` calculent un `foldersLost` (nombre de dossiers passant a 0 groupes) et le soustraient de `total_folders` dans le `setSummary`. Parite optimiste avec `total_groups`.
- [x] Frontend nouvelle fonction `refreshAfterIgnoreChange` appelee apres `clear_ignore_entry` / `clear_all_ignored` : re-invoque `load_session` (qui retourne un summary frais grace au fix backend) + `list_folder_keys` + reset des groupes locaux et `folderState` pour que les groupes precedemment ignores reapparaissent au prochain depliage.
- [x] 2 nouveaux tests Rust : `filtered_view_recalcule_total_folders_en_mode_by_folder` (3 groupes / 3 dossiers, ignorer 1 -> 2 dossiers) et `filtered_view_ne_touche_pas_total_folders_hors_mode_by_folder` (preserve `total_folders=0` quand `by_folder=false`).
- [x] 1 nouveau test TS `Bug 4 - by_folder : ignorer le seul groupe d'un dossier decremente total_folders` + assertion ajoutee au Bug 1 existant.
- [x] 314 tests Rust / 466 tests TypeScript / tsc clean.

### Filtre texte applique aux selections automatiques ✅

**Bug** : un filtre texte saisi dans la barre de recherche restreignait l'affichage mais pas la portee des commandes backend `select_all_duplicates` / `smart_select`. Cliquer "Tout cocher" ou "Appliquer (garder la plus haute resolution)" apres avoir filtre "vacances" cochait des fichiers dans TOUS les groupes du scan, pas seulement les visibles - comportement contre-intuitif.

- [x] Backend [src-tauri/src/commands/session.rs](../src-tauri/src/commands/session.rs) : helper `apply_text_filter(groups, by_folder, filter_text)` qui filtre les groupes selon le meme critere que le frontend - par `folder_key` en mode `by_folder`, par `file.name` / `file.path` sinon. Trim et casse insensible. Vide / `None` -> passthrough.
- [x] Commandes `select_all_duplicates` et `smart_select` acceptent un nouveau parametre `filter_text: Option<String>` et appliquent le filtre apres `filtered_view`.
- [x] Frontend [src/hooks/useSelectionState.ts](../src/hooks/useSelectionState.ts) : `selectAllDuplicates(filterText?)` et `selectSmart(mode, folderPrefix?, filterText?)` passent le `filterText` a l'invoke (null si vide ou absent).
- [x] [src/App.tsx](../src/App.tsx) : les deux call sites (bouton "Tout cocher" + Ctrl+A + bouton "Appliquer") transmettent le state `filterText` courant.
- [x] [src/App.tsx](../src/App.tsx) : champ "Filtrer" deplace AU-DESSUS de la `ScanResultsToolbar` (au lieu d'en dessous), pour que le flow utilisateur reflete l'ordre logique des operations : filtrer -> choisir une regle de selection -> appliquer.
- [x] 3 nouveaux tests Rust : `apply_text_filter_vide_renvoie_tous_les_groupes`, `apply_text_filter_mode_normal_filtre_par_nom_et_path`, `apply_text_filter_mode_by_folder_filtre_par_folder_key`.
- [x] 2 nouveaux tests TS dans `App.test.tsx` section M : `Appliquer avec un filtre actif transmet filterText au backend (smart_select)` et `Tout cocher avec un filtre actif transmet filterText au backend (select_all_duplicates)`. Mise a jour des 3 tests existants qui asseraient l'absence de `filterText` dans le payload.
- [x] Articles d'aide `filter-sort`, `manual-select` et `smart-rules` mis a jour FR+EN pour mentionner cette synergie.
- [x] 317 tests Rust / 468 tests TypeScript / tsc clean.

### Badge "Original" deconnecte du tri local ✅

**Bug** : le badge "Original" etait attache a `idx === 0` de `sortedFiles` (la ligne du haut affichee), donc il se deplacait quand l'utilisateur changeait le tri local des colonnes. Conceptuellement, "Original" doit toujours designer le fichier le plus ancien du groupe (la convention documentee dans l'aide), quel que soit l'ordre d'affichage.

- [x] [src/components/GroupCard.tsx](../src/components/GroupCard.tsx) : `originalPath` calcule via `useMemo` comme le path du fichier au `modified` minimum dans `group.files`. Le rendu du badge teste maintenant `file.path === originalPath` (au lieu de `idx === 0`). Calcul cote frontend pour ne pas dependre de l'invariant cache "files[0] est le plus ancien" maintenu par `sort_files_by_origin` cote backend - meme si l'invariant tient, le code est plus robuste a un changement d'ordre futur.
- [x] 3 nouveaux tests TS dans `GroupCard.test.tsx` section "Badge original - independant du tri local" : badge sur le bon fichier sans tri (meme si files[0] dans le fixture n'est pas le plus ancien), badge stable apres tri par Nom asc, badge stable apres tri par Modifie desc.
- [x] 317 tests Rust / 471 tests TypeScript / tsc clean.

### Zoom + pan synchronises dans le comparateur de videos ✅ (1.2.2)

**Feature** : etendre le zoom + pan synchronise (deja present sur le comparateur d'images depuis ce meme cycle de release) au comparateur de videos. Meme molette pour zoomer centre sur le curseur, meme drag pour panner, meme sync visuel entre les deux panneaux, meme reset au close+reopen.

- [x] [src/hooks/useZoomPan.ts](../src/hooks/useZoomPan.ts) (nouveau) : hook reutilisable qui sort la logique de zoom/pan du `ImageComparator`. Encapsule le state (`zoom`, `pan`, `dragging`), les constantes (`ZOOM_MIN=1`, `ZOOM_MAX=10`, `ZOOM_FACTOR=1.2`, `DRAG_THRESHOLD_PX=3`), les handlers (`handleWheel`, `handleMouseDown`), le `useEffect` global du drag (mousemove/mouseup), et expose `transform`, `cursor`, et `wasDragged()` (pour distinguer un clic d'un drag-suivi-de-relachement).
- [x] [src/ImageComparator.tsx](../src/ImageComparator.tsx) : refactor pour utiliser `useZoomPan`. Suppression de ~50 lignes de logique inline, comportement strictement equivalent (29 tests passent inchanges).
- [x] [src/VideoComparator.tsx](../src/VideoComparator.tsx) : integration `useZoomPan`. `transform` + `cursor` + `onWheel` + `onMouseDown` passes aux deux `VideoPanel` (mode cote-a-cote uniquement, pas de mode overlay video). `transform-origin: 0 0` applique au `<video>`.
- [x] Compromis documente : a zoom > 1, le mousedown intercepte les controls natifs du `<video>` master (play/pause au clic, scrub bar). Dezoomer (molette inversee) restitue l'acces.
- [x] 5 nouveaux tests TS dans `VideoComparator.test.tsx` section G : zoom monte cote gauche, sync depuis cote droit, clamp a 1, cursor `zoom-in` a idle, cursor `grab` apres zoom.
- [x] Article d'aide `video-comparator-sync` mis a jour FR+EN.
- [x] 321 tests Rust / 487 tests TypeScript / tsc clean.

### Images servies en resolution native pour le comparateur ✅ (1.2.2)

**Feature** : le comparateur d'images affichait jusque la une miniature JPEG 800px (data URL) pour tous les formats sauf les `.gif`. Resultat : des qu'on zoomait au-dela d'environ 1x sur une image plus grande que 800px, on voyait des pixels du redimensionnement -> impossible de comparer les details au pixel pres, ce qui est pourtant la raison d'etre du comparateur dans un dedup d'images.

- [x] [src-tauri/src/commands/files.rs::get_image_url](../src-tauri/src/commands/files.rs) : nouvelle helper `is_browser_native_image(path)` qui retourne `true` pour les extensions decodees nativement par `<img>` HTML5 (PNG, JPG/JPEG/JFIF, WEBP, AVIF, BMP, SVG, ICO, et GIF avec verification magic bytes). Pour ces formats, on sert le fichier d'origine via le media server local (URL `http://127.0.0.1:port/...`). Pour les autres (TIFF, HEIC, RAW...), on conserve le pipeline thumbnail JPEG 800px en fallback (le navigateur ne sait pas les decoder de toute facon).
- [x] [src-tauri/src/video/media_server.rs::video_mime](../src-tauri/src/video/media_server.rs) : etendu pour servir les bons MIME types image (`image/png`, `image/jpeg`, `image/webp`, `image/avif`, `image/bmp`, `image/svg+xml`, `image/x-icon`) en plus du `image/gif` deja present.
- [x] 4 nouveaux tests Rust dans `commands::files::tests` : `is_browser_native_image_accepte_formats_courants`, `is_browser_native_image_accepte_majuscules`, `is_browser_native_image_rejette_formats_non_decodes`, `is_browser_native_image_gif_passe_par_magic_check`.
- [x] 321 tests Rust / 482 tests TypeScript / tsc clean.

### Zoom + pan synchronises dans le comparateur d'images ✅ (1.2.2)

**Feature** : permettre a l'utilisateur de zoomer dans les images du comparateur via la molette de la souris, avec le zoom synchronise entre les deux images affichees. Drag a la souris pour deplacer la vue quand zoom > 1. Reset automatique au close+reopen du comparateur.

- [x] [src/ImageComparator.tsx](../src/ImageComparator.tsx) : state `zoom` (1..10, factor x1.2 par tic), `pan` (en pixels), `dragging` ; `handleWheel` calcule `newPan = cursor - (cursor - prevPan) * (newZoom / prevZoom)` pour que le point image sous le curseur reste sous le curseur apres zoom ; `handleMouseDown` + `useEffect` global pour mousemove/mouseup -> drag synchronise.
- [x] Style CSS `transform: translate(panX, panY) scale(zoom)` + `transformOrigin: 0 0` applique aux deux `<img>` (mode cote-a-cote ET mode overlay -> meme state, sync visuelle gratuite car les conteneurs ont la meme taille). Cursor `grab` / `grabbing` quand `zoom > 1`.
- [x] Detection drag vs clic via `draggedRef.current` (passe a `true` si la souris a bouge de plus de 3 px depuis le mousedown) : le clic ouvre le fichier dans le viewer externe uniquement si pas de drag detecte.
- [x] `e.stopPropagation()` ajoute sur le mousedown du slider du mode overlay pour ne pas declencher le drag-pan en meme temps que le drag du slider.
- [x] Pan reset a (0, 0) quand zoom revient a `ZOOM_MIN`, sinon position cumulee preservee. State entier reset au unmount du composant (close+reopen).
- [x] 5 nouveaux tests TS dans `ImageComparator.test.tsx` section G : zoom monte (scroll up), zoom clamp a 1 (scroll down repete), sync entre les deux `<img>` (scroll cote droit zoome aussi le gauche), clic a zoom=1 ouvre le fichier.
- [x] Article d'aide `comparator-modes` mis a jour FR+EN avec la section "Zoom et deplacement".
- [x] 317 tests Rust / 478 tests TypeScript / tsc clean.

### Synchronisation des GIF animes dans le comparateur (Windows / WebView2) ✅ (1.2.2)

**Bug residuel apres 1.2.1** : la cle React partagee sur les deux `<img>` resynchronisait bien les GIF sous WebKitGTK (Linux) mais PAS sous WebView2 (Windows). WebView2 conserve le decodage GIF en cache (par URL) et reprend l'animation depuis sa position en cours, meme apres remount du `<img>` avec la meme src. Seul le cote dont la `src` change reellement redemarre, l'autre continue son animation.

Cinq iterations ont ete necessaires pour cerner le comportement reel :
1. **Tentative 1 (1.2.1)** : `key` React partagee sur les deux `<img>` pour forcer demount+remount React. Suffisant sous WebKitGTK mais WebView2 conserve l'element DOM en l'absence de changement de src.
2. **Tentative 2** : reset `null` des deux thumbs + `Promise.all` + setState batches. Insuffisant : WebView2 garde le decodage GIF en cache memoire par URL exacte -> meme load -> meme animation en cours.
3. **Tentative 3** : fragment URL `#_remount=N`. Insuffisant : les browsers strippent le fragment avant la lookup cache (comportement HTTP standard).
4. **Tentative 4** : query param `?_remount=N` (vraie partie de la cle de cache). Insuffisant tout de meme : "pas meme un clignotement" - React 18 coalesce les renders entre null et nouvelle URL, le browser saute le paint intermediaire, les `<img>` ne sont jamais visuellement retires.
5. **Tentative 5 (qui marche)** : reset null + double `requestAnimationFrame` + Promise.all + query param `?_remount=N`. Le double rAF garantit qu'au moins un paint complet a lieu avec les `<img>` absents avant qu'on remette les URLs -> WebView2 voit un vrai cycle demount/remount + URL distincte -> nouveau decodage -> frame 0.

- [x] [src/ImageComparator.tsx](../src/ImageComparator.tsx) : `useEffect` unique dependant des deux indices, `useRef` pour memoriser les paths au precedent render (detecter lequel a change), `gifTickRef` pour le compteur de remount. Si le groupe contient au moins un fichier `.gif` -> increment gifTick, reset les deux thumbs a null, Promise.all des deux fetch, double `requestAnimationFrame`, puis append `?_remount=${tick}` (query, pour les URLs HTTP) ou `#_remount=${tick}` (fragment, fallback pour data URLs) aux deux URLs avant de les set. Sinon (pas de GIF) -> on ne refetch que le cote qui a vraiment change, preservant l'UX des images statiques (pas de clignotement parasite).
- [x] Suppression du prop `imgKey` d'`ImagePanel` et de la `key` partagee sur les `<img>` en mode overlay : devenus inutiles avec le pattern reset + double rAF + query.
- [x] 4 tests TS dans `ImageComparator.test.tsx` section F : changer un onglet refetch les deux urls (tentative 2), un query `?_remount=N` est ajoute et s'incremente (tentative 5), pas de query quand le groupe n'a pas de GIF, et le cas non-GIF ne refetch que le cote modifie.
- [x] AGENTS.md : section "Synchronisation de deux GIF animes" documente les cinq tentatives et pourquoi seule la cinquieme marche sous WebView2.
- [x] 317 tests Rust / 480 tests TypeScript / tsc clean.

### Synchronisation des GIF animes dans le comparateur d'images ✅

**Bug** : dans un groupe a 3+ fichiers contenant des GIF animes, changer le fichier compare d'un cote via les onglets faisait redemarrer ce cote a la frame 0 mais l'autre cote continuait son animation en cours. Resultat : les deux GIF jouaient a des positions differentes, desynchronises. Specifique aux GIF parce que `<img>` HTML5 n'expose aucune API JS pour controler la position d'animation - la seule facon de re-synchroniser est de demonter / remonter les deux <img> ensemble.

- [x] [src/ImageComparator.tsx](../src/ImageComparator.tsx) : calcul d'un `remountKey` derivé de `groupIdx + effectiveLeftIdx + effectiveRightIdx`. Cette cle est passee aux deux `<img>` (mode normal via le nouveau prop `imgKey` d'`ImagePanel`, mode overlay directement). Quand l'utilisateur change un onglet, la cle change pour les DEUX `<img>` -> React demonte et remonte les deux simultanement -> les GIF redemarrent ensemble. Pour les images statiques le remount est invisible (data URL en cache memoire).
- [x] 1 nouveau test TS `ImageComparator.test.tsx::F::changer l'onglet droit remonte aussi l'img gauche` : recupere les noeuds DOM des deux `<img>` avant + apres clic sur un onglet, verifie que les DEUX references DOM ont change (et pas seulement celle qui a vu son fichier changer).
- [x] 317 tests Rust / 472 tests TypeScript / tsc clean.

### Menu Maintenance - purge long terme ✅

**Feature** : un menu d'entretien (drawer 🔧 dans la barre d'outils) pour gerer l'accumulation long terme. Au fil du temps, le cache de detection, la liste des ignores et les analyses enregistrees peuvent referencer des fichiers qui n'existent plus, occupant de l'espace et ralentissant le chargement. Trois blocs du moins au plus destructeur : espace occupe (lecture seule), purge ciblee des references obsoletes (caches + ignores), liste des analyses avec suppression groupee, et vidage complet du cache (ancien `purge_cache` deplace depuis le SessionPicker).

**Garde-fou central** : une reference n'est purgee que si son fichier a disparu ET que son volume est joignable. Un disque externe / NAS debranche est preserve (rien retire tant qu'il n'est pas rebranche) - evite de re-hasher tout un disque par erreur. Cf. la nouvelle regle AGENTS.md "fichier absent != fichier supprime".

- [x] [src-tauri/src/maintenance.rs](../src-tauri/src/maintenance.rs) : module pur. `is_volume_reachable` (detection mount points par OS : prefixe disque/UNC sous Windows, `/media|/run/media|/mnt|/Volumes` sous Unix), `is_purgeable` (fichier absent + volume joignable), `ignore_key_is_stale` (cle d'ignore devenue impossible a re-matcher), helpers `retain_existing` / `count_purgeable` partages par les caches.
- [x] `prune_missing` + `count_missing` ajoutes aux 4 caches (`HashCache`, `VideoCache`, `AudioCache`, `ExactCache`), delegant a `maintenance` (source unique de la logique volume).
- [x] [src-tauri/src/commands/maintenance.rs](../src-tauri/src/commands/maintenance.rs) : commandes `get_maintenance_report` (espace + compteurs obsoletes + liste des sessions avec flag `folder_missing`), `purge_stale_caches`, `purge_stale_ignored`. Suppression de sessions via `delete_session` existant (boucle frontend).
- [x] [src/components/MaintenancePanel.tsx](../src/components/MaintenancePanel.tsx) : drawer SideDrawer, aides de selection (tout cocher / dossiers introuvables / plus de N jours), confirmations inline pour la suppression de sessions et le vidage complet.
- [x] Section cache retiree du `SessionPicker` (props `cacheBytes`/`purgeConfirm`/`onPurge` supprimees, `handlePurgeCache` + state `purgeConfirm` retires d'App.tsx) - tout est dans le menu Maintenance.
- [x] Article d'aide bilingue `maintenance` (nouvelle section) ; article `sessions` mis a jour (cache -> Maintenance).
- [x] 13 nouveaux tests Rust (`maintenance::tests` + `commands::maintenance::tests`), 10 tests TS `MaintenancePanel.test.tsx`, tests `SessionPicker`/`App` mis a jour.
- [x] 345 tests Rust / 519 tests TypeScript / tsc clean.
