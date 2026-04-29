# Deduplicateur

Programme Windows de détection et suppression de fichiers en double.

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

Ne pas déclarer le plugin dans `tauri.conf.json` — la configuration se fait uniquement
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

### Sélecteur de dossier : protéger contre les clics multiples
`open()` du plugin dialog est async — plusieurs clics rapides ouvrent plusieurs fenêtres.
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
