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
  { id: "ignored",    title: { fr: "Groupes ignorés",               en: "Ignored groups" } },
  { id: "profiles",   title: { fr: "Profils de scan",               en: "Scan profiles" } },
  { id: "filters",    title: { fr: "Filtres",                       en: "Filters" } },
  { id: "advanced",   title: { fr: "Paramètres avancés",            en: "Advanced settings" } },
  { id: "sessions",   title: { fr: "Analyses précédentes",          en: "Previous scans" } },
  { id: "tools",      title: { fr: "Outils externes",               en: "External tools" } },
  { id: "misc",       title: { fr: "Export et interface",           en: "Export and interface" } },
  { id: "notif",      title: { fr: "Notifications",                 en: "Notifications" } },
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

The selected path is shown in the selection area. The scan does not start automatically — click **Scan** to launch.`,
    },
  },

  {
    id: "scan-mode",
    sectionId: "start",
    title: { fr: "Modes de scan", en: "Scan modes" },
    keywords: {
      fr: ["mode", "scan", "tout", "dossier", "sous-dossier", "récursif", "par dossier", "plat", "flat"],
      en: ["mode", "scan", "entire", "folder", "subfolder", "recursive", "by folder", "flat"],
    },
    body: {
      fr: `**Tout le dossier** : compare tous les fichiers ensemble, quel que soit leur sous-dossier. Idéal pour trouver des doublons dispersés dans une arborescence entière.

**Par sous-dossier** : analyse chaque premier niveau de sous-dossier séparément. Les fichiers de dossiers différents ne sont jamais comparés entre eux. Utile pour nettoyer des photos organisées par année ou par événement.

**Sous-dossiers (récursif)** : en mode "Tout le dossier", cette option inclut les sous-dossiers de façon récursive. Désactivée, seul le niveau de surface est analysé. Cette option est automatiquement forcée en mode "Par sous-dossier".`,
      en: `**Entire folder**: compares all files together, regardless of subfolder. Best for finding duplicates scattered across a full directory tree.

**By subfolder**: analyzes each first-level subfolder independently. Files from different folders are never compared. Useful for cleaning photos organized by year or event.

**Subfolders (recursive)**: in "Entire folder" mode, this option includes subfolders recursively. When disabled, only the top-level directory is scanned. This option is automatically forced in "By subfolder" mode.`,
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
      fr: ["analyser", "lancer", "démarrer", "annuler", "arrêter", "progression", "barre", "durée", "estimation", "temps", "partiel"],
      en: ["scan", "launch", "start", "cancel", "stop", "progress", "bar", "duration", "estimate", "time", "partial"],
    },
    body: {
      fr: `Cliquez sur **Analyser** pour démarrer. Le bouton est grisé si aucun dossier n'est sélectionné.

Pendant l'analyse, une barre de progression indique le nombre de fichiers traités et le total. Une estimation du temps restant s'affiche après quelques secondes : "environ 2 min", "presque fini"…

La première phase **"Collecte des fichiers…"** (sans barre de progression) peut durer quelques secondes sur les très grands dossiers.

**Annuler** : cliquez sur le bouton "Annuler" pour interrompre le scan. Les groupes déjà trouvés sont conservés et affichés avec un bandeau orange **"Résultats partiels"**. Vous pouvez supprimer des fichiers même sur des résultats partiels.`,
      en: `Click **Scan** to start. The button is grayed out if no folder is selected.

During the scan, a progress bar shows processed files vs. total. A time estimate appears after a few seconds: "about 2 min", "almost done"…

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

**Badge "original"** : le premier fichier de chaque groupe reçoit ce badge. C'est une convention d'affichage — tous les fichiers du groupe sont techniquement équivalents.

**Espace en double** : affiché en haut à droite de chaque groupe. C'est l'espace récupéré en ne gardant qu'un seul exemplaire : (nombre de fichiers − 1) × taille.

**Taille récupérable totale** : affichée en rouge dans la barre de statistiques. C'est la somme de l'espace récupérable de tous les groupes.

Cliquez sur l'en-tête d'un groupe **(▾/▸)** pour le déplier ou replier.`,
      en: `Results are organized in **groups**: each group contains identical or similar files.

