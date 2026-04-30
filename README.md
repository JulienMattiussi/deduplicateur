# Déduplicateur

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
- **Paramètres avancés** - panneau configurable dans l'UI (taille minimale, tolérance ratio, cache, mode développeur avec log de perf)
- **Thumbnails cliquables** - aperçu côte à côte des images similaires ; cliquer sur une image l'ouvre dans le visualisateur par défaut du système
- **Résultats partiels** - si l'analyse est annulée, les groupes déjà trouvés sont affichés avec un bandeau orange "résultats partiels"
- **Interface sombre** - UI réactive, barre de progression, statistiques en temps réel

---

## Captures d'écran

> À venir - interface desktop Tauri avec liste de groupes de doublons et session picker.

---

## Architecture

```
src/                     # Frontend React + TypeScript
  App.tsx                # Composant principal - UI, état, appels Tauri
  App.css                # Dark theme
  utils.ts               # formatSize, dirname

src-tauri/src/
  lib.rs                 # Commandes Tauri : scan_folder, get_groups_page,
                         #   list_sessions, load_session, delete_session, delete_files
  scanner.rs             # Moteur Rust : collect_files, hash_partial, hash_full,
                         #   filtrage en cascade, parallélisme Rayon
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
Groupes de doublons triés par espace gaspillé
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
| Frontend | React 18 + TypeScript | UI réactive |
| Bundler | Vite + Tauri CLI | Dev HMR + build `.exe` |
| Tests Rust | cargo test + tempfile | 46 tests unitaires sur le moteur |
| Tests TS | Vitest + jsdom + React Testing Library | 13 tests (utilitaires + composants App) |

---

## Démarrage

### Prérequis

**Linux (Ubuntu/Debian) :**
```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev patchelf
# NE PAS installer libappindicator3-dev (conflit)
```

**Rust :**
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

**Node.js 18+** et **npm**.

### Développement

```bash
. "$HOME/.cargo/env"   # si Rust n'est pas dans le PATH
npm install
npm run tauri dev      # démarre l'app avec hot-reload
```

### Build

```bash
npm run tauri build    # produit un binaire dans src-tauri/target/release/
```

Sur Windows, génère un `.exe` autonome.

### Tests

```bash
# Moteur Rust (46 tests)
cargo test --manifest-path src-tauri/Cargo.toml

# TypeScript - utilitaires + composants React (13 tests)
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
| 6 | Similarité vidéos (échantillonnage de frames) | 🔜 |

---

## Règles de contribution

- **Après chaque modification de feature** : mettre à jour les tests Rust concernés et la documentation (`AGENTS.md`, ce README si la feature est visible)
- **Après chaque ajout de feature** : écrire les tests avant de clore la tâche
- Le moteur Rust (`scanner.rs`) doit rester indépendant de l'UI - testable seul via `cargo test`
- La suppression est toujours vers la corbeille, jamais `fs::remove_file` directement

---

## Licence

MIT - voir [LICENSE](LICENSE).
