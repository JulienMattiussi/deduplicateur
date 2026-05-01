# Deduplicateur

Programme Windows de détection et suppression de fichiers en double.

## Règle impérative - Caractères interdits

Le caractère `—` (tiret cadratin, U+2014) est **interdit dans l'ensemble du projet** : code source, documentation, commentaires, messages de commit. Utiliser `-` (trait d'union ASCII) à la place.

## Règle impérative - Checklist de clôture de tâche

**Toute tâche est incomplète tant que cette checklist n'est pas entièrement traitée.**
Parcourir chaque point dans l'ordre, même si la réponse est "rien à faire ici".

### 1. Tests - obligatoire avant tout le reste

- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` passe au vert
- [ ] `npm test -- --run` passe au vert
- [ ] `npx tsc --noEmit` passe sans erreur (obligatoire - le CI échoue silencieusement si oublié)
- [ ] Tout comportement nouveau ou modifié dans `scanner.rs` a un test Rust correspondant
- [ ] Tout composant React nouveau ou modifié a un test TypeScript correspondant si le comportement est testable sans l'app Tauri réelle :
  - Composants autonomes (ex. `ImageComparator`) : fichier `<Composant>.test.tsx` dédié
  - Composants intégrés dans `App` (ex. `FiltersPanel`, `GroupCard`) : tests dans `src/App.test.tsx`
  - Couvrir : rendu de base, interactions utilisateur (clics, clavier), callbacks appelés avec les bons arguments
- [ ] Tout nouveau module Rust a un bloc `#[cfg(test)]` avec des tests unitaires (minimum : cas nominal, cas d'erreur, round-trip save/load si persistance)

### 2. PLAN.md

- [ ] Les étapes accomplies sont cochées `[x]`
- [ ] Si les counts de tests ont changé (ex. "43 tests Rust"), mettre à jour le chiffre
- [ ] Si une nouvelle sous-section est nécessaire pour décrire le travail accompli, l'ajouter

### 3. README.md

- [ ] Si une feature est visible par l'utilisateur : ajouter ou mettre à jour la section **Fonctionnalités**
- [ ] Si le count de tests a changé : mettre à jour le tableau **Stack technique** et la section **Tests**
- [ ] Si une dépendance a été ajoutée : mettre à jour le tableau **Stack technique**

### 4. AGENTS.md (ce fichier)

Mettre à jour si l'un de ces cas s'applique :

- Un piège Tauri, Rust ou React a été découvert (freeze, deadlock, comportement silencieux...)
- Un pattern architectural non-évident a été introduit (ex. mutex+tache async pour la progression)
- Une règle de développement a changé (commandes, conventions, structure)
- Un outil ou une dépendance de test a été ajouté (ex. jsdom, RTL) avec ses contraintes

Ne pas documenter ce qui est déjà évident depuis le code.

### 5. Vérification finale

Avant de déclarer la tâche terminée, répondre explicitement à :
- Les deux suites de tests passent-elles ? (donner les counts exacts)
- Y a-t-il des fichiers de documentation qui auraient dû être mis à jour et ne l'ont pas été ?

## Plan d'action

Voir [docs/plan.md](docs/plan.md) pour le plan complet et l'avancement des phases.

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
Ne pas installer `libappindicator3-dev` - conflit avec `libayatana-appindicator3-1`, casse la build silencieusement. La liste complète des paquets requis est dans README.

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

### Phase pHash : doublons exacts exclus pour eviter double signalement
En mode `find_similar=true`, la phase pHash ne traite que les fichiers image qui NE sont PAS
deja dans un groupe de doublons exacts. Cela evite de reporter un doublon exact comme "similaire".
La detection transitive utilise Union-Find (path compression). Le seuil de Hamming par defaut
est 10 bits sur 64 (gradient hash 8x8).

### get_image_thumbnail : base64 data URL (pas d'asset:// protocol)
`core:asset:default` n'existe pas dans cette version de Tauri. Pour afficher des thumbnails,
utiliser la commande `get_image_thumbnail(path, max_size)` qui lit l'image via le crate `image`,
la reduit, l'encode en JPEG et retourne une data URL `data:image/jpeg;base64,...`.
Ne pas chercher a configurer `convertFileSrc` ou `assetProtocol` pour ce cas d'usage.

### ScanParams : struct au lieu de parametres individuels
`scan_folder` prend un `ScanParams` (struct avec champs pub) au lieu de parametres individuels.
`ScanParams::new(folder)` donne les valeurs par defaut. Dans les tests, utiliser la syntaxe
de mise a jour : `ScanParams { recursive: true, ..ScanParams::new(path) }`.