**"Original" badge**: the first file in each group gets this badge. This is a display convention — all files in the group are technically equivalent.

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
      fr: ["icône", "type", "image", "vidéo", "audio", "similaire", "identique", "vignette", "miniature", "durée", "taille"],
      en: ["icon", "type", "image", "video", "audio", "similar", "identical", "thumbnail", "duration", "size"],
    },
    body: {
      fr: `L'en-tête de chaque groupe affiche une icône et une description selon le type détecté :

- 🖼 **X images similaires / identiques**
- 🎬 **X vidéos similaires / identiques**
- 🎵 **X fichiers audio similaires / identiques**
- **X fichiers identiques** (autres types)

**Similaires** signifie que les fichiers ont été rapprochés par empreinte visuelle ou acoustique — pas forcément identiques bit à bit. **Identiques** signifie même contenu exact.

Pour les images, vidéos et fichiers audio, chaque ligne affiche une **miniature** cliquable (ouvre le fichier dans l'application par défaut), la **taille** individuelle et la **durée** (vidéos/audio). Les fichiers génériques n'affichent que le nom, la date et le dossier.`,
      en: `Each group header shows an icon and description based on the detected type:

- 🖼 **X similar / identical images**
- 🎬 **X similar / identical videos**
- 🎵 **X similar / identical audio files**
- **X identical files** (other types)

**Similar** means files were matched by visual or acoustic fingerprint — not necessarily bit-for-bit identical. **Identical** means exact same content.

For images, videos, and audio, each row shows a clickable **thumbnail** (opens in the default system app), individual **size**, and **duration** (videos/audio). Generic files only show name, date, and folder.`,
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
      fr: ["ouvrir", "explorateur", "gestionnaire", "dossier", "révéler", "↗", "localiser", "finder", "nautilus"],
      en: ["open", "explorer", "file manager", "folder", "reveal", "↗", "locate", "finder", "nautilus"],
    },
    body: {
      fr: `Chaque ligne de fichier affiche un bouton **↗** à droite du chemin de dossier. Cliquez dessus pour ouvrir le dossier contenant ce fichier dans l'explorateur de fichiers de votre système (Finder sur macOS, Nautilus/Dolphin sur Linux, Explorateur sur Windows).

Cliquer sur la **miniature** d'une image, d'une vidéo ou d'un fichier audio ouvre directement le fichier dans l'application par défaut associée à ce type.`,
      en: `Each file row shows a **↗** button to the right of the folder path. Click it to open the folder containing the file in your system's file manager (Finder on macOS, Nautilus/Dolphin on Linux, Explorer on Windows).

Clicking the **thumbnail** of an image, video, or audio file opens it directly in the default application associated with that file type.`,
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

**Tout cocher** : sélectionne automatiquement tous les doublons. Le premier fichier de chaque groupe (l'"original") n'est jamais coché automatiquement.

**Désélectionner** : efface toute la sélection courante.

**Raccourcis clavier :**

- **Ctrl+A** (ou Cmd+A sur Mac) : équivalent de "Tout cocher"
- **Suppr** : ouvre la boîte de confirmation si des fichiers sont sélectionnés
- **Échap** : ferme la boîte de confirmation`,
      en: `Click any file row to check or uncheck it. The entire row is clickable, not just the checkbox.

**Select all**: automatically checks all duplicates. The first file in each group (the "original") is never auto-checked.

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

La règle ne remplace pas une sélection manuelle — vous pouvez affiner manuellement après avoir appliqué une règle.`,
      en: `The **"Rule:"** dropdown lets you choose a strategy, then click **Apply** to apply it to all groups at once.

- **Keep newest**: checks everything except the most recently modified file in each group.
- **Keep oldest**: checks everything except the oldest.
- **Keep highest resolution**: keeps the image or video with the most pixels. If no file in the group has detectable resolution, the group is left unselected.
- **Keep largest file**: useful for audio and video where the heavier file is usually better quality.
- **Keep in priority folder**: see the dedicated article.

The rule does not replace manual selection — you can fine-tune manually after applying a rule.`,
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

**Si aucun fichier n'est dans le dossier prioritaire** : aucun fichier n'est coché dans ce groupe. C'est intentionnel — l'app préfère ne rien sélectionner plutôt que supprimer par erreur.

Le chemin est comparé par inclusion : saisir "Photos importantes" suffit si c'est dans le chemin complet.`,
      en: `The **"Keep in priority folder"** rule checks all files except those located in the specified path.

Enter a partial or full path in the **"Priority path…"** field that appears when this rule is selected.

**If multiple files are in the priority folder**: only the most recent among them is kept, the others are checked.

**If no file is in the priority folder**: no file is checked in that group. This is intentional — the app prefers leaving a group unselected rather than deleting by mistake.

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

**Mode superposition** : cliquez sur le bouton **⧉** pour basculer. Un curseur horizontal vous permet de révéler progressivement l'une ou l'autre image — faites glisser pour comparer les zones de transition.

**Choisir les images affichées** : des onglets en haut de chaque colonne (Gauche / Droite) permettent de sélectionner quel fichier du groupe s'affiche de chaque côté. Vous pouvez ainsi comparer n'importe quelle paire.

**Garder celui-ci** : bouton sous chaque image. Il sélectionne les autres fichiers du groupe (les "doublons" à supprimer) et désélectionne celui-ci — indiquant que c'est le fichier à conserver.`,
      en: `**Side-by-side mode** (default): the two selected images are displayed side by side with full metadata (dimensions, format, EXIF date, size, filename).

**Overlay mode**: click the **⧉** button to switch. A horizontal slider lets you progressively reveal one image over the other — drag to compare transition areas.

**Choose displayed images**: tabs at the top of each column (Left / Right) let you select which file from the group appears on each side. You can compare any pair.

**Keep this one**: button below each image. It checks the other files in the group (the "duplicates" to delete) and unchecks this one — indicating this is the file to keep.`,
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

**Deux lecteurs côte à côte** : chaque vidéo s'affiche dans son propre lecteur. Vous pouvez voir les métadonnées sous chaque vidéo : nom, taille, résolution, durée, codec.

**Navigation entre groupes** : utilisez les boutons **◀** et **▶** ou les touches **← →** du clavier pour passer d'un groupe au suivant sans fermer le comparateur.

**Fermer** : bouton **✕** en haut à droite, ou touche **Échap**.`,
      en: `The **"Compare"** button appears in the header of each video group (similar or identical). Click it to open the full-screen comparator.

**Two players side by side**: each video is shown in its own player. Metadata is displayed below each video: name, size, resolution, duration, codec.

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
      fr: `**Play/Pause** : le bouton ▶/⏸ dans la barre de scrubbing lance ou met en pause les deux vidéos simultanément. Appuyer Play sur l'une des vidéos synchronise automatiquement l'autre.

**Barre de scrubbing commune** : le curseur en bas du comparateur permet de naviguer dans les deux vidéos en même temps. Faites glisser pour sauter à un timestamp précis sur les deux lecteurs simultanément.

**Synchronisation de la lecture** : quand une vidéo joue ou est mise en pause, l'autre suit automatiquement. Quand vous cherchez une position dans l'une, l'autre saute au même timestamp.

**Onglets de fichiers** : pour les groupes de 3+ fichiers, des onglets en haut (Gauche / Droite) permettent de sélectionner quel fichier s'affiche dans chaque panneau.`,
      en: `**Play/Pause**: the ▶/⏸ button in the scrubbing bar starts or pauses both videos simultaneously. Pressing play on one video automatically synchronizes the other.

**Common scrubbing bar**: the slider at the bottom of the comparator navigates both videos at the same time. Drag to jump to a specific timestamp on both players simultaneously.

**Playback synchronization**: when one video plays or pauses, the other follows automatically. When you seek a position in one, the other jumps to the same timestamp.

**File tabs**: for groups of 3+ files, tabs at the top (Left / Right) let you select which file appears in each panel.`,
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

La suppression effective se fait ensuite depuis la liste principale via le bouton "Supprimer N fichiers". Les fichiers supprimés sont envoyés dans la corbeille - récupérables.`,
      en: `Below each video, the **"Keep this one"** button marks the other files in the group as to be deleted and removes this file from the selection.

The button shows **"✓ Keep this one"** when this file is actually kept (all others are checked).

The actual deletion is done from the main list via the "Delete N files" button. Deleted files are sent to the trash - recoverable.`,
    },
  },

  // ── Groupes ignorés ───────────────────────────────────────────────────────

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
      fr: ["avancé", "phash", "hash", "gradient", "seuil", "deux passes", "cache phash", "parallèle", "ratio", "aspect", "dev", "métriques", "perf"],
      en: ["advanced", "phash", "hash", "gradient", "threshold", "two-pass", "phash cache", "parallel", "ratio", "aspect", "dev", "metrics", "perf"],
    },
    body: {
      fr: `Le panneau avancé (accordéon sous le mode Images) expose 5 optimisations du pipeline pHash :

**Filtre de taille** : ignore les images plus petites que X Ko. Évite les faux positifs sur les icônes et miniatures système.

**Filtre de ratio d'aspect** : exclut rapidement les paires d'images aux proportions très différentes (paysage vs portrait). Lecture d'en-tête uniquement — très rapide.

**Hash en 2 passes** : calcule d'abord un hash grossier (rapide), puis un hash fin seulement pour les paires prometteuses. Réduit le nombre de décodages d'images complets.

**Cache entre scans** : mémorise les hashes pHash par chemin+mtime. Évite de recalculer à chaque scan.

**Comparaison parallèle** : utilise tous les cœurs disponibles pour la phase de comparaison.

**Mode développeur** : enregistre les timings de chaque phase dans \`phash_perf.jsonl\` pour le débogage de performance.

**Réinitialiser** : remet toutes les valeurs aux paramètres par défaut optimaux.`,
      en: `The advanced panel (accordion below Images mode) exposes 5 pHash pipeline optimizations:

**Size filter**: skips images smaller than X KB. Prevents false positives from system icons and thumbnails.

**Aspect ratio filter**: quickly excludes image pairs with very different proportions (landscape vs portrait). Header-only read — very fast.

**Two-pass hash**: computes a coarse hash first (fast), then a fine hash only for promising pairs. Reduces the number of full image decodes.

**Inter-scan cache**: remembers pHash values by path+mtime. Avoids recomputing on each scan.

**Parallel comparison**: uses all available CPU cores for the comparison phase.

**Developer mode**: records per-phase timings in \`phash_perf.jsonl\` for performance debugging.

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
      fr: ["session", "analyse", "précédent", "reprendre", "historique", "sauvegarder", "supprimer", "tag"],
      en: ["session", "scan", "previous", "resume", "history", "saved", "delete", "tag"],
    },
    body: {
      fr: `Chaque scan est automatiquement sauvegardé. Le bouton **"← Mes analyses"** (visible après un scan) affiche la liste des analyses précédentes.

**Reprendre** : recharge les résultats d'un scan sans le relancer. Groupes et statistiques sont restaurés tels quels.

**Tags** : chaque session affiche les modes utilisés : "par dossier", "récursif", "dossier plat", "similarité images/vidéos/audio", "doublons exacts".

**Date relative** : "à l'instant", "il y a 5 min", "il y a 2 h", "il y a 3 j".

**Supprimer** : retire la session de la liste sans supprimer aucun fichier sur le disque. Les résultats sont définitivement perdus.`,
      en: `Every scan is automatically saved. The **"← My scans"** button (visible after a scan) shows the list of previous scans.

**Resume**: reloads a scan's results without re-running it. Groups and statistics are restored as-is.

**Tags**: each session shows the modes used: "by folder", "recursive", "flat folder", "image/video/audio similarity", "exact duplicates".

**Relative date**: "just now", "5 min ago", "2 h ago", "3 d ago".

**Delete**: removes the session from the list without deleting any files on disk. The results are permanently lost.`,
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
- **Échap** : ferme la confirmation de suppression ou le comparateur (images/vidéos)
- **← →** (dans le comparateur) : navigue entre les groupes d'images ou de vidéos
- **F1** ou bouton **?** : ouvre cette aide`,
      en: `**Theme**: click **☀** (light mode) or **☽** (dark mode) in the top-right. The choice is remembered across sessions.

**Language**: **FR** / **EN** buttons to switch between French and English. The interface updates immediately.

**Keyboard shortcuts:**

- **Ctrl+A**: selects all duplicates (equivalent to "Select all")
- **Delete**: opens the deletion confirmation if files are selected
- **Escape**: closes the deletion confirmation or the image/video comparator
- **← →** (in comparator): navigate between image or video groups
- **F1** or **?** button: opens this help`,
    },
  },
];
