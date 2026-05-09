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

#### C1. Backend : extraction + fingerprint + cache + progression ✅⏳

**C1.1 Helper `is_audio_path`** dans `scanner::hash` (ou autre module commun) :
- [ ] Liste d'extensions : `mp3`, `wav`, `flac`, `ogg`, `m4a`, `opus`, `aac`, `wma`, `aiff`, `ape`. Cohérent avec ce que `is_audio` (collect_files) reconnaît déjà.
- [ ] Test : extensions reconnues vs ignorées.

**C1.2 Comptage** :
- [ ] `count_archive_audio_entries(path)` symétrique à `count_archive_image_entries`. ZIP/7z exact via headers, tar.* via itération du stream (cohérent avec la règle de comptage exact, pas d'heuristique).
- [ ] Tests : count exact pour zip/7z/tar (toutes les variantes de compression).

**C1.3 Extraction temp dir** (`archive/extractor.rs`) :
- [ ] Soit étendre `extract_image_entries` avec un paramètre `EntryFilter` (closure `|name: &str| -> bool`), soit ajouter `extract_audio_entries`. Préférence : paramétriser pour DRY.
- [ ] `estimate_extraction_size` étendu : calcule la taille des entrées audio aussi quand `find_similar_audio=true`. La modale d'avertissement existante reste, son texte devient générique ("entrées média" ou paramétré selon le mode).
- [ ] Tests : extraction des audio uniquement, taille estimée.

**C1.4 Phase audio archives** (`scanner/archive_phase.rs`) :
- [ ] Nouvelle Phase 3 (après les Phase 1 xxh3 et Phase 2 pHash images) qui s'active si `find_similar_audio=true && !skip_archive_extraction`. Mutex avec Phase 2 : si mode Audio, c'est Phase 3 qui tourne, sinon Phase 2.
- [ ] Extraction des entrées audio non encore matchées en exact (filter sur `duplicated_entries`).
- [ ] fpcalc parallèle via rayon sur les chemins extraits, mêmes optimisations que `audio_phase` standard (subprocess fpcalc avec `creation_flags(0x08000000)` sous Windows).
- [ ] Matching inter-archive : Hamming distance sur fingerprints i32 + tolérance de durée (réutilise les helpers de `audio::hash` ou équivalent).
- [ ] Update `duplicated_entries` et `shared_count_per_pair` pour les paires audio similaires (cohérent avec ce que fait Phase 2 pour les pHash).
- [ ] Persiste fingerprints + durée dans `all_entries` puis dans `entries_cache`.

**C1.5 Cache** (`archive::ArchiveEntryHash`) :
- [ ] Ajouter `audio_fingerprint: Option<Vec<i32>>` et `audio_duration_secs: Option<f64>` (rétro-compat via `#[serde(default)]`).
- [ ] `recompute_group_duplicated_entries` étendue : reconnaît les matches audio (Hamming sur fingerprints + tolérance de durée) en plus des matches xxh3 et pHash.
- [ ] `ensure_cache_for_groups` : pour les sessions pré-cache audio, re-calcule via `hash_archive_entries` avec un nouveau flag pour pousser le calcul fpcalc en plus du pHash. Alternative : laisser ces sessions sans audio, ne ré-hasher que pour les xxh3.

**C1.6 Progression** (`scanner/mod.rs`) :
- [ ] Nouvelle constante `EMITS_ARCH_AUDIO = 2` (extraction + fpcalc, matching silencieux). Documenter dans le tableau des constantes.
- [ ] Nouveau phase id `archives_audio` dans `ScanPhase` (Rust + TS).
- [ ] `total_work` étendu : `+ archive_phase_audio_count * EMITS_ARCH_AUDIO` quand `find_similar_audio && scan_archives && !skip_archive_extraction`.
- [ ] `sync_to(budget_after_archives_audio)` après la phase. Le sync final reste `sync_to(total_work)`.
- [ ] Test d'invariant `progression_atteint_total_avec_archives_audio` (pendant à `progression_atteint_total_avec_archives`).

**C1.7 ScanParams + commande `scan_folder`** :
- [ ] Renommer `skip_archive_phash` → `skip_archive_extraction` côté Rust et TS. Le frontend met à jour le payload de la commande.
- [ ] La modale d'espace disque conserve son trigger mais avec le bon texte selon le mode.

**C1.8 Tests Rust** :
- [ ] `archive_phase::tests::deux_zips_avec_audio_similaire_donnent_groupe` : 2 archives contenant un fichier audio (synthétique, fingerprint identique) → groupe matché.
- [ ] `audio_archives_count_dans_duplicated_entries` : recompute_group_duplicated_entries inclut bien les paires audio.
- [ ] Tests de `count_archive_audio_entries` pour ZIP/7z/tar.

#### C2. Frontend : comparateur d'archives avec lecteur audio ⏳

**C2.1 Détection des entrées audio** :
- [ ] Côté frontend, helper `isAudioPath(path)` dans le composant ou dans `utils.ts`. Symétrique à `isImagePath` qu'on a déjà dans `FileThumbnail.tsx`.

**C2.2 Composant `ArchiveEntryAudioPlayer`** (nouveau) :
- [ ] Bouton play / pause minimal (icônes, pas de barre de scrubbing pour rester compact dans une ligne du comparateur).
- [ ] À l'activation : invoke `get_archive_entry_url(archivePath, internalPath)` qui retourne une URL `http://127.0.0.1:<port>/<temp_path>`.
- [ ] Lecture via `<audio src={url}>` standard, géré par WebKit. Stop au démontage du composant.
- [ ] Spinner overlay pendant l'extraction (pattern identique au clic miniature image).
- [ ] Style aligné sur la cellule miniature image (taille 32px, position centrale).

**C2.3 Backend `get_archive_entry_url`** (`commands/files.rs`) :
- [ ] Extrait l'entrée vers `app_data/archive_preview/<id>_<filename>` (réutilise le sous-dossier déjà purgé au boot).
- [ ] Retourne `http://127.0.0.1:<media_server_port>/<absolute_path_url_encoded>`. Le media server existant (axum, `media_server.rs`) sert déjà les fichiers du disque par chemin absolu.
- [ ] Garde la même logique de cleanup que `open_archive_entry` (purge au boot, fichiers persistent durant la session).

**C2.4 ArchiveComparator étendu** :
- [ ] `EntryCell` : pour les entrées audio, remplacer la miniature image par `ArchiveEntryAudioPlayer`. Pour les non-images non-audio, garder `FileTypeIcon`.
- [ ] `ScoreCell` : afficher le score audio comme "97% audio" (ou avec icône note de musique) pour différencier du score pHash. À voir avec le design.
- [ ] Affichage durée de l'entrée audio à côté de la taille (ex. "3:42 · 5.2 Mo"), récupéré depuis `audio_duration_secs` du cache.

**C2.5 Tests TS** :
- [ ] `ArchiveComparator.test.tsx` : entrée audio montre le bouton play, pas de miniature image.
- [ ] Mock de `get_archive_entry_url` qui renvoie une URL factice, vérifier que `<audio src>` est bien set.
- [ ] Score audio rendu correctement.

#### C3. Pré-check espace disque + modale ⏳

**C3.1 Estimation étendue** :
- [ ] `estimate_extraction_size(archive_paths, mode)` paramétré : si `mode = Image`, estime la taille des entrées image ; si `mode = Audio`, des entrées audio. Le frontend passe le mode courant.
- [ ] `check_archive_disk_space` paramétré pareil.

**C3.2 Modale d'avertissement** (`DiskSpaceWarningModal`) :
- [ ] Texte adapté selon le mode : "images archivées" en mode Image, "sons archivés" en mode Audio.
- [ ] Le bouton "Continuer sans analyser" set `skip_archive_extraction=true`. Sémantique unifiée.
- [ ] Tests : modale avec mode Image vs Audio affiche le bon texte.

**C3.3 Pre-check côté App.tsx** :
- [ ] Le pre-check ne déclenche que si `find_similar=true OR find_similar_audio=true` (en plus de `scan_archives=true`). Actuellement c'est `find_similar`, à étendre.

#### C4. Documentation + cleanup ⏳

- [ ] `src/help/content.ts` : article "archive-scan" mis à jour FR + EN pour mentionner le mode Audio (extraction + fingerprint, lecteur play dans le comparateur).
- [ ] `README.md` : section Fonctionnalités du scan d'archives mentionne le mode Audio.
- [ ] `AGENTS.md` : si une nouvelle constante `EMITS_*` est ajoutée, l'inclure dans le tableau de la règle de progression.
- [ ] Mise à jour des counts de tests dans README et plan (cargo + vitest).
- [ ] Rename `skip_archive_phash` partout (Rust, TS, tests, sessions persistées si jamais).

**Découpage en livrables** : C1 d'abord (backend complet, testable seul via `cargo test`), puis C2 + C3 ensemble (frontend cohérent), puis C4 (cleanup + doc).

---

### Phase 27D - Mode Vidéo (différé)

**Note** : les entrées vidéo dans les archives nécessitent une extraction obligatoire en temp file (ffmpeg/ffprobe travaillent sur des chemins disque). Le gain pratique est faible (les vidéos sont rarement archivées). À traiter séparément si le besoin se confirme.

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
