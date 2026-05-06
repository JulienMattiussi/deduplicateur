# Déduplicateur

<img src="src-tauri/icons/128x128.png" alt="Déduplicateur" width="96" />

Outil de détection et suppression de fichiers en double - rapide, local, sans cloud.

![Rust](https://img.shields.io/badge/Rust-1.80+-orange?logo=rust)
![Tauri](https://img.shields.io/badge/Tauri-2-blue?logo=tauri)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)
![License](https://img.shields.io/badge/licence-MIT-green)

---

## Fonctionnalités

- **Détection exacte** - identifie les fichiers identiques bit à bit via un hachage en cascade (taille → hash partiel 4 Ko → hash complet xxhash3)
- **Parallélisme** - hachage multi-cœurs avec Rayon, tient sur 200 000 fichiers
- **Sous-dossiers** - analyse récursive avec exclusion de dossiers configurables (`node_modules`, `.git`, `target`…)
- **Mode par sous-dossier** - compare les doublons uniquement à l'intérieur de chaque premier niveau de sous-dossier, sans mélanger les fichiers de dossiers différents
- **Sessions persistantes** - chaque scan est sauvegardé ; reprendre une analyse après redémarrage sans rescanner
- **Pagination sans freeze** - les résultats sont chargés par tranches de 50, le système ne sature jamais
- **Suppression sûre** - les fichiers sont envoyés dans la corbeille, récupérables
- **Fichiers disparus** - si un fichier a été supprimé entre deux sessions, l'app l'ignore sans planter
- **Similarité images** - détecte les images visuellement identiques même si les résolutions, formats ou compressions diffèrent (gradient hash via `image_hasher`, seuil configurable)
- **Pipeline pHash optimisé** - 5 optimisations configurables (filtre taille, filtre ratio d'aspect, hash 2 passes, cache inter-scans, comparaison parallèle) avec seuils intelligents par nombre d'images
- **Paramètres avancés images** - panneau configurable dans l'UI (taille minimale, tolérance ratio, cache, mode développeur avec log de perf)
- **Thumbnails cliquables** - aperçu des images, vidéos et fichiers audio similaires (bouton play pour l'audio) ; cliquer ouvre le fichier dans l'application par défaut du système
- **Similarité vidéos** - détecte les mêmes vidéos en formats/résolutions différents via ffmpeg (N frames échantillonnées → mean hash 64 bits, seuil configurable)
- **Pipeline vidéo optimisé** - métadonnées en parallèle, cache inter-scans (`video_cache.json`), extraction rayon, filtre de durée configurable, comparaison O(n²) parallèle
- **DTW vidéo** - option alignement temporel (Dynamic Time Warping) pour détecter les vidéos avec intro ou générique court, via une bande de Sakoe-Chiba
- **Paramètres avancés vidéo** - panneau configurable dans l'UI (frames par vidéo, tolérance de durée, cache, DTW)
- **Affichage adapté par type** - les groupes images et vidéos affichent miniatures, taille par fichier et durée ; label et icône adaptés (fichiers / images / vidéos)
- **Résultats partiels** - si l'analyse est annulée, les groupes déjà trouvés sont affichés avec un bandeau orange "résultats partiels"
- **Interface sombre/claire** - bascule dark/light avec persistance ; UI réactive, barre de progression, statistiques en temps réel
- **Glisser-déposer** - glisser un dossier sur la fenêtre le sélectionne directement (overlay visuel pendant le survol)
- **Raccourcis clavier** - `Del` pour supprimer la sélection, `Ctrl+A` pour tout cocher, `Esc` pour fermer les modales
- **Filtre dans les résultats** - champ texte pour filtrer les groupes par nom de fichier ou chemin, en temps réel
- **Tri des colonnes** - clic sur "Nom", "Modifié" ou "Taille" pour trier les fichiers dans chaque groupe (cycle ↑ ↓ sans tri)
- **Comparateur d'images** - vue plein écran côte à côte pour les groupes d'images similaires : métadonnées complètes (dimensions, format, date EXIF), sélecteur L/R indépendant pour comparer n'importe quelle paire, slider de superposition, navigation entre groupes au clavier, bouton "Garder celui-ci"
- **Scan incrémental** - cache inter-scans des hashes exacts (`exact_cache.json`) : les fichiers non modifiés (mtime + taille inchangés) ne sont pas rehachés, accélère fortement les rescans sur de grands dossiers
- **Filtres** - panneau collapsible dans les options : extensions exclues (défaut : `tmp`, `DS_Store`, `Thumbs.db`...), extensions incluses exclusivement, taille minimale et maximale en Ko
- **Export** - après un scan, boutons "Export CSV" et "Rapport HTML" dans la barre de statistiques ; le CSV liste chaque fichier avec son statut (kept/duplicate) ; le HTML est une page autonome avec stats, groupes cliquables et liens système (`file://`)
- **Profils de scan** - panneau collapsible pour sauvegarder une configuration complète (dossier, mode, type de détection, seuils, filtres) sous un nom ; lancement rapide en un clic (▶) charge et exécute immédiatement le scan
- **Similarité audio** - détecte les mêmes fichiers audio en formats ou qualités différents via fpcalc (chromaprint) : empreinte acoustique sur vecteur d'entiers 32 bits, distance de Hamming normalisée, filtre de durée configurable, cache inter-scans
- **fpcalc bundlé** - fpcalc est téléchargé et inclus dans le bundle de l'application (`scripts/download-fpcalc.sh`) ; l'app le détecte automatiquement sans que l'utilisateur ait à l'installer
- **Recherche élargie des outils** - ffmpeg et fpcalc sont recherchés à côté de l'exécutable (binaire bundlé), dans les chemins système courants (Chocolatey, Scoop, Homebrew, paquets système), puis dans le PATH
- **Bannière d'installation guidée** - si ffmpeg ou fpcalc est absent, l'app affiche un bandeau avec instructions d'installation OS-spécifiques, lien de téléchargement officiel, et bouton "Vérifier à nouveau" pour détecter l'installation sans relancer l'app
- **Règles de sélection par métadonnées** - dropdown dans la barre d'actions pour choisir automatiquement quel fichier garder dans chaque groupe : plus haute résolution (images via en-tête, vidéos via métadonnées), plus grand fichier (audio/vidéo), dossier prioritaire (chemin configurable - si aucun fichier ne s'y trouve, le groupe est laissé sans sélection), plus récent, plus ancien
- **Liste d'ignorés** - bouton "✕" sur chaque groupe pour l'exclure des prochains scans ; panneau dédié sous la barre de filtre pour voir, retirer ou effacer toutes les entrées ignorées ; persisté dans `ignore_list.json`
- **Aide intégrée** - touche F1 ou bouton "?" dans le header ; drawer latéral avec 34 articles bilingues (FR/EN) organisés en 13 sections ; recherche plein texte dans titres, mots-clés et corps des articles
- **Notifications système** - en fin de scan long (>10s), notification OS native (Windows Action Center, macOS, libnotify Linux) avec le nombre de groupes trouvés et l'espace récupérable ; pas de notification pour les scans rapides
- **Comparateur de vidéos** - vue plein écran côte à côte pour les groupes de vidéos : deux lecteurs natifs synchronisés (play/pause/seek), barre de scrubbing commune, métadonnées complètes (résolution, durée, codec, taille), navigation entre groupes au clavier (← →, Échap), bouton "Garder celui-ci"
- **Mode "Comparer avec un autre dossier"** - 3e mode de scan : compare un dossier source S avec un dossier de référence R et ne signale que les fichiers présents dans les deux ; les doublons internes à S ou à R sont ignorés ; les fichiers du dossier de référence affichent un badge "Réf." dans les résultats
- **Sessions toujours visibles** - la section "Mes analyses" est affichée dès le démarrage même sans scan précédent ; le bouton "← Mes analyses" dans la barre d'outils est toujours accessible ; affiche "Aucune analyse enregistrée" quand la liste est vide
- **Sessions mises à jour à la suppression** - quand des fichiers sont supprimés, la session en cours est mise à jour instantanément (groupes réduits à 1 fichier retirés, espace récupérable recalculé) ; au rechargement d'une session ancienne, les fichiers absents du disque sont filtrés automatiquement
- **Gestion du cache de détection** - la section "Mes analyses" affiche la taille totale du cache (phash, vidéo, audio, hashes exacts) et propose un bouton "Purger" avec confirmation inline pour libérer l'espace disque
- **Comparateur audio** - vue plein écran côte à côte pour les groupes de fichiers audio : deux lecteurs natifs synchronisés (play/pause/seek, pattern maître/esclave), métadonnées complètes (nom, dossier, taille, durée), navigation entre groupes au clavier (← →, Échap), bouton "Garder celui-ci"
- **Ouvrir le dossier depuis les comparateurs** - bouton 📂 dans le bloc de métadonnées de chaque panneau (images, vidéos, audio) pour ouvrir directement le dossier du fichier dans le gestionnaire de fichiers
- **Filtre par date de modification** - deux champs date ("Modifié après" / "Modifié avant") dans le panneau Filtres pour restreindre le scan aux fichiers dont la date de modification est dans la plage indiquée ; le compteur de filtres actifs les inclut

---

## Captures d'écran

**Analyse en cours** - barre de progression temps réel avec estimation :

![Scan en cours](docs/screenshots/scan-en-cours.png)

**Résultats images similaires** - groupes avec miniatures, taille récupérable, sélection en un clic :

![Résultats images](docs/screenshots/resultats-images.png)

---

## Architecture

```
src/                       # Frontend React + TypeScript
  App.tsx                  # Composant principal - UI, état, appels Tauri
  App.css                  # Thème sombre/clair (variables CSS + data-theme)
  ImageComparator.tsx      # Comparateur d'images côte à côte / slider superposition
  VideoComparator.tsx      # Comparateur de vidéos côte à côte / lecture synchronisée
  LangContext.tsx          # Contexte i18n FR/EN
  i18n.ts                  # Traductions FR et EN
  types.ts                 # Types TypeScript partagés
  utils.ts                 # formatSize, dirname
  hooks/
    useScanConfig.ts       # Configuration du scan (dossier, mode, seuils)
    useScanExecution.ts    # Lancement / annulation / progression
    useResults.ts          # Chargement paginé des groupes et dossiers
    useSelectionState.ts   # Sélection et suppression

src-tauri/src/
  lib.rs                   # Commandes Tauri : scan_folder, get_groups_page,
                           #   list_sessions, load_session, delete_session,
                           #   delete_files, get_image_thumbnail, get_image_meta
  scanner.rs               # Moteur Rust : collect_files, hash_partial, hash_full,
                           #   filtrage en cascade, parallélisme Rayon, filtres extensions/taille
  exact_cache.rs           # Cache inter-scans des hashes exacts (mtime + taille)
  video_hash.rs            # Hash de frames video (ffmpeg), DTW, mean hash 64 bits
  video_cache.rs           # Cache inter-scans des frame hashes
  video_config.rs          # Configuration du pipeline video (JSON persistant)
  phash_config.rs          # Configuration du pipeline pHash images
  phash_cache.rs           # Cache inter-scans des pHash images
  audio_hash.rs            # Empreinte acoustique via fpcalc, distance Hamming
  audio_cache.rs           # Cache inter-scans des empreintes audio
  audio_config.rs          # Configuration du pipeline audio (JSON persistant)
  tool_finder.rs           # Recherche d'outils (fpcalc, ffmpeg) : binaire bundte, chemins systeme, PATH
  build.rs                 # Placeholder fpcalc vide en dev si download-fpcalc.sh pas encore lancé

src-tauri/binaries/        # Binaires bundlés (non commités - voir scripts/download-fpcalc.sh)
scripts/
  download-fpcalc.sh       # Télécharge fpcalc v1.5.1 pour la plateforme courante

src/components/
  MissingToolBanner.tsx    # Bandeau guidé si ffmpeg/fpcalc absent : instructions OS, téléchargement, re-check
  GroupCard.tsx            # Carte d'un groupe de doublons (fichiers, sélection, tri)
  FileThumbnail.tsx        # Miniature cliquable image/vidéo/audio
  FiltersPanel.tsx         # Panneau filtres extensions et taille
  ProfilesPanel.tsx        # Dropdown profils de scan
  SessionCard.tsx          # Carte session précédente
  AudioAdvancedPanel.tsx   # Paramètres avancés audio
  VideoAdvancedPanel.tsx   # Paramètres avancés vidéo
  AdvancedPanel.tsx        # Paramètres avancés images (pHash)
  AdvancedPanelWrapper.tsx # Wrapper partagé : toggle, reset, body collapsible
```

### Pipeline de déduplication

```
Collecte des fichiers
        │
        ▼
Groupement par taille   ← élimine ~98 % des candidats à coût zéro
        │
        ▼
Hash partiel (4 Ko)     ← élimine les faux positifs de taille
        │
        ▼
Hash complet xxhash3    ← confirmation finale, parallèle (Rayon)
        │
        ▼
pHash images (optionnel) ← gradient hash, 5 filtres, cache inter-scans
        │
        ▼
Hash vidéos (optionnel)  ← N frames ffmpeg, DTW ou distance séquentielle
        │
        ▼
Empreinte audio (optionnel) ← fpcalc, Hamming sur vecteurs i32, cache inter-scans
        │
        ▼
Groupes triés par espace gaspillé
```

### Gestion des sessions

Chaque scan produit un fichier JSON dans `~/.local/share/deduplicateur/sessions/<timestamp>.json`. Au démarrage, l'app liste les sessions disponibles. Les groupes sont chargés 50 par 50 à la demande - jamais tout en mémoire côté JS.

---

## Stack technique

| Couche | Technologie | Rôle |
|--------|-------------|------|
| Backend | Rust + Tauri 2 | Scan, hachage, I/O fichiers |
| Hachage | xxhash3 | Ultra-rapide, non-cryptographique |
| Parallélisme | Rayon | Multi-cœurs transparent |
| Parcours | walkdir | Récursion avec filtrage de dossiers |
| Corbeille | trash | Suppression récupérable cross-platform |
| Similarité images | image_hasher + image | Gradient hash, résolution-agnostique |
| Métadonnées EXIF | kamadak-exif | Lecture date EXIF pour le comparateur d'images |
| Similarité vidéos | ffmpeg/ffprobe (subprocess) | Mean hash sur N frames, DTW, cache inter-scans |
| Frontend | React 18 + TypeScript | UI réactive |
| Bundler | Vite + Tauri CLI | Dev HMR + build natif |
| CI/CD | GitHub Actions | Build Windows automatique sur push |
| Similarité audio | fpcalc/chromaprint (subprocess) | Empreinte acoustique, distance de Hamming sur vecteurs i32, cache inter-scans |
| Tests Rust | cargo test + tempfile | 186 tests unitaires sur le moteur |
| Tests TS | Vitest + jsdom + React Testing Library | 302 tests (utilitaires + i18n + App + ImageComparator + VideoComparator + AudioComparator + MissingToolBanner + FileThumbnail + AdvancedPanelWrapper + IgnoredPanel + FolderSection + HelpPanel + AdvancedPanel + AudioAdvancedPanel + VideoAdvancedPanel + ProfilesPanel + ProgressETA) |

---

## Démarrage

### Télécharger

Les binaires sont produits automatiquement par le CI à chaque push sur `main`.

1. Aller dans l'onglet **Releases** du dépôt GitHub (ou cliquer sur **latest** dans la barre latérale)
2. Télécharger le fichier correspondant à votre système :

| Système | Fichier | Notes |
|---------|---------|-------|
| Windows | `deduplicateur.exe` | Portable, aucune installation |
| Windows | `deduplicateur_x.x.x_x64-setup.exe` | Installeur NSIS |
| Windows | `deduplicateur_x.x.x_x64_en-US.msi` | Installeur MSI |
| Linux | `deduplicateur_x.x.x_amd64.AppImage` | Portable, toutes distros |
| Linux | `deduplicateur_x.x.x_amd64.deb` | Paquet Debian/Ubuntu |
| macOS | `deduplicateur_x.x.x_x64.dmg` | Installeur DMG |

> **Windows** : lors du premier lancement, Windows peut afficher un avertissement SmartScreen - cliquer sur « Plus d'informations » puis « Exécuter quand même ».

> **ffmpeg** : nécessite ffmpeg installé et présent dans le `PATH` système pour la détection de vidéos similaires et l'affichage des thumbnails vidéo. Sans ffmpeg, les modes fichiers et images fonctionnent normalement. Voir [docs/ffmpeg.md](docs/ffmpeg.md).

### Prérequis (compilation depuis les sources)

**Windows :**
- [Rust](https://rustup.rs) avec la toolchain MSVC
- Visual Studio Build Tools avec le composant "Développement Desktop en C++"
- Node.js 22+ et npm
- WebView2 (pré-installé sur Windows 10/11)
- [ffmpeg](https://www.gyan.dev/ffmpeg/builds/) dans le PATH (optionnel, pour la similarité vidéos et les thumbnails vidéo)

**Linux (Ubuntu/Debian) :**
```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev patchelf
# NE PAS installer libappindicator3-dev (conflit)
```

**Rust :**
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

**Node.js 22+** et **npm**.

### Développement

```bash
. "$HOME/.cargo/env"   # si Rust n'est pas dans le PATH (Linux)
npm install
npm run tauri dev      # démarre l'app avec hot-reload
```

### Build

```bash
npm run tauri build    # produit un binaire dans src-tauri/target/release/
```

### Tests

```bash
# Moteur Rust (186 tests)
cargo test --manifest-path src-tauri/Cargo.toml

# TypeScript - utilitaires + i18n + composants React (302 tests)
npm test
```

---

## Roadmap

| Phase | Description | Statut |
|-------|-------------|--------|
| 1 | Moteur exact + UI minimale | ✅ |
| 2 | Hash partiel, Rayon, progression, sessions | ✅ |
| 3 | Interface soignée (thème, sélection intelligente) | ✅ |
| 4 | Analyse par sous-dossier indépendante | ✅ |
| 5 | Similarité images (gradient hash, résolution-agnostique) | ✅ |
| 5b | Optimisations pHash (5 filtres, cache, config UI, log perf) | ✅ |
| 6 | Similarité vidéos (ffmpeg, cache, parallèle, filtre durée) | ✅ |
| 6b | DTW vidéo, affichage adapté par type, CI Windows | ✅ |
| 7 | Refactoring hooks, i18n FR/EN, correctifs Windows (open/reveal/thumbnail) | ✅ |
| 8 | UX : drag & drop, raccourcis clavier, filtre résultats, mode clair, tri colonnes | ✅ |
| 9 | Comparateur d'images côte à côte, slider superposition, navigation groupes | ✅ |
| 10 | Scan incrémental (cache hashes exacts), filtres extensions, filtres taille | ✅ |
| 11 | Export CSV/HTML, profils de scan avec lancement rapide | ✅ |
| 12 | Similarité audio (fpcalc, empreinte acoustique, cache) | ✅ |
| 13 | Bundle fpcalc, recherche élargie des outils, bannière d'installation guidée | ✅ |
| 14 | Règles de sélection par métadonnées (résolution, bitrate, dossier prioritaire) | ✅ |
| 15 | Liste d'ignorés (persistante, gérable depuis l'UI) | ✅ |
| 16 | Documentation intégrée (aide F1, 34 articles bilingues, recherche) | ✅ |
| 17 | Notifications système (Windows, macOS, Linux) en fin de scan long | ✅ |
| 18 | Comparateur vidéo côte à côte avec lecture synchronisée | ✅ |
| 19 | Scan multi-dossiers et mode "comparer avec le dossier X" | ✅ |
| 20 | Sessions auto-mises à jour à la suppression, cache purge, sessions toujours visibles | ✅ |

---

## Règles de contribution

- **Après chaque modification de feature** : mettre à jour les tests Rust concernés et la documentation (`AGENTS.md`, ce README si la feature est visible)
- **Après chaque ajout de feature** : écrire les tests avant de clore la tâche
- Le moteur Rust (`scanner.rs`) doit rester indépendant de l'UI - testable seul via `cargo test`
- La suppression est toujours vers la corbeille, jamais `fs::remove_file` directement

---

## Licence

MIT - voir [LICENSE](LICENSE).