### Pipeline pHash optimise : 5 optimisations configurables
Les 5 optimisations sont dans `phash_config::PHashConfig` (fichier `phash_config.json`) :
1. Filtre de taille minimale - s'active si `n >= min_images_size_filter`
2. Filtre de ratio d'aspect - lecture d'en-tete uniquement, s'active si `n >= min_images_aspect_filter`
3. Hash en 2 passes - coarse+fine en un seul decode, s'active si `n >= min_images_two_pass`
4. Cache inter-scans - `phash_cache.json`, invalide automatiquement si mtime ou tailles de hash changent
5. Comparaison parallele rayon - `flat_map_iter` (pas `flat_map`), s'active si `n >= min_images_parallel_compare`

Note : `flat_map` en rayon attend `IntoParallelIterator` ; utiliser `flat_map_iter` pour un
iterateur standard (`Vec::into_iter()`).

### Log de perf pHash : JSONL, un objet par scan
Quand `perf_log_enabled=true`, chaque scan similaire ajoute une ligne JSON dans
`<data_dir>/phash_perf.jsonl`. Contient timings, compteurs, et un snapshot de `PHashConfig`.
Visible seulement via le panneau avancé (checkbox "Mode développeur").

### Chargement lazy des FolderSection
En mode `by_folder`, les en-têtes de dossiers sont disponibles via `list_folder_keys`
(léger : juste les résumés). Les groupes ne sont chargés qu'au premier dépliage via
`get_folder_groups_page(folder_key, offset, limit)`. Le composant `FolderSection`
démarre collapsed et appelle `onExpand()` uniquement si `groups.length === 0 && !loading`.
Re-collapse puis re-expand ne refait pas d'appel réseau (groupes déjà en mémoire dans
l'état App via `groupsByFolder` useMemo).

### window.emit() depuis les threads rayon gele le GTK main loop
Appeler `window.emit()` directement depuis les threads rayon (via un callback `on_progress`)
provoque un deadlock avec le GTK main loop sur Linux - l'app affiche "ne repond pas" apres
quelques secondes. Pattern correct : ecrire l'etat dans un `Arc<Mutex<Option<...>>>` depuis
rayon, et emettre depuis une tache tokio separee a intervalle regulier :
```rust
let progress_state = Arc::new(Mutex::new(None));
let emit_task = tauri::async_runtime::spawn(async move {
    let mut interval = tokio::time::interval(Duration::from_millis(100));
    loop {
        interval.tick().await;
        let snapshot = progress_state.lock().unwrap().clone(); // relache avant emit
        if let Some((current, total, file)) = snapshot {
            let _ = window.emit("scan:progress", json!({...}));
        }
    }
});
// ... spawn_blocking pour le scan ...
emit_task.abort();
```
Ajouter `tokio = { version = "1", features = ["time"] }` dans Cargo.toml.

### Commandes Tauri synchrones bloquent le thread principal
Une commande `fn` (non `async`) s'execute sur le thread principal de Tauri sous Linux.
Avec de nombreux appels simultanees (ex. thumbnails de 60+ groupes au rendu), cela gele l'UI.
Toute commande faisant du I/O ou du traitement CPU doit etre `async fn` + `spawn_blocking` :
```rust
#[tauri::command]
async fn get_image_thumbnail(path: String, max_size: u32) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || { ... })
        .await.map_err(|e| e.to_string())?
}
```

### Progression pHash avec cache chaud : emettre aussi pour les cache hits
Quand le cache pHash est entierement chaud, la boucle de decodage (`miss_indices`) est vide
et `on_progress` n'est jamais appele - la progression reste bloquee a la valeur de la phase
exact. Solution : appeler `on_progress` dans la boucle de check du cache pour les hits aussi,
avec un compteur atomique partage entre hits et misses.

### Subprocessus Windows (ffmpeg, explorer) : ajouter CREATE_NO_WINDOW
Tout `Command::new(...)` lancé depuis Tauri sur Windows ouvre un terminal visible si le
processus cible est une application console. Utiliser le flag `CREATE_NO_WINDOW` (0x08000000)
via le trait `NoWindowExt` defini dans `video_hash.rs`, ou via `CommandExt::creation_flags`
dans un bloc `#[cfg(target_os = "windows")]`. S'applique a ffmpeg, ffprobe, et tout
subprocess console (pas a `explorer.exe` qui est une app GUI).

### Icone de fenetre : set_icon invisible sur GNOME/Wayland en mode dev
Sur GNOME Shell, `window.set_icon()` n'affecte pas la barre des taches - GNOME utilise
le fichier `.desktop` installe. En mode dev, aucun `.desktop` n'est present.
Voir [docs/icone.md](docs/icone.md) pour le setup complet et le comportement par plateforme.

### Vitest + worktrees : plusieurs instances React -> "Invalid hook call"
Quand des agents travaillent en worktree isole, leurs `node_modules/` sont dans
`.claude/worktrees/<id>/`. Vitest decouvre leurs fichiers de test et charge plusieurs
instances de React, causant "Invalid hook call". Fix dans `vite.config.ts` :
```ts
test: {
  include: ["src/**/*.test.{ts,tsx}"],
  exclude: [".claude/**", "node_modules/**"],
}
```
