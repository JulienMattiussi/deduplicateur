export interface HelpArticle {
  id: string;
  sectionId: string;
  title: { fr: string; en: string };
  keywords: { fr: string[]; en: string[] };
  body: { fr: string; en: string };
}

export interface HelpSection {
  id: string;
  title: { fr: string; en: string };
}

export const HELP_SECTIONS: HelpSection[] = [
  { id: "start",      title: { fr: "Démarrage",                    en: "Getting started" } },
  { id: "results",    title: { fr: "Comprendre les résultats",      en: "Understanding results" } },
  { id: "select",     title: { fr: "Sélectionner et supprimer",     en: "Select and delete" } },
  { id: "byfolder",   title: { fr: "Mode par sous-dossier",         en: "By-folder mode" } },
  { id: "comparator", title: { fr: "Comparateur d'images",          en: "Image comparator" } },
  { id: "video-comparator", title: { fr: "Comparateur de vidéos",   en: "Video comparator" } },
  { id: "audio-comparator", title: { fr: "Comparateur audio",         en: "Audio comparator" } },
  { id: "ignored",    title: { fr: "Groupes ignorés",               en: "Ignored groups" } },
  { id: "profiles",   title: { fr: "Profils de scan",               en: "Scan profiles" } },
  { id: "filters",    title: { fr: "Filtres",                       en: "Filters" } },
  { id: "advanced",   title: { fr: "Paramètres avancés",            en: "Advanced settings" } },
  { id: "sessions",   title: { fr: "Analyses précédentes",          en: "Previous scans" } },
  { id: "tools",      title: { fr: "Outils externes",               en: "External tools" } },
  { id: "misc",       title: { fr: "Export et interface",           en: "Export and interface" } },
  { id: "notif",      title: { fr: "Notifications",                 en: "Notifications" } },
  { id: "archives",   title: { fr: "Analyse des archives",          en: "Archive scanning" } },
];

