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

### Windows

Télécharger la build statique depuis la [page de releases chromaprint](https://github.com/acoustid/chromaprint/releases) (fichier `chromaprint-fpcalc-x.x.x-windows-x86_64.zip`).

Extraire l'archive, puis ajouter le dossier contenant `fpcalc.exe` au PATH système :

1. Rechercher « variables d'environnement » dans le menu Démarrer
2. Cliquer sur « Variables d'environnement »
3. Dans « Variables système », sélectionner `Path` puis « Modifier »
4. Ajouter le chemin complet vers le dossier contenant `fpcalc.exe`
5. Valider et redémarrer Déduplicateur

> Important : ajouter au PATH **système** (pas utilisateur) pour que Tauri hérite bien de la variable.

### Linux (Ubuntu/Debian)

```bash
sudo apt-get install libchromaprint-tools
```

### macOS

```bash
brew install chromaprint
```

## Vérifier la présence

Ouvrir un terminal (ou PowerShell sur Windows) et lancer :

```bash
fpcalc --version
```

La commande doit afficher un numéro de version. Si elle renvoie « commande introuvable » ou « n'est pas reconnu », fpcalc n'est pas dans le PATH.

Sur Windows, si la commande fonctionne dans PowerShell mais que Déduplicateur affiche quand même le bandeau d'avertissement, vérifier que fpcalc est dans le PATH **système** et non uniquement dans le PATH utilisateur.

## Notes d'implémentation

- fpcalc est lancé via `Command::new("fpcalc")` avec le flag `-raw` (module `audio_hash.rs`)
- Sur Windows, le flag `CREATE_NO_WINDOW` (0x08000000) est appliqué pour éviter l'apparition d'une fenêtre de terminal - même pattern que pour ffmpeg
- Si fpcalc est absent (`fpcalc_available()` retourne false), le champ `fpcalc_missing` du résultat de scan est positionné à `true` et la phase audio est entièrement ignorée
- La comparaison est parallélisée via Rayon (même pattern que la phase pHash images)
- Le regroupement transitif utilise Union-Find avec compression de chemin (même pattern que la phase pHash)
