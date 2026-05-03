# fpcalc (chromaprint)

## Rôle dans Déduplicateur

fpcalc est l'outil en ligne de commande de la bibliothèque [chromaprint](https://acoustid.org/chromaprint), utilisé pour calculer une **empreinte acoustique** (audio fingerprint) sur chaque fichier audio.

**Analyse similarité audio** (mode "🎵 Audio")
- **fpcalc** - analyse le contenu audio du fichier et produit un vecteur d'entiers 32 bits représentant la « signature sonore » du morceau, indépendamment du format, du bitrate ou de la compression
- Le vecteur est comparé entre paires via la **distance de Hamming** normalisée (proportion de bits qui diffèrent)
- Un filtre de durée (tolérance %) élimine les paires dont les durées sont trop différentes avant la comparaison O(n²)
- Les résultats sont mis en cache entre scans (`audio_cache.json`) : un fichier non modifié (mtime + taille inchangés) n'est pas ré-analysé

Sans fpcalc :
- L'analyse de similarité audio est ignorée, avec un bandeau d'avertissement
- Les modes **fichiers exacts**, **images similaires** et **vidéos similaires** fonctionnent normalement

## Format de sortie de fpcalc

fpcalc est appelé avec le flag `-raw` pour obtenir les valeurs brutes :

```
fpcalc -raw /path/to/audio.mp3
```

Sortie attendue :
```
DURATION=183
FINGERPRINT=1885693234,-2113929216,42,1903399634,...
```

- `DURATION` : durée en secondes (entier)
- `FINGERPRINT` : liste d'entiers 32 bits séparés par des virgules

## Extensions audio supportées

`mp3`, `flac`, `ogg`, `m4a`, `aac`, `wav`, `wma`, `opus`, `aiff`, `aif`, `ape`

## Installation

**fpcalc est bundlé dans Déduplicateur depuis la Phase 13 - aucune installation manuelle n'est nécessaire.** Le binaire est embarqué dans l'installeur et détecté automatiquement.

Si pour une raison quelconque le binaire bundlé ne fonctionne pas, l'app affiche un bandeau avec les instructions d'installation et un bouton "Vérifier à nouveau".

### Installation manuelle (fallback)

#### Windows

Télécharger la build statique depuis la [page de releases chromaprint](https://github.com/acoustid/chromaprint/releases) (fichier `chromaprint-fpcalc-x.x.x-windows-x86_64.zip`).

Extraire l'archive dans `C:\Program Files\chromaprint\` - Déduplicateur cherche automatiquement dans ce dossier.

#### Linux (Ubuntu/Debian)

```bash
sudo apt-get install libchromaprint-tools
```

#### macOS

```bash
brew install chromaprint
```

## Vérifier la présence

Si l'app affiche le bandeau d'avertissement malgré l'installation, ouvrir un terminal et lancer :

```bash
fpcalc --version
```

La commande doit afficher un numéro de version. Si elle échoue, utiliser le bouton "Vérifier à nouveau" dans le bandeau après l'installation - l'app cherche dans les emplacements courants (PATH, Chocolatey, Scoop, Homebrew, `/usr/bin`) sans nécessiter de redémarrage.

## Notes d'implémentation

- fpcalc est recherché dans cet ordre par `tool_finder::find_tool("fpcalc")` : binaire bundlé (à côté de l'exe), chemins système courants (`C:\Program Files\chromaprint`, `/usr/bin`, `/opt/homebrew/bin`...), puis PATH
- fpcalc est lancé avec le flag `-raw` (module `audio_hash.rs`)
- Sur Windows, le flag `CREATE_NO_WINDOW` (0x08000000) est appliqué pour éviter l'apparition d'une fenêtre de terminal
- Si fpcalc est absent (`fpcalc_available()` retourne false), le champ `fpcalc_missing` du résultat de scan est positionné à `true` et la phase audio est entièrement ignorée
- La comparaison est parallélisée via Rayon (même pattern que la phase pHash images)
- Le regroupement transitif utilise Union-Find avec compression de chemin (même pattern que la phase pHash)
- Le bundling est géré via `externalBin` dans `tauri.conf.json` ; `build.rs` crée un placeholder vide en dev pour éviter l'échec de build si `scripts/download-fpcalc.sh` n'a pas encore été lancé