export const HELP_ARTICLES: HelpArticle[] = [

  // ── Démarrage ─────────────────────────────────────────────────────────────

  {
    id: "choose-folder",
    sectionId: "start",
    title: { fr: "Choisir un dossier", en: "Choose a folder" },
    keywords: {
      fr: ["dossier", "choisir", "sélectionner", "chemin", "glisser", "déposer", "parcourir", "ouvrir"],
      en: ["folder", "choose", "select", "path", "drag", "drop", "browse", "open"],
    },
    body: {
      fr: `Cliquez sur la zone **📁** en haut de l'application pour ouvrir le sélecteur de dossier de votre système d'exploitation.

**Glisser-déposer** : vous pouvez aussi glisser directement un dossier depuis votre explorateur de fichiers sur la fenêtre de l'application. Un bandeau bleu "Déposer un dossier ici" confirme la détection.

Le chemin sélectionné s'affiche dans la zone de sélection. L'analyse ne démarre pas automatiquement : cliquez sur **Analyser** pour lancer.`,
      en: `Click the **📁** zone at the top of the application to open your system folder picker.

**Drag and drop**: you can also drag a folder directly from your file explorer onto the application window. A blue "Drop a folder here" banner confirms detection.

The selected path is shown in the selection area. The scan does not start automatically - click **Scan** to launch.`,
    },
  },

  {
    id: "scan-mode",
    sectionId: "start",
    title: { fr: "Modes de scan", en: "Scan modes" },
    keywords: {
      fr: ["mode", "scan", "tout", "dossier", "sous-dossier", "récursif", "par dossier", "plat", "flat", "référence", "comparer", "compare"],
      en: ["mode", "scan", "entire", "folder", "subfolder", "recursive", "by folder", "flat", "reference", "compare", "cross"],
    },
    body: {
      fr: `**Tout le dossier** : compare tous les fichiers ensemble, quel que soit leur sous-dossier. Idéal pour trouver des doublons dispersés dans une arborescence entière.

**Par sous-dossier** : analyse chaque premier niveau de sous-dossier séparément. Les fichiers de dossiers différents ne sont jamais comparés entre eux. Utile pour nettoyer des photos organisées par année ou par événement.

**Comparer avec un autre dossier** : compare un dossier source avec un dossier de référence. Seuls les fichiers présents dans les deux dossiers sont signalés. Les doublons internes à chaque dossier sont ignorés. Voir l'article dédié pour plus de détails.

**Sous-dossiers (récursif)** : en mode "Tout le dossier", cette option inclut les sous-dossiers de façon récursive. Désactivée, seul le niveau de surface est analysé. Cette option est automatiquement forcée en mode "Par sous-dossier" et "Comparer avec un autre dossier".`,
      en: `**Entire folder**: compares all files together, regardless of subfolder. Best for finding duplicates scattered across a full directory tree.

**By subfolder**: analyzes each first-level subfolder independently. Files from different folders are never compared. Useful for cleaning photos organized by year or event.

**Compare with another folder**: compares a source folder with a reference folder. Only files present in both folders are reported. Internal duplicates within each folder are ignored. See the dedicated article for details.

**Subfolders (recursive)**: in "Entire folder" mode, this option includes subfolders recursively. When disabled, only the top-level directory is scanned. This option is automatically forced in "By subfolder" and "Compare with another folder" modes.`,
    },
  },

  {
    id: "compare-folder-mode",
    sectionId: "start",
    title: { fr: "Mode Comparer avec un autre dossier", en: "Compare with another folder mode" },
    keywords: {
      fr: ["comparer", "référence", "dossier secondaire", "source", "backup", "sauvegarde", "doublon croisé", "inter-dossier"],
      en: ["compare", "reference", "secondary folder", "source", "backup", "cross-folder", "cross duplicate"],
    },
    body: {
      fr: `Ce mode est conçu pour détecter les fichiers qui existent à la fois dans un **dossier source** et dans un **dossier de référence** (ex. une sauvegarde).

**Comment l'utiliser :**
- Sélectionner "Comparer avec un autre dossier" dans le menu déroulant de mode.
- Choisir le dossier principal (source) via la zone 📁 habituelle.
- Choisir le dossier de référence via le second sélecteur "Dossier de référence" qui apparaît.
- Lancer l'analyse.

**Ce qui est signalé :** uniquement les fichiers présents dans les deux dossiers (au moins un fichier de chaque côté dans le même groupe).

**Ce qui est ignoré :** les fichiers en double uniquement dans le dossier source, et les fichiers en double uniquement dans le dossier de référence.

**Badge "Réf."** : dans les résultats, chaque fichier provenant du dossier de référence affiche un badge \`Réf.\` pour le distinguer visuellement.

**Cas d'usage typique :** vous avez \`Photos/\` sur votre disque dur et \`Backup/Photos/\` sur un disque externe. Ce mode liste uniquement les photos présentes dans les deux, afin de savoir ce qui peut être supprimé en toute sécurité de la sauvegarde.`,
      en: `This mode is designed to detect files that exist in both a **source folder** and a **reference folder** (e.g. a backup).

**How to use it:**
- Select "Compare with another folder" from the mode dropdown.
- Choose the main (source) folder via the usual 📁 area.
- Choose the reference folder via the second "Reference folder" picker that appears.
- Start the scan.

**What is reported:** only files present in both folders (at least one file from each side in the same group).

**What is ignored:** duplicates that exist only within the source folder, and duplicates that exist only within the reference folder.

**"Ref." badge:** in the results, each file from the reference folder shows a \`Ref.\` badge to distinguish it visually.

**Typical use case:** you have \`Photos/\` on your hard drive and \`Backup/Photos/\` on an external drive. This mode lists only photos present in both, so you know what can safely be removed from the backup.`,
    },
  },

  {
    id: "detection-mode",
    sectionId: "start",
    title: { fr: "Types de détection", en: "Detection types" },
    keywords: {
      fr: ["fichiers", "images", "vidéos", "audio", "détection", "similarité", "similaires", "identiques", "phash", "fpcalc", "ffmpeg", "mode"],
      en: ["files", "images", "videos", "audio", "detection", "similarity", "similar", "identical", "phash", "fpcalc", "ffmpeg", "mode"],
    },
    body: {
      fr: `**Fichiers** : détecte les doublons exacts bit à bit (même contenu, quelle que soit l'extension). Rapide, fonctionne pour tous types de fichiers.

**🖼 Images** : détecte les images visuellement identiques même si elles diffèrent par la résolution, le format (JPEG/PNG/WebP…) ou la compression. Utilise un gradient hash (pHash). Le curseur **Similarité min** règle la tolérance : 100 % = images pixel perfect, 80 % = images très proches visuellement.

**🎬 Vidéos** : détecte les mêmes vidéos en formats ou résolutions différents via FFmpeg. Nécessite que FFmpeg soit installé. Le curseur règle la tolérance.

**🎵 Audio** : détecte les mêmes fichiers audio en qualités ou formats différents via une empreinte acoustique (fpcalc/chromaprint). Nécessite que fpcalc soit installé.`,
      en: `**Files**: detects exact bit-for-bit duplicates (same content, any extension). Fast, works for all file types.

**🖼 Images**: detects visually identical images even if they differ in resolution, format (JPEG/PNG/WebP…) or compression. Uses a gradient hash (pHash). The **Min similarity** slider sets the tolerance: 100% = pixel-perfect, 80% = very close images.

**🎬 Videos**: detects the same video in different formats or resolutions via FFmpeg. Requires FFmpeg to be installed. The slider sets the tolerance.

**🎵 Audio**: detects the same audio file in different qualities or formats via an acoustic fingerprint (fpcalc/chromaprint). Requires fpcalc to be installed.`,
    },
  },

  {
    id: "launch-cancel",
    sectionId: "start",
    title: { fr: "Lancer et annuler un scan", en: "Launch and cancel a scan" },
    keywords: {
      fr: ["analyser", "lancer", "démarrer", "annuler", "arrêter", "progression", "barre", "durée", "estimation", "temps", "partiel", "doublon", "compteur", "total"],
      en: ["scan", "launch", "start", "cancel", "stop", "progress", "bar", "duration", "estimate", "time", "partial", "duplicate", "counter", "total"],
    },
    body: {
      fr: `Cliquez sur **Analyser** pour démarrer. Le bouton est grisé si aucun dossier n'est sélectionné.

Pendant l'analyse, une barre de progression indique le nombre de fichiers traités et le total. En dessous s'affiche en bleu le **nombre de doublons trouvés au total** jusqu'à ce stade du scan - ce compteur est cumulatif sur toutes les phases (doublons exacts, images similaires, vidéos, audio). Une estimation du temps restant s'affiche après quelques secondes : "environ 2 min", "presque fini"…

La première phase **"Collecte des fichiers…"** (sans barre de progression) peut durer quelques secondes sur les très grands dossiers.

**Annuler** : cliquez sur le bouton "Annuler" pour interrompre le scan. Les groupes déjà trouvés sont conservés et affichés avec un bandeau orange **"Résultats partiels"**. Vous pouvez supprimer des fichiers même sur des résultats partiels.`,
      en: `Click **Scan** to start. The button is grayed out if no folder is selected.

During the scan, a progress bar shows processed files vs. total. Below it, a blue counter shows the **total number of duplicate groups found so far** - this counter is cumulative across all phases (exact, similar images, videos, audio). A time estimate appears after a few seconds: "about 2 min", "almost done"…

The initial **"Collecting files…"** phase (no progress bar) can take a few seconds on very large folders.

**Cancel**: click the "Cancel" button to interrupt. Already-found groups are kept and shown with an orange **"Partial results"** banner. You can still delete files from partial results.`,
    },
  },

  // ── Comprendre les résultats ───────────────────────────────────────────────

  {
    id: "groups",
    sectionId: "results",
    title: { fr: "Groupes et doublons", en: "Groups and duplicates" },
    keywords: {
      fr: ["groupe", "doublon", "original", "copie", "taille", "récupérable", "espace", "badge", "en double"],
      en: ["group", "duplicate", "original", "copy", "size", "recoverable", "space", "badge"],
    },
    body: {
      fr: `Les résultats sont organisés en **groupes** : chaque groupe contient des fichiers identiques ou similaires entre eux.

**Badge "original"** : le fichier le plus ancien (date de modification la plus basse) de chaque groupe reçoit ce badge. C'est une convention d'affichage utile en pratique ; tous les fichiers du groupe restent techniquement équivalents au byte près.

**Espace en double** : affiché en haut à droite de chaque groupe. C'est l'espace récupéré en ne gardant qu'un seul exemplaire : (nombre de fichiers − 1) × taille.

**Taille récupérable totale** : affichée en rouge dans la barre de statistiques. C'est la somme de l'espace récupérable de tous les groupes.

Cliquez sur l'en-tête d'un groupe **(▾/▸)** pour le déplier ou replier.`,
      en: `Results are organized in **groups**: each group contains identical or similar files.

**"Original" badge**: the oldest file (lowest modified time) in each group gets this badge. This is a useful display convention; all files in the group remain technically equivalent at the byte level.

**Duplicate space**: shown in the top-right of each group header. It's the space recovered by keeping only one copy: (number of files − 1) × size.

**Total recoverable space**: shown in red in the stats bar. It's the sum of recoverable space across all groups.

Click a group header **(▾/▸)** to expand or collapse it.`,
    },
  },

  {
    id: "file-types",
    sectionId: "results",
    title: { fr: "Types de fichiers et similarité", en: "File types and similarity" },
    keywords: {
      fr: ["icône", "type", "image", "vidéo", "audio", "similaire", "identique", "vignette", "miniature", "durée", "taille", "pdf", "archive", "code", "document", "tableur"],
      en: ["icon", "type", "image", "video", "audio", "similar", "identical", "thumbnail", "duration", "size", "pdf", "archive", "code", "document", "spreadsheet"],
    },
    body: {
      fr: `L'en-tête de chaque groupe affiche une icône et une description selon le type détecté :

- 🖼 **X images similaires / identiques**
- 🎬 **X vidéos similaires / identiques**
- 🎵 **X fichiers audio similaires / identiques**
- **X fichiers identiques** (autres types)

**Similaires** signifie que les fichiers ont été rapprochés par empreinte visuelle ou acoustique - pas forcément identiques bit à bit. **Identiques** signifie même contenu exact.

Chaque ligne affiche toujours une **icône de type** dans la première colonne :
- Images, vidéos : miniature générée (cliquable pour ouvrir dans l'application par défaut)
- Audio : bouton lecture
- Autres fichiers : icône selon la catégorie - PDF, archive (zip, rar…), code source, document texte (doc, txt, md…), tableur (xls, csv…), présentation, ou icône générique

Pour les images, vidéos et audio, la ligne affiche aussi la **taille** individuelle et la **durée** (vidéos/audio).`,
      en: `Each group header shows an icon and description based on the detected type:

- 🖼 **X similar / identical images**
- 🎬 **X similar / identical videos**
- 🎵 **X similar / identical audio files**
- **X identical files** (other types)

**Similar** means files were matched by visual or acoustic fingerprint - not necessarily bit-for-bit identical. **Identical** means exact same content.

Every row always shows a **type icon** in the first column:
- Images, videos: generated thumbnail (click to open in the default app)
- Audio: play button
- Other files: icon based on category - PDF, archive (zip, rar…), source code, text document (doc, txt, md…), spreadsheet (xls, csv…), presentation, or generic icon

For images, videos, and audio, the row also shows individual **size** and **duration** (videos/audio).`,
    },
  },

  {
    id: "filter-sort",
    sectionId: "results",
    title: { fr: "Filtrer et trier les résultats", en: "Filter and sort results" },
    keywords: {
      fr: ["filtrer", "trier", "chercher", "rechercher", "nom", "chemin", "colonne", "ordre", "tri", "modifié", "date"],
      en: ["filter", "sort", "search", "name", "path", "column", "order", "modified", "date"],
    },
    body: {
      fr: `**Filtrer par nom ou chemin** : saisissez du texte dans le champ "Filtrer par nom ou chemin…" pour n'afficher que les groupes dont au moins un fichier correspond. Le filtre est appliqué en temps réel.

**Trier les colonnes** : dans chaque groupe déplié, cliquez sur **Nom**, **Modifié** ou **Taille** pour trier les fichiers. Premier clic = croissant (↑), deuxième = décroissant (↓), troisième = ordre initial.

**Trier les dossiers** (mode par sous-dossier) : la barre "Trier par" classe les dossiers par espace récupérable (défaut) ou par nom alphabétique.`,
      en: `**Filter by name or path**: type in the "Filter by name or path…" field to show only groups where at least one file matches. The filter applies in real time.

**Sort columns**: inside each expanded group, click **Name**, **Modified**, or **Size** to sort files. First click = ascending (↑), second = descending (↓), third = original order.

**Sort folders** (by-folder mode): the "Sort by" bar orders folders by recoverable space (default) or alphabetically by name.`,
    },
  },

  {
    id: "reveal",
    sectionId: "results",
    title: { fr: "Ouvrir un fichier dans l'explorateur", en: "Reveal a file in explorer" },
    keywords: {
      fr: ["ouvrir", "explorateur", "gestionnaire", "dossier", "révéler", "localiser", "finder", "nautilus", "chemin", "même dossier", "point orange"],
      en: ["open", "explorer", "file manager", "folder", "reveal", "locate", "finder", "nautilus", "path", "same folder", "orange dot"],
    },
    body: {
      fr: `Chaque ligne affiche un **bouton dossier** (icône 📁) à droite du chemin. Cliquez dessus pour ouvrir le dossier contenant ce fichier dans l'explorateur de votre système (Finder sur macOS, Nautilus/Dolphin sur Linux, Explorateur sur Windows).

**Chemin tronqué** : si le chemin est trop long, il est coupé par la gauche - la partie la plus informative (la fin) reste toujours visible. Survolez le chemin pour afficher le chemin complet dans une infobulle.

**Point orange** : quand deux fichiers ou plus du même groupe sont dans le même dossier, un point orange apparaît devant leur chemin. Survolez le point pour lire l'explication.

Cliquer sur la **miniature** d'une image, d'une vidéo ou d'un fichier audio ouvre directement le fichier dans l'application par défaut.`,
      en: `Each row shows a **folder button** (📁 icon) to the right of the path. Click it to open the folder containing the file in your system's file manager (Finder on macOS, Nautilus/Dolphin on Linux, Explorer on Windows).

**Truncated path**: if the path is too long, it is clipped from the left - the most informative part (the end) always stays visible. Hover over the path to see the full path in a tooltip.

**Orange dot**: when two or more files in the same group are in the same folder, an orange dot appears before their path. Hover the dot to read the explanation.

Clicking the **thumbnail** of an image, video, or audio file opens it directly in the default application.`,
    },
  },

  // ── Sélectionner et supprimer ──────────────────────────────────────────────

  {
    id: "manual-select",
    sectionId: "select",
    title: { fr: "Sélection manuelle", en: "Manual selection" },
    keywords: {
      fr: ["sélectionner", "cocher", "case", "checkbox", "clic", "ligne", "tout", "désélectionner", "décocher"],
      en: ["select", "check", "checkbox", "click", "row", "all", "deselect", "uncheck"],
    },
    body: {
      fr: `Cliquez sur n'importe quelle ligne de fichier pour la cocher ou la décocher. La ligne entière est cliquable, pas seulement la case à cocher.

**Tout cocher** : sélectionne automatiquement tous les doublons. Le fichier le plus ancien de chaque groupe (l'"original") n'est jamais coché automatiquement.

**Désélectionner** : efface toute la sélection courante.

**Raccourcis clavier :**

- **Ctrl+A** (ou Cmd+A sur Mac) : équivalent de "Tout cocher"
- **Suppr** : ouvre la boîte de confirmation si des fichiers sont sélectionnés
- **Échap** : ferme la boîte de confirmation`,
      en: `Click any file row to check or uncheck it. The entire row is clickable, not just the checkbox.

**Select all**: automatically checks all duplicates. The oldest file in each group (the "original") is never auto-checked.

**Deselect**: clears the entire current selection.

**Keyboard shortcuts:**

- **Ctrl+A** (or Cmd+A on Mac): equivalent to "Select all"
- **Delete**: opens the confirmation dialog if files are selected
- **Escape**: closes the confirmation dialog`,
    },
  },

  {
    id: "smart-rules",
    sectionId: "select",
    title: { fr: "Règles de sélection automatique", en: "Automatic selection rules" },
    keywords: {
      fr: ["règle", "automatique", "récent", "ancien", "résolution", "taille", "garder", "appliquer", "plus grand", "newest", "oldest"],
      en: ["rule", "automatic", "newest", "oldest", "resolution", "size", "keep", "apply", "largest"],
    },
    body: {
      fr: `Le menu déroulant **"Règle :"** permet de choisir une stratégie, puis de l'appliquer à tous les groupes en cliquant sur **Appliquer**.

- **Garder le plus récent** : coche tout sauf le fichier le plus récemment modifié de chaque groupe.
- **Garder le plus ancien** : coche tout sauf le plus ancien.
- **Garder la plus haute résolution** : conserve l'image ou vidéo avec le plus grand nombre de pixels. Si aucun fichier du groupe n'a de résolution détectable, le groupe est laissé sans sélection.
- **Garder le plus grand fichier** : utile pour l'audio et la vidéo où le fichier le plus lourd est généralement de meilleure qualité.
- **Garder dans le dossier prioritaire** : voir l'article dédié.

La règle ne remplace pas une sélection manuelle - vous pouvez affiner manuellement après avoir appliqué une règle.`,
      en: `The **"Rule:"** dropdown lets you choose a strategy, then click **Apply** to apply it to all groups at once.

- **Keep newest**: checks everything except the most recently modified file in each group.
- **Keep oldest**: checks everything except the oldest.
- **Keep highest resolution**: keeps the image or video with the most pixels. If no file in the group has detectable resolution, the group is left unselected.
- **Keep largest file**: useful for audio and video where the heavier file is usually better quality.
- **Keep in priority folder**: see the dedicated article.

The rule does not replace manual selection - you can fine-tune manually after applying a rule.`,
    },
  },

  {
    id: "priority-folder",
    sectionId: "select",
    title: { fr: "Règle : dossier prioritaire", en: "Rule: priority folder" },
    keywords: {
      fr: ["dossier prioritaire", "priorité", "chemin", "règle", "garder", "conserver", "prioritaire"],
      en: ["priority folder", "priority", "path", "rule", "keep", "preserve"],
    },
    body: {
      fr: `La règle **"Garder dans le dossier prioritaire"** coche tous les fichiers sauf ceux qui se trouvent dans le chemin indiqué.

Saisissez un chemin partiel ou complet dans le champ **"Chemin prioritaire…"** qui apparaît lorsque cette règle est sélectionnée.

**Si plusieurs fichiers sont dans le dossier prioritaire** : seul le plus récent parmi eux est conservé, les autres sont cochés.

**Si aucun fichier n'est dans le dossier prioritaire** : aucun fichier n'est coché dans ce groupe. C'est intentionnel - l'app préfère ne rien sélectionner plutôt que supprimer par erreur.

Le chemin est comparé par inclusion : saisir "Photos importantes" suffit si c'est dans le chemin complet.`,
      en: `The **"Keep in priority folder"** rule checks all files except those located in the specified path.

Enter a partial or full path in the **"Priority path…"** field that appears when this rule is selected.

**If multiple files are in the priority folder**: only the most recent among them is kept, the others are checked.

**If no file is in the priority folder**: no file is checked in that group. This is intentional - the app prefers leaving a group unselected rather than deleting by mistake.

Path matching is by inclusion: typing "Important Photos" is enough if it's part of the full path.`,
    },
  },

  {
    id: "delete",
    sectionId: "select",
    title: { fr: "Supprimer des fichiers", en: "Delete files" },
    keywords: {
      fr: ["supprimer", "corbeille", "confirmation", "sécurité", "récupérer", "annuler", "trash", "poubelle"],
      en: ["delete", "trash", "recycle bin", "confirmation", "safety", "recover", "cancel"],
    },
    body: {
      fr: `Cliquez sur le bouton rouge **"Supprimer N fichier(s) (X Mo)"** pour demander la suppression. Une boîte de confirmation affiche le récapitulatif exact.

**Les fichiers sont envoyés dans la corbeille**, pas supprimés définitivement. Vous pouvez les récupérer depuis la corbeille de votre système d'exploitation tant que vous ne l'avez pas vidée.

Après confirmation, les fichiers supprimés disparaissent des groupes. Les groupes réduits à un seul fichier sont automatiquement retirés de la liste.

Si une erreur survient (fichier déjà absent, permissions insuffisantes), un message s'affiche en haut de l'écran.`,
      en: `Click the red **"Delete N file(s) (X MB)"** button to request deletion. A confirmation dialog shows the exact summary.

**Files are sent to the trash**, not permanently deleted. You can recover them from your system's trash as long as you haven't emptied it.

After confirmation, deleted files disappear from the groups. Groups reduced to a single file are automatically removed from the list.

If an error occurs (file already missing, insufficient permissions), an error message appears at the top of the screen.`,
    },
  },

  // ── Mode par sous-dossier ──────────────────────────────────────────────────

  {
    id: "byfolder-how",
    sectionId: "byfolder",
    title: { fr: "Fonctionnement du mode par sous-dossier", en: "How by-folder mode works" },
    keywords: {
      fr: ["par sous-dossier", "sous-dossier", "indépendant", "séparer", "racine", "premier niveau", "clé"],
      en: ["by subfolder", "subfolder", "independent", "separate", "root", "first level", "key"],
    },
    body: {
      fr: `En mode **"Par sous-dossier"**, les fichiers sont comparés uniquement à l'intérieur de chaque premier niveau de sous-dossier. Les fichiers de dossiers différents ne sont jamais mis en regard.

**Exemple** : si votre dossier contient "Photos/2022/" et "Photos/2023/", les doublons internes à 2022 et à 2023 sont trouvés, mais un fichier présent dans 2022 et 2023 n'est pas signalé.

**Dossier racine** : les fichiers directement à la racine du dossier analysé (sans sous-dossier) sont regroupés sous **"Dossier racine"**.

**Profondeur** : seul le premier niveau compte. "Photos/2022/Vacances/" est traité comme appartenant à "2022", pas à "Vacances".

Ce mode est idéal pour les bibliothèques de photos ou de musique organisées par dossier.`,
      en: `In **"By subfolder"** mode, files are compared only within each first-level subfolder. Files from different folders are never compared.

**Example**: if your folder contains "Photos/2022/" and "Photos/2023/", duplicates within 2022 and within 2023 are found, but a file present in both 2022 and 2023 is not flagged.

**Root folder**: files directly at the root of the scanned folder (no subfolder) are grouped under **"Root folder"**.

**Depth**: only the first level counts. "Photos/2022/Vacation/" is treated as belonging to "2022", not to "Vacation".

This mode is ideal for photo or music libraries organized by folder.`,
    },
  },

  {
    id: "byfolder-nav",
    sectionId: "byfolder",
    title: { fr: "Navigation et chargement lazy", en: "Navigation and lazy loading" },
    keywords: {
      fr: ["dossier", "déplier", "replier", "charger", "plus", "pagination", "tri", "trier", "lazy"],
      en: ["folder", "expand", "collapse", "load", "more", "pagination", "sort", "lazy"],
    },
    body: {
      fr: `Chaque dossier s'affiche comme un en-tête avec le nombre de groupes et l'espace récupérable total. Cliquez pour déplier et charger ses groupes.

**Chargement à la demande** : les groupes d'un dossier ne sont chargés qu'à la première ouverture (spinner bref). Si vous repliez puis redépliez, les données déjà chargées sont réutilisées sans nouvel appel.

**Afficher plus** : si un dossier contient plus de 50 groupes, un bouton "Afficher 50 de plus (X restants)" apparaît en bas.

**Trier les dossiers** : la barre "Trier par" en haut de la liste permet de classer par **Taille récupérable** (défaut) ou par **Nom** alphabétique.`,
      en: `Each folder appears as a header with group count and total recoverable space. Click to expand and load its groups.

**On-demand loading**: a folder's groups are only loaded on first expansion (brief spinner). Collapsing and re-expanding reuses already-loaded data without a new call.

**Show more**: if a folder has more than 50 groups, a "Show 50 more (X remaining)" button appears at the bottom.

**Sort folders**: the "Sort by" bar at the top lets you order by **Wasted space** (default) or alphabetically by **Name**.`,
    },
  },

  // ── Comparateur d'images ───────────────────────────────────────────────────

  {
    id: "comparator-open",
    sectionId: "comparator",
    title: { fr: "Ouvrir et naviguer dans le comparateur", en: "Open and navigate the comparator" },
    keywords: {
      fr: ["comparateur", "comparer", "ouvrir", "images", "bouton comparer", "naviguer", "flèche", "groupe suivant"],
      en: ["comparator", "compare", "open", "images", "compare button", "navigate", "arrow", "next group"],
    },
    body: {
      fr: `Le bouton **"Comparer"** s'affiche dans l'en-tête de chaque groupe d'images similaires. Cliquez-le pour ouvrir le comparateur en plein écran.

**Navigation entre groupes** : utilisez les boutons **◀** et **▶** ou les touches **← →** du clavier pour passer d'un groupe d'images au suivant sans fermer le comparateur.

**Fermer** : bouton **✕** en haut à droite, ou touche **Échap**.`,
      en: `The **"Compare"** button appears in the header of each similar image group. Click it to open the full-screen comparator.

**Navigate between groups**: use the **◀** and **▶** buttons or the keyboard **← →** arrow keys to move between image groups without closing the comparator.

**Close**: **✕** button in the top-right corner, or **Escape** key.`,
    },
  },

  {
    id: "comparator-modes",
    sectionId: "comparator",
    title: { fr: "Modes côte à côte et superposition", en: "Side-by-side and overlay modes" },
    keywords: {
      fr: ["côte à côte", "superposition", "overlay", "slider", "curseur", "gauche", "droite", "onglet", "sélectionner", "garder"],
      en: ["side by side", "overlay", "slider", "left", "right", "tab", "select", "keep"],
    },
    body: {
      fr: `**Mode côte à côte** (défaut) : les deux images sélectionnées s'affichent en parallèle avec leurs métadonnées complètes (dimensions, format, date EXIF, taille, nom de fichier).

**Mode superposition** : cliquez sur le bouton **⧉** pour basculer. Un curseur horizontal vous permet de révéler progressivement l'une ou l'autre image - faites glisser pour comparer les zones de transition.

**Choisir les images affichées** : des onglets en haut de chaque colonne (Gauche / Droite) permettent de sélectionner quel fichier du groupe s'affiche de chaque côté. Vous pouvez ainsi comparer n'importe quelle paire.

**Garder celui-ci** : bouton sous chaque image. Il sélectionne les autres fichiers du groupe (les "doublons" à supprimer) et désélectionne celui-ci - indiquant que c'est le fichier à conserver.

Le bouton **📂** à côté du nom de dossier ouvre le dossier du fichier dans le gestionnaire de fichiers. Le bouton **⏵** à côté du nom du fichier ouvre directement le fichier dans le lecteur système (utile pour comparer dans un lecteur externe sans fermer le comparateur).`,
      en: `**Side-by-side mode** (default): the two selected images are displayed side by side with full metadata (dimensions, format, EXIF date, size, filename).

**Overlay mode**: click the **⧉** button to switch. A horizontal slider lets you progressively reveal one image over the other - drag to compare transition areas.

**Choose displayed images**: tabs at the top of each column (Left / Right) let you select which file from the group appears on each side. You can compare any pair.

**Keep this one**: button below each image. It checks the other files in the group (the "duplicates" to delete) and unchecks this one - indicating this is the file to keep.

The **📂** button next to the folder name opens the file's folder in the file manager. The **⏵** button next to the file name opens the file directly in the system player (useful to compare in an external player without closing the comparator).`,
    },
  },

  // ── Comparateur de vidéos ─────────────────────────────────────────────────

  {
    id: "video-comparator-open",
    sectionId: "video-comparator",
    title: { fr: "Ouvrir le comparateur de vidéos", en: "Open the video comparator" },
    keywords: {
      fr: ["comparateur vidéo", "comparer vidéos", "ouvrir", "bouton comparer", "vidéos similaires"],
      en: ["video comparator", "compare videos", "open", "compare button", "similar videos"],
    },
    body: {
      fr: `Le bouton **"Comparer"** s'affiche dans l'en-tête de chaque groupe de vidéos (similaires ou identiques). Cliquez-le pour ouvrir le comparateur plein écran.

**Deux lecteurs côte à côte** : chaque vidéo s'affiche dans son propre lecteur. Vous pouvez voir les métadonnées sous chaque vidéo : nom, taille, résolution, durée, codec **vidéo** et codec **audio** (avec nombre de canaux). La mention **"aucun son"** apparaît si la piste audio est absente, ce qui permet de détecter qu'une copie a perdu sa bande son.

**Formats lus directement** : \`.mp4\`, \`.webm\`, \`.mov\` (avec H.264/H.265). Les autres conteneurs (\`.flv\`, \`.mkv\`, \`.ts\`, \`.avi\`, \`.wmv\`, \`.asf\`, \`.f4v\`, \`.3gp\`...) sont remuxés à la volée vers \`.mp4\` via ffmpeg quand le codec vidéo est compatible (H.264, H.265, VP9, AV1). Une mention **"Préparation de la vidéo..."** s'affiche pendant l'opération (généralement instantanée car sans réencodage vidéo ni audio).

**Format non lu** (\`.avi\` MPEG-4 ASP / Xvid / DivX, \`.wmv\` WMV2/WMV3, audio AC3 / WMA / Vorbis non compatibles mp4, codecs anciens comme \`vp6f\`...) : un message s'affiche à la place du lecteur. Cliquer sur l'icône **⏵** à côté du nom du fichier dans le footer ouvre le fichier dans le lecteur système (VLC, MPV...). Les métadonnées du footer restent disponibles pour la comparaison.

**Navigation entre groupes** : utilisez les boutons **◀** et **▶** ou les touches **← →** du clavier pour passer d'un groupe au suivant sans fermer le comparateur.

**Fermer** : bouton **✕** en haut à droite, ou touche **Échap**.`,
      en: `The **"Compare"** button appears in the header of each video group (similar or identical). Click it to open the full-screen comparator.

**Two players side by side**: each video is shown in its own player. Metadata below each video: name, size, resolution, duration, **video** codec and **audio** codec (with channel count). The label **"no sound"** appears if the audio track is missing, which helps spotting a copy that lost its soundtrack.

**Directly playable formats**: \`.mp4\`, \`.webm\`, \`.mov\` (with H.264/H.265). Other containers (\`.flv\`, \`.mkv\`, \`.ts\`, \`.avi\`, \`.wmv\`, \`.asf\`, \`.f4v\`, \`.3gp\`...) are remuxed on the fly to \`.mp4\` via ffmpeg when the video codec is compatible (H.264, H.265, VP9, AV1). A **"Preparing video..."** message appears during the operation (usually instant since no video or audio reencoding happens).

**Unsupported format** (\`.avi\` MPEG-4 ASP / Xvid / DivX, \`.wmv\` WMV2/WMV3, AC3 / WMA / Vorbis audio not compatible with mp4, legacy codecs like \`vp6f\`...): a message replaces the player. Click the **⏵** icon next to the file name in the footer to open the file in your system player (VLC, MPV...). Footer metadata stays available for comparison.

**Navigate between groups**: use the **◀** and **▶** buttons or the keyboard **← →** arrow keys to move between video groups without closing the comparator.

**Close**: **✕** button in the top-right corner, or **Escape** key.`,
    },
  },

  {
    id: "video-comparator-sync",
    sectionId: "video-comparator",
    title: { fr: "Lecture synchronisée et scrubbing", en: "Synchronized playback and scrubbing" },
    keywords: {
      fr: ["lecture synchronisée", "play", "pause", "scrubbing", "slider", "timestamp", "avancer", "reculer", "temps"],
      en: ["synchronized playback", "play", "pause", "scrubbing", "slider", "timestamp", "seek", "time"],
    },
    body: {
      fr: `**Contrôles sur la vidéo de gauche** : la barre de lecture native (play/pause, scrubbing, volume) est affichée uniquement sous la vidéo de gauche. La vidéo de droite suit automatiquement.

**Synchronisation automatique** : play, pause et déplacement dans la vidéo de gauche sont immédiatement répercutés sur la droite. La vidéo de droite est muette par défaut pour éviter la superposition du son.

**Onglets de fichiers** : pour les groupes de 3+ fichiers, des onglets en haut (Gauche / Droite) permettent de sélectionner quel fichier s'affiche dans chaque panneau. Changer d'onglet ne modifie pas l'autre panneau.`,
      en: `**Controls on the left video**: the native playback bar (play/pause, scrubbing, volume) is shown only below the left video. The right video follows automatically.

**Automatic synchronization**: play, pause, and seeking in the left video are immediately applied to the right. The right video is muted by default to avoid sound overlap.

**File tabs**: for groups of 3+ files, tabs at the top (Left / Right) let you select which file appears in each panel. Changing one tab does not affect the other.`,
    },
  },

  {
    id: "video-comparator-keep",
    sectionId: "video-comparator",
    title: { fr: "Garder une vidéo et supprimer les autres", en: "Keep a video and delete the others" },
    keywords: {
      fr: ["garder", "supprimer", "conserver", "bouton garder", "cocher", "doublons vidéo"],
      en: ["keep", "delete", "keep this one", "check", "video duplicates"],
    },
    body: {
      fr: `Sous chaque vidéo, le bouton **"Garder celui-ci"** marque les autres fichiers du groupe comme à supprimer et retire ce fichier de la sélection.

Le bouton affiche **"✓ Garder celui-ci"** quand ce fichier est effectivement conservé (tous les autres sont cochés).

Le bouton **📂** à côté du nom de dossier ouvre le dossier du fichier dans le gestionnaire de fichiers. Le bouton **⏵** à côté du nom du fichier ouvre directement le fichier dans le lecteur système (utile pour comparer dans un lecteur externe sans fermer le comparateur).

La suppression effective se fait ensuite depuis la liste principale via le bouton "Supprimer N fichiers". Les fichiers supprimés sont envoyés dans la corbeille - récupérables.`,
      en: `Below each video, the **"Keep this one"** button marks the other files in the group as to be deleted and removes this file from the selection.

The button shows **"✓ Keep this one"** when this file is actually kept (all others are checked).

The **📂** button next to the folder name opens the file's folder in the file manager. The **⏵** button next to the file name opens the file directly in the system player (useful to compare in an external player without closing the comparator).

The actual deletion is done from the main list via the "Delete N files" button. Deleted files are sent to the trash - recoverable.`,
    },
  },

  // ── Groupes ignorés ───────────────────────────────────────────────────────

  {
    id: "audio-comparator-open",
    sectionId: "audio-comparator",
    title: { fr: "Ouvrir le comparateur audio", en: "Open the audio comparator" },
    keywords: {
      fr: ["comparateur", "audio", "comparer", "écouter", "son", "musique", "mp3", "flac"],
      en: ["comparator", "audio", "compare", "listen", "sound", "music", "mp3", "flac"],
    },
    body: {
      fr: `Le bouton **Comparer** apparait dans l'en-tete de chaque groupe audio. Il ouvre le comparateur audio en plein ecran.

Le comparateur affiche les deux fichiers cote a cote avec un lecteur audio pour chacun. Le lecteur de gauche est le **maitre** : appuyer sur lecture, pause ou sauter a un instant synchronise automatiquement le lecteur de droite.

Naviguer entre les groupes avec les boutons **◀ ▶** ou les touches **← →** du clavier.`,
      en: `The **Compare** button appears in the header of each audio group. It opens the audio comparator in full screen.

The comparator shows both files side by side with an audio player for each. The left player is the **master**: pressing play, pause, or seeking automatically synchronises the right player.

Navigate between groups using the **◀ ▶** buttons or the **← →** keyboard shortcuts.`,
    },
  },
  {
    id: "audio-comparator-keep",
    sectionId: "audio-comparator",
    title: { fr: "Garder un fichier depuis le comparateur", en: "Keep a file from the comparator" },
    keywords: {
      fr: ["garder", "supprimer", "choisir", "comparateur", "audio", "conserver"],
      en: ["keep", "delete", "choose", "comparator", "audio", "retain"],
    },
    body: {
      fr: `Cliquer sur **Garder celui-ci** sous le lecteur souhaite : tous les autres fichiers du groupe sont coches pour suppression et le comparateur se ferme.

Les metadonnees sous chaque lecteur (nom du fichier, dossier, taille, duree) permettent de comparer les fichiers avant de choisir.

Le bouton **📂** a cote du dossier ouvre le dossier du fichier dans le gestionnaire de fichiers. Le bouton **⏵** a cote du nom du fichier ouvre directement le fichier dans le lecteur audio systeme.`,
      en: `Click **Keep this one** under the desired player: all other files in the group are checked for deletion and the comparator closes.

The metadata below each player (file name, folder, size, duration) lets you compare files before choosing.

The **📂** button next to the folder path opens the file's folder in the file manager. The **⏵** button next to the file name opens the file directly in the system audio player.`,
    },
  },
  {
    id: "ignore-group",
    sectionId: "ignored",
    title: { fr: "Ignorer un groupe", en: "Ignore a group" },
    keywords: {
      fr: ["ignorer", "✕", "croix", "masquer", "ne plus voir", "exclure", "cacher", "bouton ignorer"],
      en: ["ignore", "✕", "cross", "hide", "exclude", "dismiss", "ignore button"],
    },
    body: {
      fr: `Le bouton **✕** dans l'en-tête d'un groupe permet de l'ignorer. Le groupe disparaît immédiatement de la liste.

**Effet sur les prochains scans** : lors des scans suivants du même dossier, ce groupe n'apparaîtra plus dans les résultats, même si les fichiers sont toujours présents sur le disque.

**Ce qui est mémorisé** : l'ensemble exact des chemins de fichiers du groupe. Si l'un des fichiers est déplacé ou renommé, les chemins changent et le groupe peut réapparaître au prochain scan.

Ignorer ne supprime aucun fichier. C'est une façon de dire "je sais que ces fichiers sont en double, je veux les garder tels quels".`,
      en: `The **✕** button in a group's header ignores it. The group immediately disappears from the list.

**Effect on future scans**: when scanning the same folder again, this group will no longer appear in results, even if the files are still on disk.

**What is remembered**: the exact set of file paths in the group. If one of the files is moved or renamed, the paths change and the group may reappear on the next scan.

Ignoring does not delete any files. It's a way of saying "I know these are duplicates, I want to keep them as-is".`,
    },
  },

  {
    id: "ignore-manage",
    sectionId: "ignored",
    title: { fr: "Gérer la liste d'ignorés", en: "Manage the ignored list" },
    keywords: {
      fr: ["gérer", "liste", "ignorés", "retirer", "effacer", "tout effacer", "panneau ignorés", "restaurer", "global"],
      en: ["manage", "list", "ignored", "remove", "clear", "panel", "restore", "global"],
    },
    body: {
      fr: `Le bouton **"Groupes ignorés"** dans le coin supérieur droit (avec un badge indiquant le nombre d'entrées) ouvre le panneau de gestion.

- **Retirer** : supprime une entrée. Le groupe redeviendra visible au prochain scan.
- **Tout effacer** : supprime toutes les entrées ignorées.

La liste est **globale et persistante** : elle s'applique à tous les scans, quel que soit le dossier. Elle survit aux redémarrages de l'application.

Le panneau est accessible en permanence depuis le header, même sans résultats affichés.`,
      en: `The **"Ignored groups"** button in the top-right corner (with a badge showing the entry count) opens the management panel.

- **Remove**: removes one entry. The group will reappear on the next scan.
- **Clear all**: removes all ignored entries.

The list is **global and persistent**: it applies to all scans, regardless of the folder. It survives application restarts.

The panel is always accessible from the header, even without displayed results.`,
    },
  },

  // ── Profils ────────────────────────────────────────────────────────────────

  {
    id: "profiles",
    sectionId: "profiles",
    title: { fr: "Profils de scan", en: "Scan profiles" },
    keywords: {
      fr: ["profil", "sauvegarder", "charger", "lancer", "configuration", "réutiliser", "favori", "modèle"],
      en: ["profile", "save", "load", "launch", "configuration", "reuse", "favorite", "template"],
    },
    body: {
      fr: `Un profil sauvegarde une configuration complète : dossier, mode de scan, type de détection, seuil de similarité, filtres d'extensions, taille min/max, dossiers exclus et état du cache.

**Sauvegarder** : saisissez un nom dans le champ du panneau **"Mes profils"** et cliquez "Sauvegarder". Un dossier doit être sélectionné.

**Charger** : restaure la configuration dans l'interface sans lancer le scan. Vous pouvez ajuster avant de démarrer.

**Lancer (▶)** : charge la configuration ET démarre immédiatement le scan.

**Supprimer (×)** : retire le profil de la liste. Les fichiers sur le disque ne sont pas affectés.

Les profils sont persistés sur le disque et disponibles entre les sessions.`,
      en: `A profile saves a complete configuration: folder, scan mode, detection type, similarity threshold, extension filters, min/max size, excluded folders, and cache state.

**Save**: enter a name in the **"My profiles"** panel field and click "Save". A folder must be selected.

**Load**: restores the configuration in the UI without launching the scan. You can adjust before starting.

**Launch (▶)**: loads the configuration AND immediately starts the scan.

**Delete (×)**: removes the profile from the list. Files on disk are not affected.

Profiles are persisted on disk and available across sessions.`,
    },
  },

  // ── Filtres ────────────────────────────────────────────────────────────────

  {
    id: "filters-folders-ext",
    sectionId: "filters",
    title: { fr: "Dossiers exclus et extensions", en: "Excluded folders and extensions" },
    keywords: {
      fr: ["filtres", "exclure", "dossier exclu", "extension", "inclure", "tmp", "node_modules", "git", "target", "DS_Store"],
      en: ["filters", "exclude", "excluded folder", "extension", "include", "tmp", "node_modules", "git", "DS_Store"],
    },
    body: {
      fr: `**Dossiers exclus** : les fichiers dans ces dossiers (et leurs sous-dossiers) sont ignorés pendant le scan. Utile pour exclure "node_modules", ".git", "target", les dossiers système, etc. Ajoutez un chemin et appuyez sur Entrée ou cliquez "Ajouter".

**Extensions exclues** : les fichiers avec ces extensions ne sont pas analysés. L'application propose des valeurs par défaut raisonnables ("tmp", "DS_Store", "Thumbs.db"…).

**Extensions incluses** : si renseignée, **seuls** les fichiers avec ces extensions sont analysés. Laissez vide pour tout analyser. Exemple : saisir "jpg, jpeg, png" pour ne traiter que les images JPEG et PNG.

Les extensions sont insensibles à la casse et ne doivent pas inclure le point.`,
      en: `**Excluded folders**: files in these folders (and their subfolders) are skipped. Useful to exclude "node_modules", ".git", "target", system folders, etc. Add a path and press Enter or click "Add".

**Excluded extensions**: files with these extensions are not scanned. The app provides sensible defaults ("tmp", "DS_Store", "Thumbs.db"…).

**Included extensions**: if filled, **only** files with these extensions are scanned. Leave empty to scan everything. Example: type "jpg, jpeg, png" to process only JPEG and PNG images.

Extensions are case-insensitive and should not include the dot.`,
    },
  },

  {
    id: "filters-size",
    sectionId: "filters",
    title: { fr: "Filtre de taille", en: "Size filter" },
    keywords: {
      fr: ["taille", "taille min", "taille max", "ko", "kilooctets", "filtre", "petit", "grand", "limite"],
      en: ["size", "min size", "max size", "kb", "kilobytes", "filter", "small", "large", "limit"],
    },
    body: {
      fr: `Les champs **Taille min** et **Taille max** (en kilo-octets) limitent l'analyse à une plage de tailles.

- **Taille min = 100** : ignore les fichiers de moins de 100 Ko (icônes, fichiers vides…).
- **Taille max = 50000** : ignore les fichiers de plus de 50 Mo.
- **0 = illimité** : la valeur 0 désactive la limite correspondante.

Pratique pour se concentrer sur les gros fichiers (vidéos, archives) et ignorer les petits fichiers de configuration ou les miniatures.`,
      en: `The **Min size** and **Max size** fields (in kilobytes) restrict the scan to a size range.

- **Min size = 100**: ignores files smaller than 100 KB (icons, empty files…).
- **Max size = 50000**: ignores files larger than 50 MB.
- **0 = unlimited**: the value 0 disables the corresponding limit.

Useful for focusing on large files (videos, archives) and skipping small config files or thumbnails.`,
    },
  },

  {
    id: "filters-date",
    sectionId: "filters",
    title: { fr: "Filtre par date de modification", en: "Modification date filter" },
    keywords: {
      fr: ["date", "modification", "modifié", "filtre", "après", "avant", "récent", "ancien", "période"],
      en: ["date", "modification", "modified", "filter", "after", "before", "recent", "old", "period"],
    },
    body: {
      fr: `Les champs **Modifié après** et **Modifié avant** limitent l'analyse aux fichiers dont la date de dernière modification est dans la plage indiquée.

- **Modifié après = 2023-01-01** : ignore les fichiers modifiés avant 2023.
- **Modifié avant = 2024-12-31** : ignore les fichiers modifiés après 2024.
- Laisser un champ vide pour ne pas limiter de ce côté.

Pratique pour analyser uniquement les nouveaux ajouts depuis une date précise, ou pour isoler les fichiers d'une période donnée.`,
      en: `The **Modified after** and **Modified before** fields restrict the scan to files whose last modification date falls within the given range.

- **Modified after = 2023-01-01**: ignores files modified before 2023.
- **Modified before = 2024-12-31**: ignores files modified after 2024.
- Leave a field empty to apply no limit on that side.

Useful for scanning only recent additions since a given date, or for isolating files from a specific time period.`,
    },
  },

  {
    id: "filters-cache",
    sectionId: "filters",
    title: { fr: "Cache des hashes exacts", en: "Exact hash cache" },
    keywords: {
      fr: ["cache", "hash", "exact", "rescan", "accélérer", "mtime", "rapide", "réanalyse", "xxhash"],
      en: ["cache", "hash", "exact", "rescan", "speed up", "mtime", "fast", "re-scan", "xxhash"],
    },
    body: {
      fr: `Le **cache des hashes exacts** mémorise le hash xxhash3 de chaque fichier entre les scans. Lors d'une réanalyse, les fichiers dont la taille et la date de modification n'ont pas changé sont réutilisés depuis le cache sans être relus sur le disque.

Cela accélère considérablement les réanalyses fréquentes de grands dossiers (plusieurs dizaines de milliers de fichiers).

**Invalidation automatique** : si un fichier est modifié (taille ou date change), son hash est recalculé. Le cache ne peut pas retourner un résultat obsolète.

Désactivez cette option si vous suspectez un problème ou pour forcer un scan complet depuis zéro.`,
      en: `The **exact hash cache** remembers each file's xxhash3 between scans. On re-scan, files whose size and modification date haven't changed are reused from cache without being re-read from disk.

This significantly speeds up frequent re-scans of large folders (tens of thousands of files).

**Automatic invalidation**: if a file is modified (size or date changes), its hash is recalculated. The cache cannot return stale results.

Disable this option if you suspect an issue or want to force a complete scan from scratch.`,
    },
  },

  // ── Paramètres avancés ────────────────────────────────────────────────────

  {
    id: "advanced-images",
    sectionId: "advanced",
    title: { fr: "Paramètres avancés - Images", en: "Advanced settings - Images" },
    keywords: {
      fr: ["avancé", "phash", "hash", "gradient", "seuil", "deux passes", "cache phash", "parallèle", "ratio", "aspect", "dev", "métriques", "perf", "exif", "thumbnail", "bucket", "tri"],
      en: ["advanced", "phash", "hash", "gradient", "threshold", "two-pass", "phash cache", "parallel", "ratio", "aspect", "dev", "metrics", "perf", "exif", "thumbnail", "bucket", "sort"],
    },
    body: {
      fr: `Le panneau avancé (accordéon sous le mode Images) expose 8 optimisations du pipeline pHash :

**Filtre de taille** : ignore les images plus petites que X Ko. Évite les faux positifs sur les icônes et miniatures système.

**Filtre de ratio d'aspect** : exclut rapidement les paires d'images aux proportions très différentes (paysage vs portrait). Lecture d'en-tête uniquement - très rapide.

**Hash en 2 passes** : calcule d'abord un hash grossier (empreinte numérique rapide) pour éliminer les paires clairement incompatibles, puis un hash précis seulement sur les candidats restants. Réduit le nombre de décodages d'images complets.

**Cache entre scans** : mémorise les hashes pHash par chemin+mtime en format binaire compact (environ 4x plus petit que JSON). Évite de recalculer à chaque scan. Rétrocompatible avec les anciens caches JSON.

**Comparaison parallèle** : utilise tous les cœurs CPU disponibles pour comparer les hashes en parallèle.

**Décodage rapide (thumbnail EXIF)** : pour les JPEG, utilise le thumbnail embarqué dans les métadonnées EXIF (~160x120 px) pour calculer le hash au lieu de décoder l'image entière. Environ 4x plus rapide. Repli automatique sur le décodage complet si le thumbnail est absent.

**Index par bucket de hash grossier** : regroupe les images par hash grossier identique et ne compare que les images du même groupe. Quasi-linéaire au lieu de O(n²) quand le seuil grossier est 0 (identité exacte).

**Tri par ratio d'aspect** : trie les images par ratio largeur/hauteur et utilise une recherche binaire pour éviter d'itérer les paires dont les proportions sont incompatibles. Élimine ces paires en O(log n) par image.

**Mode développeur** : active deux journaux de débogage. \`phash_perf.jsonl\` enregistre les timings et compteurs de chaque scan similaire (une ligne JSON par scan). \`timing.log\` enregistre les horodatages détaillés de chaque étape du scan en cours (réinitialisé à chaque scan). Les fichiers se trouvent dans le dossier de données de l'application : \`%APPDATA%\\com.yavadeus.deduplicateur\\\` sous Windows, \`~/.local/share/com.yavadeus.deduplicateur/\` sous Linux, \`~/Library/Application Support/com.yavadeus.deduplicateur/\` sous macOS.

**Réinitialiser** : remet toutes les valeurs aux paramètres par défaut optimaux.`,
      en: `The advanced panel (accordion below Images mode) exposes 8 pHash pipeline optimizations:

**Size filter**: skips images smaller than X KB. Prevents false positives from system icons and thumbnails.

**Aspect ratio filter**: quickly excludes image pairs with very different proportions (landscape vs portrait). Header-only read - very fast.

**Two-pass hash**: computes a coarse hash (quick digital fingerprint) first to eliminate clearly incompatible pairs, then a precise hash only for remaining candidates. Reduces the number of full image decodes.

**Inter-scan cache**: remembers pHash hashes by path+mtime in compact binary format (about 4x smaller than JSON). Avoids recomputing on each scan. Backward-compatible with old JSON caches.

**Parallel comparison**: uses all available CPU cores to compare hashes in parallel.

**Fast decoding (EXIF thumbnail)**: for JPEG files, uses the thumbnail embedded in EXIF metadata (~160x120 px) to compute the hash instead of decoding the full image. About 4x faster. Automatically falls back to full decode if the thumbnail is absent.

**Coarse hash bucket index**: groups images by identical coarse hash and only compares images in the same group. Near-linear instead of O(n²) when the coarse threshold is 0 (exact identity).

**Sort by aspect ratio**: sorts images by width/height ratio and uses binary search to avoid iterating pairs with incompatible proportions. Eliminates these pairs in O(log n) per image.

**Developer mode**: enables two debug logs. \`phash_perf.jsonl\` records timings and counters for each similarity scan (one JSON line per scan). \`timing.log\` records detailed timestamps for each step of the current scan (reset on each scan). Files are located in the application data folder: \`%APPDATA%\\com.yavadeus.deduplicateur\\\` on Windows, \`~/.local/share/com.yavadeus.deduplicateur/\` on Linux, \`~/Library/Application Support/com.yavadeus.deduplicateur/\` on macOS.

**Reset**: restores all values to optimal defaults.`,
    },
  },

  {
    id: "advanced-video",
    sectionId: "advanced",
    title: { fr: "Paramètres avancés - Vidéos", en: "Advanced settings - Videos" },
    keywords: {
      fr: ["avancé", "vidéo", "frames", "durée", "tolérance", "cache", "dtw", "alignement temporel", "intro", "générique"],
      en: ["advanced", "video", "frames", "duration", "tolerance", "cache", "dtw", "temporal alignment", "intro", "credits"],
    },
    body: {
      fr: `**Frames par vidéo** (2-30) : nombre d'images extraites par vidéo pour l'empreinte visuelle. Plus il y en a, meilleure est la précision, mais le scan est plus lent. Valeur conseillée : 8.

**Filtre de durée** : deux vidéos dont la durée diffère de plus de X % ne sont pas comparées. Évite les faux positifs entre un extrait court et le film complet.

**Cache entre scans** : mémorise les hashes vidéo par chemin+mtime pour accélérer les réanalyses.

**Alignement temporel (DTW)** : active le Dynamic Time Warping pour mieux aligner les vidéos avec une intro ou un générique de durée variable. Utile pour les émissions enregistrées avec des génériques de longueurs différentes. Légèrement plus lent.`,
      en: `**Frames per video** (2-30): number of frames extracted per video for the visual fingerprint. More frames = better accuracy but slower scan. Recommended value: 8.

**Duration filter**: two videos whose durations differ by more than X% are not compared. Prevents false positives between a short clip and the full movie.

**Inter-scan cache**: remembers video hashes by path+mtime to speed up re-scans.

**Temporal alignment (DTW)**: enables Dynamic Time Warping to better align videos with intros or credits of varying lengths. Useful for TV shows recorded with different-length credit sequences. Slightly slower.`,
    },
  },

  {
    id: "advanced-audio",
    sectionId: "advanced",
    title: { fr: "Paramètres avancés - Audio", en: "Advanced settings - Audio" },
    keywords: {
      fr: ["avancé", "audio", "durée", "tolérance", "cache", "fpcalc", "chromaprint", "empreinte", "acoustique"],
      en: ["advanced", "audio", "duration", "tolerance", "cache", "fpcalc", "chromaprint", "fingerprint", "acoustic"],
    },
    body: {
      fr: `**Filtre de durée** : deux fichiers audio dont la durée diffère de plus de X % ne sont pas comparés. Évite de rapprocher une version longue et une version courte d'un même morceau.

**Cache entre scans** : mémorise les empreintes acoustiques par chemin+mtime pour éviter de relancer fpcalc sur chaque fichier à chaque scan.

L'empreinte acoustique est calculée par **fpcalc** (chromaprint). Si fpcalc n'est pas trouvé, la détection audio est désactivée et un bandeau d'installation s'affiche.`,
      en: `**Duration filter**: two audio files whose durations differ by more than X% are not compared. Prevents matching a long version and a short edit of the same track.

**Inter-scan cache**: remembers acoustic fingerprints by path+mtime to avoid re-running fpcalc on every file on each scan.

The acoustic fingerprint is computed by **fpcalc** (chromaprint). If fpcalc is not found, audio detection is disabled and an installation banner is shown.`,
    },
  },

  // ── Analyses précédentes ──────────────────────────────────────────────────

  {
    id: "sessions",
    sectionId: "sessions",
    title: { fr: "Analyses précédentes", en: "Previous scans" },
    keywords: {
      fr: ["session", "analyse", "précédent", "reprendre", "historique", "sauvegarder", "supprimer", "tag", "cache", "purger", "espace disque"],
      en: ["session", "scan", "previous", "resume", "history", "saved", "delete", "tag", "cache", "purge", "disk space"],
    },
    body: {
      fr: `Chaque scan est automatiquement sauvegardé. Le bouton **"← Mes analyses"** dans la barre d'outils est toujours visible et affiche la liste des analyses précédentes.

**Reprendre** : recharge les résultats d'un scan sans le relancer. Les groupes et statistiques sont restaurés. Les fichiers supprimés entre-temps sont filtrés automatiquement.

**Mise à jour automatique** : quand vous supprimez des fichiers depuis les résultats, la session est mise à jour instantanément (groupes vidés retirés, espace récupérable recalculé). Si vous rechargez une ancienne session, les fichiers absents du disque sont également ignorés.

**Tags** : chaque session affiche les modes utilisés : "par dossier", "récursif", "dossier plat", "similarité images/vidéos/audio", "doublons exacts".

**Date relative** : "à l'instant", "il y a 5 min", "il y a 2 h", "il y a 3 j".

**Supprimer** : retire la session de la liste sans supprimer aucun fichier sur le disque. Les résultats sont définitivement perdus.

**Cache de détection** : en bas de la liste, l'app affiche la taille totale du cache accumulé (hashes pHash, vidéo, audio, exacts). Ce cache accélère les prochains scans mais peut prendre de l'espace disque. Le bouton **"Purger"** le supprime après confirmation - une seule confirmation inline suffit.`,
      en: `Every scan is automatically saved. The **"← My scans"** button in the toolbar is always visible and shows the list of previous scans.

**Resume**: reloads a scan's results without re-running it. Groups and statistics are restored. Files deleted in the meantime are filtered out automatically.

**Automatic update**: when you delete files from the results, the session is updated instantly (empty groups removed, recoverable space recalculated). When you reload an older session, files missing from disk are also filtered out.

**Tags**: each session shows the modes used: "by folder", "recursive", "flat folder", "image/video/audio similarity", "exact duplicates".

**Relative date**: "just now", "5 min ago", "2 h ago", "3 d ago".

**Delete**: removes the session from the list without deleting any files on disk. The results are permanently lost.

**Detection cache**: at the bottom of the list, the app shows the total size of accumulated cache (pHash, video, audio, exact hashes). This cache speeds up future scans but can take up disk space. The **"Purge"** button deletes it after confirmation - a single inline confirmation is enough.`,
    },
  },

  // ── Outils externes ───────────────────────────────────────────────────────

  {
    id: "missing-tools",
    sectionId: "tools",
    title: { fr: "FFmpeg et fpcalc manquants", en: "Missing FFmpeg and fpcalc" },
    keywords: {
      fr: ["ffmpeg", "fpcalc", "chromaprint", "manquant", "introuvable", "installer", "path", "homebrew", "apt", "chocolatey", "bandeau"],
      en: ["ffmpeg", "fpcalc", "chromaprint", "missing", "not found", "install", "path", "homebrew", "apt", "chocolatey", "banner"],
    },
    body: {
      fr: `Si **FFmpeg** n'est pas trouvé, la détection de vidéos similaires est désactivée. Si **fpcalc** (chromaprint) n'est pas trouvé, la détection audio est désactivée. Un bandeau d'installation apparaît avec les instructions selon votre OS.

**Installation :**

- **Linux** : `+"`sudo apt install ffmpeg`"+` / `+"`sudo apt install libchromaprint-tools`"+`
- **macOS** : `+"`brew install ffmpeg`"+` / `+"`brew install chromaprint`"+`
- **Windows** : télécharger depuis les liens officiels fournis dans le bandeau

**Vérifier à nouveau** : après installation, cliquez ce bouton pour tester sans redémarrer l'application. Si l'outil est détecté, un message de confirmation s'affiche et vous pouvez relancer un scan pour activer la détection.

L'application cherche les outils dans le dossier de l'exécutable, dans les chemins système courants (Chocolatey, Scoop, Homebrew, /usr/bin…), puis dans le PATH.`,
      en: `If **FFmpeg** is not found, similar video detection is disabled. If **fpcalc** (chromaprint) is not found, audio detection is disabled. An installation banner appears with OS-specific instructions.

**Installation:**

- **Linux**: `+"`sudo apt install ffmpeg`"+` / `+"`sudo apt install libchromaprint-tools`"+`
- **macOS**: `+"`brew install ffmpeg`"+` / `+"`brew install chromaprint`"+`
- **Windows**: download from the official links provided in the banner

**Check again**: after installing, click this button to test without restarting the application. If the tool is found, a confirmation message appears and you can re-run a scan to enable detection.

The app looks for tools next to the executable, in common system paths (Chocolatey, Scoop, Homebrew, /usr/bin…), then in PATH.`,
    },
  },

  // ── Export et interface ───────────────────────────────────────────────────

  {
    id: "export",
    sectionId: "misc",
    title: { fr: "Exporter les résultats", en: "Export results" },
    keywords: {
      fr: ["export", "csv", "html", "rapport", "exporter", "sauvegarder", "résultats", "tableur", "excel"],
      en: ["export", "csv", "html", "report", "save", "results", "spreadsheet", "excel"],
    },
    body: {
      fr: `Après un scan, deux boutons d'export apparaissent dans la barre de statistiques :

**Export CSV** : génère un fichier tableur listant tous les fichiers détectés avec leur statut ("kept" = à conserver, "duplicate" = doublon), chemin, taille et date de modification. Ouvrable dans Excel, LibreOffice Calc, etc.

**Rapport HTML** : génère une page web autonome (ouvrable dans un navigateur sans connexion internet) avec les statistiques du scan, la liste des groupes cliquables, et des liens `+"`file://`"+` pour ouvrir chaque fichier directement depuis le rapport.

Une boîte de dialogue vous demande où sauvegarder le fichier généré.`,
      en: `After a scan, two export buttons appear in the stats bar:

**Export CSV**: generates a spreadsheet file listing all detected files with their status ("kept" = to keep, "duplicate" = to delete), path, size, and modification date. Opens in Excel, LibreOffice Calc, etc.

**HTML Report**: generates a standalone web page (opens in a browser without internet) with scan statistics, clickable group lists, and `+"`file://`"+` links to open each file directly from the report.

A dialog asks where to save the generated file.`,
    },
  },

  // ── Notifications ─────────────────────────────────────────────────────────

  {
    id: "notifications",
    sectionId: "notif",
    title: { fr: "Notifications de fin de scan", en: "Scan completion notifications" },
    keywords: {
      fr: ["notification", "notifier", "alerte", "fin de scan", "arrière-plan", "système", "toast"],
      en: ["notification", "notify", "alert", "scan complete", "background", "system", "toast"],
    },
    body: {
      fr: `Quand un scan long se termine, l'application envoie une **notification système** (centre de notifications Windows, macOS ou libnotify sur Linux).

La notification affiche :
- Le titre "Analyse terminee"
- Le nombre de groupes trouvés et l'espace récupérable (ex. "42 groupes trouvés - 1.2 GB récupérables")

**Seuil** : la notification n'est envoyée que si le scan a duré **au moins 10 secondes**. Les scans rapides (dossiers petits ou cache chaud) ne déclenchent pas de notification pour ne pas déranger.

La notification utilise la **langue active** de l'interface (FR ou EN) au moment du lancement du scan.

**Permissions** : sur macOS et Linux, aucune permission supplémentaire n'est nécessaire. Sur Windows, la notification apparait dans le centre de notifications de la barre des tâches.`,
      en: `When a long scan finishes, the application sends a **system notification** (Windows Action Center, macOS, or libnotify on Linux).

The notification shows:
- The title "Scan complete"
- The number of groups found and recoverable space (e.g. "42 groups found - 1.2 GB recoverable")

**Threshold**: a notification is only sent if the scan took **at least 10 seconds**. Quick scans (small folders or warm cache) do not trigger a notification so as not to disturb the user.

The notification uses the **active UI language** (FR or EN) at the time the scan was launched.

**Permissions**: on macOS and Linux, no extra permission is required. On Windows, the notification appears in the taskbar notification center.`,
    },
  },

  {
    id: "interface",
    sectionId: "misc",
    title: { fr: "Thème, langue et raccourcis clavier", en: "Theme, language and keyboard shortcuts" },
    keywords: {
      fr: ["thème", "sombre", "clair", "langue", "français", "anglais", "raccourci", "clavier", "ctrl", "suppr", "échap", "f1", "aide"],
      en: ["theme", "dark", "light", "language", "french", "english", "shortcut", "keyboard", "ctrl", "delete", "escape", "f1", "help"],
    },
    body: {
      fr: `**Thème** : cliquez sur **☀** (mode clair) ou **☽** (mode sombre) en haut à droite. Le choix est mémorisé entre les sessions.

**Langue** : boutons **FR** / **EN** pour basculer entre français et anglais. L'interface se met à jour immédiatement.

**Raccourcis clavier :**

- **Ctrl+A** : sélectionne tous les doublons (équivalent "Tout cocher")
- **Suppr** : ouvre la confirmation de suppression si des fichiers sont sélectionnés
- **Échap** : ferme la confirmation de suppression ou le comparateur (images/vidéos/audio)
- **← →** (dans le comparateur) : navigue entre les groupes d'images, de vidéos ou audio
- **F1** ou bouton **?** : ouvre cette aide`,
      en: `**Theme**: click **☀** (light mode) or **☽** (dark mode) in the top-right. The choice is remembered across sessions.

**Language**: **FR** / **EN** buttons to switch between French and English. The interface updates immediately.

**Keyboard shortcuts:**

- **Ctrl+A**: selects all duplicates (equivalent to "Select all")
- **Delete**: opens the deletion confirmation if files are selected
- **Escape**: closes the deletion confirmation or the image/video/audio comparator
- **← →** (in comparator): navigate between image, video or audio groups
- **F1** or **?** button: opens this help`,
    },
  },

  // ── Analyse des archives ──────────────────────────────────────────────────

  {
    id: "archive-scan",
    sectionId: "archives",
    title: { fr: "Analyser les archives", en: "Scan archives" },
    keywords: {
      fr: ["archive", "zip", "tar", "gz", "7z", "archives", "contenu", "doublon", "comparateur"],
      en: ["archive", "zip", "tar", "gz", "7z", "archives", "content", "duplicate", "comparator"],
    },
    body: {
      fr: `**Analyser les archives** est une option disponible en mode **Fichiers**, **Images** et **Audio**. Elle ouvre les archives trouvées dans le dossier analysé et détecte celles dont le contenu est identique (même contenu binaire) ou similaire (en mode Images : pHash perceptuel sur les images internes, utile pour des packs de comics ou de photos ; en mode Audio : empreinte Chromaprint sur les pistes internes, utile pour des collections de samples ou backups iTunes).

**Formats supportés** : \`.zip\`, \`.tar\`, \`.tar.gz\` / \`.tgz\`, \`.tar.bz2\` / \`.tbz2\`, \`.tar.xz\` / \`.txz\`, \`.tar.zst\`, \`.7z\`, \`.cbz\` (Comic Book ZIP, lu comme un ZIP), \`.jar\` / \`.war\` / \`.ear\` (Java, structurellement des ZIP), \`.apk\` (Android) et \`.ipa\` (iOS).

**Formats non supportés** :
- \`.rar\` et \`.cbr\` : format propriétaire de RarLab. La bibliothèque de décompression UnRAR existe mais sa licence est incompatible avec un projet libre. Pour les comics au format CBR, convertir en CBZ (= ZIP) avant scan.
- \`.cab\`, \`.iso\`, \`.dmg\`, \`.deb\`, \`.rpm\` : non gérés (cas niches).

**Archives chiffrées (mot de passe)** : les entrées chiffrées sont **ignorées silencieusement** car non lisibles. Une archive entièrement chiffrée affichera 0 entrée. C'est un comportement attendu, pas un bug.

**Activer l'option** : cochez la case "Analyser les archives" dans la barre de configuration, à côté de l'option "Sous-dossiers".

**Résultats** : les groupes d'archives apparaissent **directement dans la liste de résultats**, classés par espace gaspillé au même titre que les autres doublons. Pas de section séparée. Une carte d'archive ressemble à une carte de fichiers classique :
- En-tête : icône 📦, nombre d'archives, nombre de fichiers en commun et bouton **Comparer**
- Une ligne par archive avec son icône, son nom, sa date, sa taille, le ratio de fichiers dupliqués (ex. 3/5 fichier(s)), son dossier et le badge **Supprimable** si applicable

**Sélection** : la case à cocher n'apparaît que sur les archives **entièrement** dupliquées dans une autre (\`Supprimable\`). Pour les archives partiellement partagées, une icône 🚫 s'affiche à la place avec une infobulle qui rappelle qu'on ne peut pas supprimer un fichier individuellement à l'intérieur d'une archive.

**Comparateur d'archives** : cliquez sur **Comparer** pour ouvrir le comparateur plein écran. La liste affiche les entrées **face à face** sur 3 colonnes : à gauche le contenu de l'archive A (taille à gauche, miniature à droite côté centre), au centre le **score de correspondance** (\`100%\` pour un doublon exact, ou un pourcentage de similarité pour les images proches), à droite le contenu de l'archive B (miniature à gauche côté centre, taille à droite). Le comparateur applique le **même seuil de similarité** que celui configuré lors du scan : si le slider était à 100%, seuls les doublons exacts sont appariés et les images "presque identiques" apparaissent comme entrées isolées dans leurs colonnes respectives. Une case **"Doublons uniquement"** masque les entrées non partagées. En bas de l'écran, un bloc de méta par archive affiche le nom, le dossier, la taille, la date et le ratio entrées dupliquées/total.

**Miniatures et lecteur audio dans le comparateur** : pour les entrées image, une **miniature** remplace l'icône de type de fichier (chargement paresseux à la volée quand la ligne entre dans la zone visible, extraction en mémoire + redimensionnement JPEG base64). **Cliquer sur une miniature** ouvre l'image dans le viewer par défaut du système. Pour les entrées audio (mode Audio), un **bouton play** remplace l'icône : au clic, l'entrée est extraite vers un fichier temporaire et lue inline via un lecteur HTML5 (la lecture utilise le media server HTTP local). Dans tous les cas, l'extraction crée un fichier temporaire dans le sous-dossier \`archive_preview/\` du dossier de données de l'app, et ces fichiers sont **purgés automatiquement** au prochain démarrage.

**Supprimer** : utilisez la barre d'outils standard (\`Supprimer N fichiers\`) après avoir coché les archives supprimables. La suppression envoie le fichier dans la corbeille (récupérable).`,
      en: `**Scan archives** is an option available in **Files**, **Images** and **Audio** modes. It opens archives found in the scanned folder and detects those whose content is identical (same binary content) or similar (in Images mode: perceptual pHash on internal images, useful for comic packs or photo archives ; in Audio mode: Chromaprint fingerprint on internal tracks, useful for sample collections or iTunes backups).

**Supported formats**: \`.zip\`, \`.tar\`, \`.tar.gz\` / \`.tgz\`, \`.tar.bz2\` / \`.tbz2\`, \`.tar.xz\` / \`.txz\`, \`.tar.zst\`, \`.7z\`, \`.cbz\` (Comic Book ZIP, read as ZIP), \`.jar\` / \`.war\` / \`.ear\` (Java, structurally ZIPs), \`.apk\` (Android) and \`.ipa\` (iOS).

**Unsupported formats**:
- \`.rar\` and \`.cbr\`: proprietary format from RarLab. The UnRAR decompression library exists but its license is incompatible with a free/open-source project. For CBR comics, convert to CBZ (= ZIP) before scanning.
- \`.cab\`, \`.iso\`, \`.dmg\`, \`.deb\`, \`.rpm\`: not handled (niche cases).

**Password-encrypted archives**: encrypted entries are **silently ignored** since they can't be read. A fully encrypted archive will show 0 entries. This is expected behavior, not a bug.

**Enable the option**: check the "Scan archives" checkbox in the configuration bar, next to the "Subfolders" option.

**Results**: archive groups appear **directly in the results list**, sorted by wasted space alongside regular duplicates. No separate section. An archive card looks like a regular file card:
- Header: 📦 icon, archive count, shared file count and a **Compare** button
- One row per archive with its icon, name, date, size, ratio of duplicated files (e.g. 3/5 file(s)), folder and a **Deletable** badge when applicable

**Selection**: the checkbox only appears on archives **fully** duplicated in another one (\`Deletable\`). Partially shared archives show a 🚫 icon with a tooltip reminding that files inside an archive can't be deleted individually.

**Archive comparator**: click **Compare** to open the full-screen comparator. Entries are displayed **face to face** in a 3-column layout: archive A on the left (size on the outer edge, thumbnail on the inner edge), the **match score** in the center (\`100%\` for an exact duplicate, or a similarity percentage for close images), archive B on the right (thumbnail on the inner edge, size on the outer edge). The comparator uses the **same similarity threshold** as the one set when running the scan: if the slider was at 100%, only exact duplicates are paired and "near-identical" images appear as isolated entries in their respective columns. A **"Duplicates only"** checkbox hides non-shared entries. At the bottom of the screen, a meta block per archive shows name, folder, size, date and duplicated/total entry ratio.

**Thumbnails and audio player in the comparator**: for image entries, a **thumbnail** replaces the file-type icon (lazy loading on-the-fly when the row enters the visible area, in-memory extraction + JPEG base64 resize). **Clicking on a thumbnail** opens the image in the system's default viewer. For audio entries (Audio mode), a **play button** replaces the icon: on click, the entry is extracted into a temporary file and played inline via an HTML5 player (playback uses the local HTTP media server). In all cases, extraction creates a temp file in the \`archive_preview/\` subfolder of the app data directory, and these files are **automatically purged** at the next app launch.

**Delete**: use the standard toolbar (\`Delete N files\`) after checking deletable archives. Deletion sends the file to the trash (recoverable).`,
    },
  },
];
