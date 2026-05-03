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

## Phase 16 - Notifications système

**Objectif : prévenir l'utilisateur quand un scan long se termine, même si l'app est en arrière-plan**

- [ ] Ajouter le plugin `tauri-plugin-notification` dans `Cargo.toml` et `package.json`
- [ ] Déclarer `notification:default` dans `capabilities/default.json`
- [ ] Rust / `lib.rs` : émettre une notification OS en fin de scan (titre + résumé : N groupes, X Mo récupérables)
- [ ] Notification uniquement si le scan a duré plus de N secondes (seuil configurable, défaut 10s) - pas de notification pour les scans rapides
- [ ] Windows : notification native via le centre de notifications
- [ ] macOS : notification native via NSUserNotificationCenter / UNUserNotificationCenter
- [ ] Linux : notification via libnotify (org.freedesktop.Notifications)
- [ ] Tests Rust : vérifier que la notification est déclenchée avec le bon contenu (mock du plugin)

**Critère de validation : lancer un scan de 50 000 fichiers, basculer sur une autre fenêtre, voir la notification apparaitre en fin de scan**

---

## Phase 17 - Comparateur vidéo

**Objectif : comparer deux vidéos côte à côte avec lecture synchronisée avant de choisir laquelle supprimer**

- [ ] `VideoComparator.tsx` : composant plein écran, même structure que `ImageComparator.tsx`
- [ ] Deux lecteurs `<video>` natifs côte à côte, synchronisation play/pause/seek via événements cross-ref
- [ ] Barre de scrubbing commune : déplacer le slider avance les deux vidéos au même timestamp
- [ ] Affichage des métadonnées par fichier : résolution, durée, codec (via `get_video_metadata`), taille
- [ ] Bouton "Garder celui-ci" (gauche / droite) - même pattern que `ImageComparator`
- [ ] Navigation clavier entre groupes (mêmes raccourcis que le comparateur images)
- [ ] Bouton d'accès au comparateur sur les `GroupCard` vidéo (déjà présent pour les images)
- [ ] Tests TypeScript : rendu, synchronisation play/pause, bouton "Garder", navigation clavier

**Critère de validation : ouvrir deux vidéos similaires, appuyer play, les deux démarrent en même temps ; scrubber à 30s sur l'une, l'autre saute aussi à 30s**

---

## Phase 18 - Scan multi-dossiers et mode "comparer avec dossier X"

**Objectif : détecter les doublons entre un dossier source et un dossier de référence, sans signaler les doublons internes**

Deux sous-modes :

**Sous-mode A : scan de plusieurs dossiers en parallèle** - plusieurs racines scannées ensemble, doublons croisés détectés (les doublons internes à chaque racine sont aussi signalés).

**Sous-mode B : "comparer avec le dossier X"** - dossier source S et dossier de référence R. Seuls les fichiers présents dans les deux dossiers sont signalés. Un doublon interne à S ou interne à R n'apparait pas - seulement les fichiers de S qui ont un jumeau dans R (et vice versa).

- [ ] `ScanParams` : champ `secondary_folder: Option<String>` pour le sous-mode B ; champ `extra_folders: Vec<String>` pour le sous-mode A
- [ ] `scanner.rs` : mode B - collecte séparée des fichiers S et R, hash en cascade identique, groupement croisé uniquement (exclure les groupes mono-source)
- [ ] `scanner.rs` : mode A - collecte unifiée multi-racines, même pipeline qu'aujourd'hui
- [ ] UI : dans les options de scan, troisième mode à côté de "Tous les fichiers" et "Par sous-dossier" - "Comparer avec un dossier"
- [ ] UI : en mode B, second sélecteur de dossier "Dossier de référence" (même pattern que le sélecteur principal)
- [ ] UI : label distinctif dans les `GroupCard` en mode B indiquant la provenance (S vs R) de chaque fichier
- [ ] Tests Rust : mode B - groupe croisé détecté, groupe interne ignoré, fichier présent dans un seul dossier ignoré
- [ ] Tests TypeScript : rendu du sélecteur secondaire, affichage de la provenance dans GroupCard

**Critère de validation : dossier source = `Photos/`, dossier référence = `Backup/Photos/` - seules les photos présentes dans les deux dossiers sont signalées, pas les photos uniques dans l'un ou l'autre**
