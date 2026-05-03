# ffmpeg

## Rôle dans Déduplicateur

ffmpeg (et son compagnon ffprobe) intervient dans deux situations distinctes :

**Analyse similarité vidéos** (mode "Vidéos")
- **ffprobe** - lit les métadonnées de chaque fichier vidéo (durée, résolution, codec) sans décoder les frames
- **ffmpeg** - extrait N frames échantillonnées sur la durée de la vidéo, redimensionnées en 8×8 niveaux de gris, pour calculer un mean hash 64 bits

**Thumbnails vidéo dans l'UI** (tous modes)
- **ffmpeg** - extrait une frame représentative pour afficher un aperçu visuel dans les groupes de doublons vidéo, y compris les doublons exacts trouvés en mode fichiers

Sans ffmpeg :
- L'analyse de similarité vidéo est ignorée, avec un bandeau d'avertissement
- Les thumbnails vidéo affichent une icône statique 🎬 à la place de l'aperçu
- Les modes **fichiers exacts** et **images similaires** fonctionnent normalement

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

Si les commandes fonctionnent dans le terminal mais que Déduplicateur affiche quand même le bandeau, utiliser le bouton "Vérifier à nouveau" dans le bandeau - l'app cherche dans les emplacements courants (`C:\ffmpeg\bin`, Chocolatey, Scoop, `/usr/bin`, Homebrew...) sans nécessiter de redémarrage. Sur Windows, installer de préférence dans `C:\ffmpeg\bin` qui est cherché automatiquement.
