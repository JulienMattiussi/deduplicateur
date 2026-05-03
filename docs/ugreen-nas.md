# Portage Ugreen NAS

## Pourquoi l'app actuelle ne tourne pas sur un NAS

Deduplicateur est une application de bureau Tauri. Elle nécessite :
- WebView (Chromium embarqué)
- GTK + serveur d'affichage X11 ou Wayland
- Un bureau graphique

Les NAS Ugreen tournent sous UGOS (basé Debian), sans environnement graphique. Le portage direct est impossible.

---

## Options de portage

### Option 1 - CLI Rust (1-2 jours)

Le moteur Rust (`src-tauri/src/scanner.rs`) est déjà indépendant de l'UI. Il suffit de créer un binaire `main.rs` qui l'appelle directement.

```
deduplicateur scan /volume1/Photos --mode by_folder --output rapport.html
```

**Avantages :**
- Aucune dépendance graphique
- Compile pour Linux x86_64 et ARM (Rockchip)
- Réutilise tout le moteur existant : hash, pHash, cache, filtres, export HTML/CSV

**Limites :**
- Pas d'interface graphique
- Pas d'accès à distance depuis un navigateur

---

### Option 2 - Application web (1-2 semaines)

Remplacer Tauri par un serveur HTTP Rust (Axum ou Actix-web). L'UI React existante est réutilisée telle quelle dans le navigateur. Les commandes Tauri (`invoke`) deviennent des endpoints REST ou WebSocket.

```
http://nas-local:8765
```

Modèle identique à Jellyfin, Sonarr, Radarr.

**Changements principaux :**
- `src-tauri/src/lib.rs` : remplacer `#[tauri::command]` par des handlers Axum
- `src/` (React) : remplacer `invoke()` de `@tauri-apps/api/core` par `fetch()`
- Supprimer Tauri, ajouter Axum + Tower comme dépendances Rust
- Servir les fichiers statiques React depuis Axum

**Ce qui reste identique :**
- Tout `scanner.rs` et les modules Rust
- Tout le code React (logique, composants, i18n, tests)
- Le pipeline de détection (exact, pHash, vidéo, audio)

---

### Option 3 - Container Docker (recommandé pour distribution)

Packager l'option 2 dans un container Docker. Ugreen supporte Docker nativement via son AppCenter et permet d'installer des containers tiers.

**Structure Docker :**
```
FROM debian:bookworm-slim
COPY deduplicateur-server /usr/local/bin/
COPY dist/ /usr/local/share/deduplicateur/
EXPOSE 8765
CMD ["deduplicateur-server", "--port", "8765", "--data", "/data"]
```

**Volume à monter :**
- `/data` : dossier de données persistantes (sessions, caches, ignore_list)
- `/media` : accès aux volumes NAS (lecture + suppression vers corbeille)

**Limites sur NAS :**
- La suppression "vers la corbeille" nécessite adaptation (la corbeille NAS est dans `#recycle` sur les volumes Synology/Ugreen)
- ffmpeg et fpcalc doivent être inclus dans l'image Docker ou installés sur le NAS
- Les thumbnails vidéo nécessitent ffmpeg dans le container

---

## Architecture cible (option 2+3)

```
Navigateur (PC/mobile sur le réseau local)
        |
        | HTTP / WebSocket
        v
  [Axum server :8765]
        |
   +----+----+
   |         |
React SPA   API REST
(dist/)    /scan, /groups, /delete...
                |
           scanner.rs (inchangé)
                |
         Volumes NAS montés
```

---

## Recommandation

Pour une vraie app NAS distribuable :

1. Implémenter l'**option 2** (serveur web Axum)
2. Packager en **option 3** (Docker)
3. Soumettre au [Ugreen AppCenter](https://www.ugreen.com) ou distribuer via Docker Hub

Le travail le plus significatif est la couche de communication (Tauri → REST), estimée à ~1 semaine. Le moteur Rust et le frontend React sont réutilisables à plus de 90%.
