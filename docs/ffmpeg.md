# ffmpeg

## Rôle dans Déduplicateur

ffmpeg (et son compagnon ffprobe) est utilisé exclusivement pour le mode **similarité vidéos** :

- **ffprobe** - lit les métadonnées de chaque fichier vidéo (durée, résolution, codec) sans décoder les frames
- **ffmpeg** - extrait N frames échantillonnées sur la durée de la vidéo, redimensionnées en 8×8 niveaux de gris, pour calculer un mean hash 64 bits

Sans ffmpeg, les modes **fichiers exacts** et **images similaires** fonctionnent normalement. Seule l'analyse vidéo est ignorée, avec un bandeau d'avertissement dans l'UI.

## Installation

### Windows

Télécharger la build statique depuis [gyan.dev/ffmpeg/builds](https://www.gyan.dev/ffmpeg/builds/) (recommandé : `ffmpeg-release-essentials.zip`).

Extraire l'archive, puis ajouter le dossier `bin\` au PATH système :

1. Rechercher « variables d'environnement » dans le menu Démarrer
2. Cliquer sur « Variables d'environnement »
3. Dans « Variables système », sélectionner `Path` puis « Modifier »
4. Ajouter le chemin complet vers le dossier `bin\` (ex. `C:\ffmpeg\bin`)
5. Valider et redémarrer Déduplicateur

> Important : ajouter au PATH **système** (pas utilisateur) pour que Tauri hérite bien de la variable.

### Linux (Ubuntu/Debian)

```bash
sudo apt-get install ffmpeg
```

### macOS

```bash
brew install ffmpeg
```

## Vérifier la présence

Ouvrir un terminal (ou PowerShell sur Windows) et lancer :

```bash
ffprobe -version
ffmpeg -version
```

Les deux commandes doivent afficher un numéro de version. Si l'une renvoie « commande introuvable » ou « n'est pas reconnu », ffmpeg n'est pas dans le PATH.

Sur Windows, si les commandes fonctionnent dans PowerShell mais que Déduplicateur affiche quand même le bandeau d'avertissement, vérifier que ffmpeg est dans le PATH **système** et non uniquement dans le PATH utilisateur.
