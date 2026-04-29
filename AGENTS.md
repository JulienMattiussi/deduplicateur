# Deduplicateur

Programme Windows de détection et suppression de fichiers en double.

## Règle impérative - Caractères interdits

Le caractère `—` (tiret cadratin, U+2014) est **interdit dans l'ensemble du projet** : code source, documentation, commentaires, messages de commit. Utiliser `-` (trait d'union ASCII) à la place.

## Règle impérative - Documentation et tests

**Après chaque ajout ou modification de feature, l'agent DOIT :**

1. **Mettre à jour les tests Rust** (`scanner.rs` ou nouveau fichier de test) pour couvrir le comportement ajouté ou modifié. Ne pas clore la tâche sans que `cargo test` passe au vert.
2. **Mettre à jour ce fichier** (`AGENTS.md`) si un nouveau piège Tauri ou un comportement non-évident a été découvert.
3. **Mettre à jour `README.md`** si la feature est visible par l'utilisateur (nouvelle section Fonctionnalités, tableau Roadmap, etc.).
4. **Mettre à jour `PLAN.md`** pour cocher les étapes accomplies.

Cette règle s'applique même pour des modifications mineures.

## Plan d'action

Voir [PLAN.md](PLAN.md) pour le plan complet et l'avancement des phases.

## Stack

- **Backend** : Rust via Tauri 2
- **Frontend** : React + TypeScript + Vite
- **Packaging** : `tauri build` → `.exe` autonome

## Développement

```bash
. "$HOME/.cargo/env"     # charger Rust dans le shell courant (si pas dans ~/.bashrc)
npm run tauri dev        # dev avec hot reload
npm run tauri build      # build .exe release
```

## Architecture

```
src/                          # Frontend React
  App.tsx                     # Composant principal (UI + appels Tauri)
  App.css                     # Dark theme
src-tauri/
  src/
    main.rs                   # Point d'entrée (ne pas modifier)
    lib.rs                    # Commandes Tauri (scan_folder, delete_files)
    scanner.rs                # Moteur de déduplication
  capabilities/
    default.json              # Permissions Tauri 2 (OBLIGATOIRE)
  tauri.conf.json             # Configuration Tauri
  icons/                      # Icônes PNG RGBA obligatoires
```

## Principes

- Le moteur Rust est indépendant de l'UI (testable seul)
- Filtrage en cascade : taille → hash xxhash complet → (pHash image → pHash vidéo)
- Chaque sous-dossier est analysé indépendamment
- Suppression toujours vers la corbeille (récupérable)

## Pièges Tauri 2 rencontrés

### Permissions manquantes → clic sans effet
Tauri 2 exige un fichier `src-tauri/capabilities/default.json` déclarant explicitement
chaque permission utilisée. Sans lui, les appels de plugins (dialog, fs…) échouent
silencieusement côté JS.
```json
{
  "identifier": "default",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "dialog:allow-open",
    "shell:allow-open",
    "fs:allow-read-dir",
    "fs:allow-read-file"
  ]
}
```

### Plugin dialog → ne pas mettre `{}` dans tauri.conf.json
`"plugins": { "dialog": {} }` provoque une panique au démarrage :
> PluginInitialization("dialog", "invalid type: map, expected unit")

Ne pas déclarer le plugin dans `tauri.conf.json` - la configuration se fait uniquement
via `capabilities/`.

### Icônes PNG obligatoirement RGBA
Les icônes référencées dans `bundle.icon` doivent être en mode RGBA (pas RGB ni indexed).
Générer avec Python + Pillow :
```python
from PIL import Image
img = Image.new('RGBA', (32, 32), (79, 142, 247, 255))
img.save('src-tauri/icons/32x32.png')
```

### Dépendances système Linux
```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev patchelf
# NE PAS installer libappindicator3-dev (conflit avec libayatana-appindicator3-1)
```

### Commandes longues → utiliser spawn_blocking pour ne pas geler l'UI
Une commande Tauri synchrone bloque le thread de la WebView pendant son exécution.
Pour toute opération longue (scan de fichiers, hachage…), rendre la commande `async`
et déporter le travail avec `spawn_blocking` :
```rust
#[tauri::command]
async fn scan_folder(window: tauri::Window, path: String) -> Result<ScanResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        do_scan(&path, |current, total| {
            let _ = window.emit("scan:progress", json!({ "current": current, "total": total }));
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
```

### Sélecteur de dossier : protéger contre les clics multiples
`open()` du plugin dialog est async - plusieurs clics rapides ouvrent plusieurs fenêtres.
Toujours garder un flag `picking` pour bloquer les appels concurrents :
```tsx
const [picking, setPicking] = useState(false);
async function pickFolder() {
  if (picking) return;
  setPicking(true);
  try {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") setFolder(dir);
  } finally {
    setPicking(false);
  }
}
```

### Liste scrollable : flex-shrink sur les cards
Quand une liste scrollable est un conteneur `display: flex; flex-direction: column`,
ses enfants se partagent l'espace disponible et se compriment au lieu de prendre leur
hauteur naturelle. Toujours ajouter `flex-shrink: 0` sur les cards enfants.
```css
.group-card {
  flex-shrink: 0; /* empêche la compression dans un flex column scrollable */
}
```

### Mode "par dossier" : first_level_subdir et mise à plat
En mode `by_folder=true`, chaque fichier est attribué au premier niveau de sous-dossier
sous la racine scannée. Les niveaux plus profonds sont mis à plat (ignorés). Exemples :
- `root/Photos/img.jpg` → clé `"Photos"`
- `root/Photos/2023/summer/img.jpg` → clé `"Photos"` (pas `"2023"`)
- `root/img.jpg` → clé `""` (dossier racine)

Les groupes sont triés par `folder_key` alphabétique, puis par espace gaspillé décroissant
à l'intérieur de chaque dossier. La clé vide `""` passe donc avant toute lettre.

### Paramètres Tauri : camelCase JS → snake_case Rust
Tauri 2 convertit automatiquement les paramètres de commande entre camelCase (JS) et
snake_case (Rust). Ne pas nommer les paramètres Rust en camelCase.
```ts
// JS (invoke)
invoke("scan_folder", { byFolder: true })  // camelCase
```
```rust
// Rust (command)
async fn scan_folder(by_folder: bool) { ... }  // snake_case
```

### Chargement lazy des FolderSection
En mode `by_folder`, les en-têtes de dossiers sont disponibles via `list_folder_keys`
(léger : juste les résumés). Les groupes ne sont chargés qu'au premier dépliage via
`get_folder_groups_page(folder_key, offset, limit)`. Le composant `FolderSection`
démarre collapsed et appelle `onExpand()` uniquement si `groups.length === 0 && !loading`.
Re-collapse puis re-expand ne refait pas d'appel réseau (groupes déjà en mémoire dans
l'état App via `groupsByFolder` useMemo).
