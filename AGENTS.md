# Deduplicateur

Programme Windows de détection et suppression de fichiers en double.

## Règle impérative - Publication d'une release

**Une release n'est jamais complète sans :**
1. **Bump de version** synchronisé dans les 4 fichiers : `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` (entrée `name = "deduplicateur"`), `src-tauri/tauri.conf.json`. Oublier l'un des quatre fait diverger le numéro affiché dans l'app et dans les artefacts CI.
2. **Entrée `CHANGELOG.md`** au format "Keep a Changelog" avec les sections `Added`, `Changed`, `Fixed`, `Documentation`, `Quality` selon les changements, et le lien `[X.Y.Z]: https://github.com/JulienMattiussi/deduplicateur/releases/tag/vX.Y.Z` en bas.
3. **Tag annoté `vX.Y.Z`** avec message `"Release X.Y.Z - <tagline>"` (cf. tags v1.0.0 et v1.1.0 pour le format). La tagline est courte (3-7 mots), résume le thème principal de la release.
4. **Body de la release GitHub** rédigé manuellement après le push du tag (la CI n'attache que les fichiers, elle ne définit ni nom ni body). Sans ça, la release s'affiche `v1.1.1` au lieu de `Déduplicateur 1.1.1`, body vide.

**Template du body de release** (modélisé sur v1.1.0 et v1.1.1) :
```
## Déduplicateur X.Y.Z - <tagline identique à celle du tag>

<paragraphe FR (1-3 phrases) résumant le thème>
<paragraphe EN équivalent>

---

### 🇫🇷 Au programme
- <bullets : un par feature ou groupe de features, gras sur le nom court, description après>

### 🇬🇧 What's new
- <miroir EN strict des bullets FR>

---

### Downloads
<intro 2 lignes sur light vs full>

| OS | light | full |
|----|-------|------|
| Windows | `Deduplicateur_X.Y.Z_x64-setup.exe` / `.msi` | `Deduplicateur-full_X.Y.Z_x64-setup.exe` / `.msi` |
| Linux   | `Deduplicateur_X.Y.Z_amd64.AppImage` / `.deb` | `Deduplicateur-full_X.Y.Z_amd64.AppImage` / `.deb` |

### Install notes
> **Windows** : SmartScreen...
> **Linux** : ffmpeg / fpcalc dans le PATH + libmpv2 pour le lecteur natif vidéo...
(macOS uniquement si la release builds macOS - cf. v1.1.0)

### Under the hood
<Rust + Tauri 2, X tests Rust (+N depuis Y.Y.Y), React 18 + TS, Y tests TypeScript (+M), thèmes techniques pertinents>

### Full changelog
See [CHANGELOG.md](https://github.com/JulienMattiussi/deduplicateur/blob/main/CHANGELOG.md) for the complete list.
```

**Process en commandes** (après `chore: release X.Y.Z` commité et poussé sur main) :
```bash
git tag -a vX.Y.Z -m "Release X.Y.Z - <tagline>"
git push origin vX.Y.Z
# Attendre que la CI ait attaché les fichiers (~6-7 min, vérifier avec `gh run list`)
gh release edit vX.Y.Z --title "Déduplicateur X.Y.Z"
# Rédiger le body dans un fichier temp puis :
gh release edit vX.Y.Z --notes-file /tmp/release-X.Y.Z-notes.md
```

**À retenir** :
- La CI (`.github/workflows/build.yml`) n'a délibérément pas de `name:` ni `body:` dans `softprops/action-gh-release` pour les tags : on garde la rédaction manuelle (FR + EN, table downloads, install notes spécifiques à la release).
- Le test count (`X unit tests`) cité dans le body doit correspondre au count réel après les ajouts de la release : `cargo test ... | grep "^test result"` somme ce qui sort.
- Si la rolling release `latest` était à jour avec le précédent main, la CI la rebuild aussi sur ce push (pas besoin d'action manuelle). Le tag, lui, crée une release dédiée séparée.

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

### 3bis. Documentation d'aide intégrée (`src/help/content.ts`)

**Toute feature visible par l'utilisateur doit être documentée dans `src/help/content.ts` en même temps qu'elle est implémentée.**

Procéder dans cet ordre :

1. **Articles existants à mettre à jour** - pour chaque composant modifié, lister les articles qui couvrent les features utilisant ce composant et les mettre à jour. Attention aux composants partagés : modifier `MetaBlockBase`, `GroupCard` ou `FiltersPanel` impacte plusieurs articles en même temps. Grep `src/help/content.ts` pour les mots-clés du composant modifié.
2. **Nouveaux articles** - si le comportement introduit n'est couvert par aucun article existant, en créer un.
3. **Format** : `**gras**`, \`code\`, `- bullets`, `\n\n` comme séparateur de blocs. Les backticks dans les template literals doivent être échappés (`\\\``).
4. **Bilingue** : tout article nouveau ou modifié doit avoir ses champs `title`, `keywords` et `body` en FR et EN.

- [ ] Tous les articles couvrant des features affectées par ce changement ont été relus et mis à jour si nécessaire (pas seulement les articles nouveaux).
- [ ] Les articles nouveaux respectent le format et sont bilingues.

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

## Règle impérative - Vision d'ensemble avant patch local

**Quand un retour utilisateur signale un problème UX, ne PAS patcher localement le symptôme.**
Toujours :
1. Comprendre l'architecture concernée et **relire les principes établis** (ce fichier, design existant)
2. Identifier la cause racine (souvent un principe brisé en amont, pas le bug visible)
3. Proposer un fix qui **restaure le principe**, pas qui empile un cataplasme

**Symptômes typiques de patches locaux empilés** : conditions ad-hoc multipliées, valeurs gelées/trompées pour faire croire à un état, hacks `Math.min/max` côté affichage pour cacher des incohérences backend.

Quand l'utilisateur dit "tu casses ce qui marchait avant", c'est probablement parce qu'on a violé un principe sans le réaliser. Faire un état des lieux honnête, regarder l'historique git si besoin, et **revenir au design**.

## Règle impérative - Sémantique de la progression de scan (`scan:progress`)

L'événement `scan:progress` a une sémantique stricte que **toutes les phases doivent respecter** :

| Champ | Sémantique stricte |
|---|---|
| `current` | Position absolue dans `total_work`. **Strictement monotone croissant** sur toute la durée du scan. JAMAIS reset, JAMAIS gelé. Sert au heartbeat affiché ("X opérations traitées") et au calcul d'ETA. |
| `total` | `total_work` calculé **upfront** au début du scan (somme des estimations de toutes les phases). Fixé une fois pour toutes, **jamais modifié dynamiquement** pendant le scan. |
| `phase` | Identifiant de la phase actuelle (`reading`, `counting_archives`, `exact`, `images`, `videos`, `audio`, `archives`, `archives_phash`, `archives_audio`). Change uniquement aux transitions. |
| `phase_current` / `phase_total` | Compteur LOCAL à la phase ("1234 / 5000 images"). |
| `file` | Nom du fichier en cours de traitement. **Toujours rempli** en pleine phase (sinon la zone affichée saute). |

**Modèle d'implémentation** (`scanner/mod.rs`) :
- `total_work` = somme exacte des **emits maximum** par phase, pas du nombre d'items. Constantes par phase : `EMITS_EXACT=1`, `EMITS_IMAGES=3` (decode + hash compute si cache froid + compare outer), `EMITS_VIDEOS=2`, `EMITS_AUDIO=2`, `EMITS_ARCH_P1=1`, `EMITS_ARCH_P2=2` (extraction + pHash images), `EMITS_ARCH_AUDIO=2` (extraction + fpcalc, matching silencieux ; mutuellement exclusif avec `EMITS_ARCH_P2` selon le mode Image/Audio). **Doivent rester alignées avec le code des phases** : toute modification d'une phase qui change le nombre d'`on_progress` par item (ajout d'une sous-phase qui émet, suppression d'une, conditionnelle, etc.) doit s'accompagner d'une mise à jour de la constante. Sinon : sur-estimation → barre stagne ; sous-estimation → barre atteint 100% trop tôt.
- Compteur global atomique `progress_counter` partagé entre toutes les phases via un wrapper `wrapped_on_progress` qui ignore le `current` calculé localement et utilise `pc.fetch_add(1)` à la place. Garantit l'incrément +1 par emit, peu importe la sous-phase ou le parallélisme rayon.
- Sync de fin de phase (`sync_to(budget_after_X)`) qui force le compteur à la frontière exacte du budget cumulé via `fetch_max`. Rattrape les emits manquants (cache warm, exclusions par filtre, matching silencieux d'archives Phase 2). Ne peut JAMAIS faire reculer le compteur. Garantit qu'on atteint exactement `total_work` à la fin = 100% pile.
- Filtre max dans `commands/scan.rs` (snapshot mutex) : on n'écrase la valeur courante que si `new_current >= existing`. Sans ce filtre, des emits parallèles arrivant out-of-order (thread A `fetch_add=4` mais son emit traverse le mutex après B `fetch_add=5`) feraient reculer le snapshot vu par le frontend.
- **Comptage des entrées d'archive : exact, pas heuristique.** `count_entries_fast` et `count_archive_image_entries` itèrent réellement les archives (random access pour ZIP, headers pour 7z, décompression du stream pour tar.* avec auto-skip des données via `Drop`). L'ancienne heuristique `size / 100000` sous-estimait systématiquement les tars denses (renpy.tar.bz2 : 2000 estimé vs 3134 réel), faisant atteindre 100% en pleine phase archive. Le coût (quelques secondes au démarrage du scan pour les gros tar) est acceptable pour avoir une barre correcte. Ne JAMAIS revenir à une heuristique basée sur `size`.

Tests d'invariants (`scanner::tests::progression_*`) - **à garder verts en permanence**, sentinelle anti-régression :
- `progression_atteint_total_avec_phases_simples` : exact + pHash → atteint pile `total_work`.
- `progression_atteint_total_avec_archives` : cas le plus complexe (matching silencieux d'archives Phase 2) → atteint pile `total_work` grâce au sync final.
- `progression_apres_filtre_snapshot_max_strictement_monotone` : avec le filtre max simulé dans le test, la séquence vue par le frontend est strictement croissante.
- Helper `assert_progress_invariants` : aucun emit ne dépasse `total`, le max atteint == `total`.
Si l'un de ces tests casse après une modif de phase, c'est probablement une constante `EMITS_*` désalignée ou un sync manquant - ne PAS relâcher l'assertion, corriger la cause.

Conséquences pratiques :
- Pour ajouter une phase nouvelle, il faut définir sa constante `EMITS_*`, l'ajouter à `total_work`, et appeler `sync_to(budget_after_X)` après l'avoir exécutée. Sinon le 100% n'est pas atteint pile.
- Si une sous-phase est silencieuse (pas d'emit), c'est OK : le sync de fin rattrape. La barre fera juste un saut vers le haut à la transition (ce qui est désirable).
- Le frontend `ProgressETA` est conçu pour **ne PAS afficher d'info trompeuse** quand `current` ne bouge pas (rate=0 → pas de "presque fini", pas de "X min restantes"). C'est intentionnel.
- Le frontend cap déjà `pct = Math.min(100, current/total)` côté affichage. Garde-fou défensif, **pas une excuse pour laisser current dépasser total**.

**Ce qu'il ne faut JAMAIS faire** :
- Modifier `total_work` pendant le scan (`total_work.max(current)` etc.)
- Calculer `current` à partir d'un offset par phase (l'ancienne approche `phase_offset + n`) : c'est ce qui causait des chevauchements entre sous-phases et des reculs visibles
- Geler `current` pour faire avancer le heartbeat autrement
- Faire lire `phase_current` au heartbeat à la place de `current`
- Émettre `file=""` en pleine phase (sauf aux sync de transition, où c'est intentionnel)

## Règle impérative - Interaction modale UI au milieu d'un scan : pattern Mutex+Condvar

Quand une phase du scanner a besoin d'une décision utilisateur (ex. alerte espace disque avant extraction d'archives), **ne PAS faire le check côté frontend avant `scan_folder`**. Le côté pénible pour l'utilisateur : pré-check qui peut prendre des dizaines de secondes (itération des en-têtes d'archives) avant que la barre de progression apparaisse, sans bouton Cancel visible.

Pattern correct (cf. `DiskDecisionState` dans `lib.rs`) :
1. La commande Tauri `scan_folder` enregistre un **handler** dans `ScanParams` (type `Box<dyn Fn(...) -> Decision + Send + Sync>`).
2. Le scanner appelle ce handler au moment opportun (ex. après `counting_archives` quand `available - 1 Go < needed`). Le handler bloque jusqu'à réponse.
3. Le handler côté Tauri : `window.emit("event", payload)` puis `disk_state.wait(&cancelled)` (Mutex + Condvar). Le frontend reçoit l'event, affiche la modale, l'utilisateur clique. Les boutons appellent une commande dédiée (`respond_disk_warning`) qui fait `state.set(decision)` → notifie le Condvar → le scan thread se réveille.
4. Le `wait` poll le `cancelled` flag toutes les 200 ms pour sortir en `Cancel` si l'utilisateur appuie sur Annuler du scan (bouton derrière la modale) au lieu de répondre.
5. **Reset le state** avant chaque scan (au début de `scan_folder`) pour éviter qu'une décision stale d'un scan annulé soit consommée par le scan suivant.

Avantages :
- L'utilisateur clique Analyser, la barre de progression apparaît immédiatement, le cancel est disponible.
- Pas de redondance : l'itération des en-têtes faite par `counting_archives` produit aussi l'estimation disque (via `count_and_estimate_archive_*`). Une seule passe au lieu de deux.
- Le scanner reste agnostique de Tauri (handler injecté). Les tests Rust peuvent passer `None` → pas de warning, scan continue normalement.

Ce qu'il ne faut JAMAIS faire :
- Mettre la logique de check dans le frontend (`invoke("check_archive_disk_space")` avant `invoke("scan_folder")`) → l'utilisateur attend devant un écran sans progression.
- Modifier `params.skip_archive_extraction` (immutable). À la place, utiliser une variable locale `effective_skip_extraction` qui peut basculer à `true` quand l'utilisateur choisit Skip.
- Appeler `wait` sans poll du cancel flag : si l'utilisateur ferme la modale par le bouton Annuler du scan principal, le scan resterait bloqué indéfiniment.

## Règle impérative - Détection de format : extension + magic bytes, jamais l'extension seule

Tout filtre qui sélectionne des fichiers candidats pour un décodage lourd (archives, vidéos, audio) **doit confronter l'extension aux magic bytes du contenu** avant de confier le fichier au décodeur. Sinon un fichier dont l'extension ment (ex. `.cbz` qui contient en réalité du RAR, parce que renommé manuellement ou produit par un outil bugué) fait scanner / boucler le décodeur sur des octets non conformes pendant plusieurs secondes voire indéfiniment.

Cas vécu : un `.cbz` contenant du RAR. `detect_archive_format` se base uniquement sur l'extension, donc le scanner traitait le fichier comme un ZIP. `zip::ZipArchive::new` cherchait alors la signature EOCD dans le fichier et ne la trouvait jamais : blocage de la phase `counting_archives`.

Pattern (cf. `archive::verify_archive_magic` + `archive::detect_archive_format_verified`) :
1. Garder une fonction "détection rapide par extension" (utile en interne, pas sur le chemin critique).
2. Ajouter une fonction "vérification magic" qui ouvre le fichier, lit les premiers octets et confronte au format détecté. Magic numbers : ZIP `50 4B 03 04`, 7z `37 7A BC AF 27 1C`, gzip `1F 8B`, bzip2 `42 5A 68`, xz `FD 37 7A 58 5A 00`, zstd `28 B5 2F FD`, tar `ustar` à l'offset 257.
3. Ajouter un wrapper combiné (extension + magic) et l'utiliser **aux entry points du scan** (filtres qui produisent la liste des archives à compter / hasher), pas dans les sous-fonctions internes (déjà filtrées).
4. Sur erreur d'I/O (open / read échoue) : laisser passer (`return true`) - on préfère que le décodeur échoue proprement plutôt qu'exclure à tort sur une I/O transitoire. Sur fichier ouvert mais trop court pour contenir le magic : rejeter (`return false`) - structurellement invalide.

Coût : 1 ouverture + ~6 octets lus par candidat, fait une seule fois en amont du filtre. Imperceptible (<1ms par fichier sur SSD, ~5-10ms sur HDD) comparé aux dizaines de secondes que peut prendre une phase d'archives.

À retenir pour les futurs filtres similaires : `is_image`, `is_video`, `is_audio` se basent aussi sur l'extension. Si un format pose le même problème (décodeur qui boucle sur des octets garbage), ajouter la même vérif magic plutôt que de patcher localement avec un timeout.

## Règle impérative - Architecture cache pour opérations lazy

Quand le frontend déclenche une opération coûteuse en post-scan (ex. ouverture d'un comparateur), **ne JAMAIS recalculer ce qui a été calculé pendant le scan**.

Pattern :
1. Pendant le scan, calculer les données nécessaires (hashes, métadonnées) et les stocker dans le résultat
2. Propager jusque `LoadedSession` (état mémoire) et `SessionFile` (persistance disque, rétro-compatible via `#[serde(default)]`)
3. La commande lazy (ex. `get_archive_comparison`) **lit le cache en priorité**, fallback uniquement si absent (sessions pré-cache)
4. Quand la session est supprimée ou des fichiers sont retirés, **purger le cache correspondant**

Voir `archive_entries_cache` (HashMap path → entrées avec hashes) comme exemple de référence.

## Règle impérative - Cohérence des seuils entre scan et opérations post-scan

Tout paramètre qui influence un calcul (seuil de similarité, tolérance, etc.) doit être **partagé entre toutes les phases qui s'en servent**. Si la phase de scan utilise un seuil et qu'une opération post-scan (comparateur, recompute, export) utilise un seuil différent, le compteur affiché à l'utilisateur ne correspond plus à ce qu'il voit dans le détail.

Exemple vécu : `ArchiveComparator` hardcodait `simThreshold={10}` alors que le scan utilisait `summary.sim_threshold` (potentiellement 0 si l'utilisateur avait choisi 100% de similarité). Résultat : `duplicated_entries=61/90` dans la GroupCard mais 90 paires affichées dans le comparateur (29 à 99% via le seuil 10 hardcodé). Avec le fix `simThreshold={summary?.sim_threshold ?? 10}`, les 29 entrées qui ne matchent plus apparaissent désormais comme **lignes isolées** (cellule opposée vide) du côté de leur archive, ce qui est cohérent avec le compteur 61/90.

Pattern : la source de vérité d'un seuil est `summary` (ou `params` pendant le scan). Toute commande qui prend ce seuil en paramètre **lit toujours la même source**, jamais une constante hardcodée différente.

## Règle impérative - Filtre d'affichage frontend = portée des actions backend

Tout filtre purement frontend qui restreint l'affichage (filtre texte par nom/chemin, filtre par dossier, autres) **doit être propagé en paramètre aux commandes backend qui agissent sur l'ensemble** (sélection automatique, smart select, export, suppression en masse, comptage...). Sinon : l'utilisateur voit X groupes dans la liste, clique "Tout cocher" ou "Appliquer une règle", et le backend coche / agit sur N groupes (N > X) parce qu'il ignore le filtre. Comportement contre-intuitif, source de mauvaises suppressions.

Pattern (cf. `apply_text_filter` dans `commands/session.rs`) :
1. Backend expose un paramètre optionnel pour chaque filtre frontend (`filter_text: Option<String>`).
2. Helper interne (ex. `apply_text_filter`) qui reproduit **exactement** la logique de filtrage frontend (même critère, même mode `by_folder` vs normal, même casse insensible, même trim). Toute divergence crée un écart entre ce que l'utilisateur voit et ce que l'action fait.
3. Frontend passe systématiquement l'état courant du filtre à l'invoke (ou `null` si vide après trim, pour distinguer "pas de filtre" de "filtre vide").
4. Filtre `None` / `""` / `"   "` → passthrough total (comportement d'origine inchangé), pour préserver les call sites qui n'ont pas besoin du filtrage.

Tests d'invariance à garder verts : un test "filtre vide ↔ pas de filtre" pour chaque commande, et un test "filtre actif → résultat restreint" qui vérifie que l'invoke reçoit bien le filterText (côté frontend) et qu'il filtre correctement (côté backend).

## Règle impérative - Diagnostic par logs avant code

Quand un bug ne reproduit pas ou que la cause n'est pas évidente après lecture du code, **ajouter des logs ciblés et faire reproduire l'utilisateur** est plus rapide et plus fiable que de spéculer en boucle. Pattern :

1. Identifier les valeurs clés à observer (état du cache, seuils, compteurs avant/après une transformation)
2. Ajouter des `eprintln!("[fonction] ...")` aux points de décision
3. Recompiler, faire reproduire, lire les logs
4. Diagnostic immédiat (ou nouvelle hypothèse à tester avec d'autres logs)
5. **Retirer les logs avant commit**

Exemple vécu : recompute des compteurs d'archives qui ne marchait pas. 3 itérations de spéculations infructueuses. Un seul jeu de logs (état du cache + seuil + compteurs avant/après) a révélé `sim_threshold=0` dans la session - root cause invisible depuis le code seul. À adopter dès qu'un fix "logique" ne suffit pas.

## Règle impérative - Filtres d'affichage : cache brut, filtre dynamique à chaque lecture

Quand un filtre n'a de sens que pour la vue (liste d'ignorés, filtre texte, etc.) et doit pouvoir être annulé plus tard, **le cache mémoire (`LoadedSession`) doit stocker la liste BRUTE non filtrée**. Le filtre est appliqué à chaque commande de lecture (`get_groups_page`, `get_folder_groups_page`, `list_folder_keys`, `select_all_duplicates`, `smart_select`...) en lisant la source du filtre (`ignore_list.json`) au moment de l'appel.

Pattern (cf. `commands/session.rs::current_ignored_keys` + `commands/session.rs::filtered_view`) :
1. `load_session` charge la session du disque, persiste la version cleanée (cleanup de fichiers absents, recompute compteurs), et stocke la liste **brute** dans `LoadedSession`. Le `summary` retourné au frontend, lui, est passé par `filtered_view` pour refléter la liste d'ignorés courante.
2. Toutes les commandes de lecture commencent par `let ignored_keys = current_ignored_keys(&app);` puis filtrent `loaded.groups` à la volée avant pagination ou agrégation.
3. `ignore_group` / `clear_ignore_entry` ne touchent **JAMAIS** au cache - ils écrivent juste dans `ignore_list.json`. La prochaine lecture verra automatiquement le changement.
4. `filtered_view` doit recalculer **tous** les compteurs du summary qui dependent des groupes : `total_groups`, `total_wasted_bytes`, et `total_folders` (uniquement en mode `by_folder`, via un HashSet des `folder_key` distincts). Oublier l'un d'eux fige le compteur correspondant cote frontend - typiquement le compteur "X dossiers" qui ne bouge plus quand on ignore le dernier groupe d'un dossier (regression vue puis fixee post-1.2.0).

Conséquences :
- Retirer un groupe de la liste d'ignorés le fait réapparaître **immédiatement** à la prochaine pagination, sans rechargement ni invalidation du cache.
- Le fast-path de `load_session` (cache hit sur le même `id`) reste sûr : il relit `ignored_keys` à chaque appel et retourne un summary filtré, jamais le summary cached tel quel.
- Le coût d'un `IgnoreList::load(&data_dir)` à chaque commande est sub-milliseconde (fichier JSON petit, lectures rares - une par "load more"). Pas optimiser tant que ça ne devient pas un point chaud.

Tests `commands::session::tests::filtered_view_*` figent ce contrat. En particulier `filtered_view_invariant_cache_brut_apres_retrait_ignore` simule "ignorer un groupe puis le dé-ignorer sans toucher au cache" et vérifie que le groupe revient.

**Anti-pattern à éviter** : pré-filtrer le cache au `load_session` puis `loaded.summary.clone()` au fast-path. Symptômes : groupes ignorés qui réapparaissent au prochain load (cache stale), ou groupes dé-ignorés qui ne reviennent que par rechargement complet. La cause profonde : le cache devient une "photo gelée" du filtre au moment du load, désynchronisée du fichier `ignore_list.json` qui peut évoluer entre deux appels.

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

### Titre de la fenetre OS : `document.title` ne se propage pas sous WebView2 / WebKitGTK
Sur le web, modifier `document.title` met a jour le titre de l'onglet/fenetre du navigateur. Dans Tauri, **ce n'est pas le cas** pour le titre OS (celui affiche dans la barre des taches, le switcheur Alt+Tab, le titlebar) : ni WebView2 (Windows) ni WebKitGTK (Linux) ne synchronisent automatiquement le titre du document HTML vers le titre de la fenetre native. La page peut afficher un autre titre dans son `<title>` que le titlebar OS, et les deux sont independants.

Solution : utiliser l'API native Tauri.
```ts
import { getCurrentWindow } from "@tauri-apps/api/window";
getCurrentWindow().setTitle("nouveau titre").catch(() => {});
```
Permission requise dans `capabilities/default.json` : `"core:window:allow-set-title"`. Sans cette permission, `setTitle` rejette silencieusement (typique Tauri 2 : le call frontend ne plante pas, mais le titre ne change pas).

Cas d'usage dans le projet : afficher la progression du scan (`"XX % - Deduplicateur"`) dans le titre OS pendant une analyse, pour que l'utilisateur la voie dans la barre des taches sans avoir a basculer sur la fenetre. Cf. App.tsx, useEffect sur `scanExec.scanning` + `scanExec.progress`.

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

### `value || undefined` sur un bool requis : "missing required key"
Pattern piège : `scanArchives: config.scanArchives || undefined` dans les args d'un `invoke`. Quand le bool vaut `false`, l'expression évalue à `undefined`, Tauri sérialise la clé comme absente, et la commande Rust qui attend un `bool` non-optionnel rejette avec "command X missing required key Y". À l'inverse, c'est OK pour des clés déclarées `Option<T>` côté Rust (timestamps, secondaryFolder...). Règle : ne jamais utiliser `|| undefined` sur un bool, passer la valeur telle quelle (`scanArchives: config.scanArchives`).

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

### Pipeline pHash optimise : 8 optimisations configurables
Les 8 optimisations sont dans `phash_config::PHashConfig` (fichier `phash_config.json`) :
1. Filtre de taille minimale - s'active si `n >= min_images_size_filter`
2. Filtre de ratio d'aspect - lecture d'en-tete uniquement, s'active si `n >= min_images_aspect_filter`
3. Hash en 2 passes - coarse+fine en un seul decode, s'active si `n >= min_images_two_pass`
4. Cache inter-scans - `phash_cache.bin` (binaire, ~4x plus compact que JSON), invalide si mtime/tailles/thumbnail_setting changent ; repli en lecture sur l'ancien `phash_cache.json`
5. Comparaison parallele rayon - `flat_map_iter` (pas `flat_map`), s'active si `n >= min_images_parallel_compare`
6. Decodage rapide via thumbnail EXIF - `use_exif_thumbnail=true` : lit le thumbnail (~160x120) embarque dans les JPEG via parsing manuel APP1->TIFF->IFD1 (tags 0x0201/0x0202) ; repli automatique si absent
7. Bucket index - `use_bucket_index=true && coarse_threshold==0` : HashMap coarse->Vec<usize>, O(n * bucket_size) au lieu de O(n^2) ; desactive si coarse_threshold > 0 (trop de buckets voisins a chercher)
8. Tri par aspect - `use_sorted_aspect=true && use_aspect_filter` : sort + partition_point pour trouver la plage de paires compatibles en O(log n) ; images sans aspect (None) mises a la fin (INFINITY)

Note : `flat_map` en rayon attend `IntoParallelIterator` ; utiliser `flat_map_iter` pour un
iterateur standard (`Vec::into_iter()`).

### Cache binaire pHash : format PHCB
`phash_cache.bin` utilise un format binaire compact. Par entree : path_len(u16) + path + mtime(u64)
+ coarse_size(u8) + fine_size(u8) + coarse_len(u8) + coarse_bytes + fine_len(u8) + fine_bytes
+ flags(u8 : bit0=thumbnail_setting, bit1=has_aspect) + [aspect(f32 LE)].
Environ 79 octets/entree vs ~350 en JSON. `HashCache::load()` essaie le binaire en premier,
repli sur le JSON si absent ou invalide (retrocompatibilite). `HashCache::save()` ecrit uniquement
en binaire.

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

### externalBin Tauri : build.rs obligatoire pour eviter l'echec en dev
Quand `tauri.conf.json` declare `"externalBin": ["binaries/fpcalc"]`, Tauri attend que le
fichier `binaries/fpcalc-{triple}` existe au moment du build. En dev, le script
`scripts/download-fpcalc.sh` n'est pas toujours lance. Sans `build.rs`, le build echoue
silencieusement avec "external binary not found". Solution : `build.rs` cree un placeholder
vide si le binaire n'existe pas encore :
```rust
fn main() {
    let triple = std::env::var("TAURI_ENV_TARGET_TRIPLE")
        .or_else(|_| std::env::var("TARGET")).unwrap_or_default();
    if !triple.is_empty() {
        let name = if cfg!(windows) { format!("binaries/fpcalc-{}.exe", triple) }
                   else { format!("binaries/fpcalc-{}", triple) };
        if !std::path::Path::new(&name).exists() {
            let _ = std::fs::create_dir_all("binaries");
            let _ = std::fs::write(&name, b"");
        }
    }
    tauri_build::build()
}
```
En CI et en prod, `scripts/download-fpcalc.sh` place le vrai binaire avant le build.
Les binaires `src-tauri/binaries/fpcalc*` sont dans `.gitignore`.

### Recherche d'outils externes : tool_finder::find_tool
Pour tout sous-processus externe (fpcalc, ffmpeg, ffprobe), ne pas utiliser directement
`Command::new(name)` qui depend uniquement du PATH. Utiliser `tool_finder::find_tool(name)`
qui cherche dans cet ordre :
1. A cote de l'executable (binaire bundte via externalBin)
2. Chemins systeme courants selon l'OS (Chocolatey, Scoop, Homebrew, /usr/bin...)
3. Retourne None → l'appelant fait `Command::new(name)` comme fallback

```rust
let path = tool_finder::find_tool("fpcalc")
    .map(|p| p.into_os_string())
    .unwrap_or_else(|| OsString::from("fpcalc"));
let mut cmd = Command::new(&path);
```

### Hash vidéo : détection des bandes noires obligatoire pour le mean hash 8x8
Le mean hash 8x8 perceptuel est trop grossier pour distinguer deux vidéos verticales (format mobile 9:16) placées dans un canvas paysage 16:9 sur fond noir. Toutes ces vidéos partagent la même "structure" globale (bandes noires aux côtés + sujet centré), produisant des hashes quasi identiques → faux positifs à 95 %+ de similarité.

Solution : avant de hasher chaque frame, détecter les bandes noires (luminance moyenne <= 16/255 par colonne / ligne) et n'appliquer le crop que si elles sont **présentes sur TOUTES les frames extraites** (intersection min). Le crop isole le sujet réel, le hash devient discriminant.

Pipeline (`video/hash.rs::extract_frame_hashes`) :
1. Pass 1 : extraction de chaque frame en `128xN` grayscale via ffmpeg `scale=128:-2`. Détection des bandes noires par frame.
2. Intersection : `min` de chaque côté sur toutes les frames. Si une seule frame n'a pas la bande, le min tombe à 0 → pas de crop sur ce côté. Évite de cropper à cause d'une frame transitoire (ex. fondu noir au milieu).
3. Pass 2 : crop selon l'intersection + resize logiciel 8x8 (moyenne par bloc) + `mean_hash_64`.

**Important** : tout changement à cet algo invalide les hashes en cache. Utiliser la constante `HASH_ALGORITHM_VERSION` dans `video/hash.rs` et bumper sa valeur. Le `VideoCacheEntry::algorithm_version` est ignoré au get si différent → recalcul progressif au prochain scan.

### WebView2/WebKit : conteneurs vidéo non lus nativement (`.avi`, `.flv`, `.mkv`, `.wmv`)
Le `<video>` HTML5 dans WebView2 (Windows) et WebKitGTK (Linux) ne lit que `.mp4`, `.webm`, `.mov`, `.ogg` nativement. **Le codec n'est pas le problème** (un H.264 dans un `.flv` ne charge pas alors que le même H.264 dans un `.mp4` fonctionne) - c'est le **conteneur**.

Solution : module `video::playback::prepare_for_playback` qui classifie chaque fichier en `Direct` / `Remuxed` / `Unsupported` avant que le `<video>` reçoive sa `src` :
- **Direct** : extension dans { mp4, m4v, webm, ogg, ogv, oga } → pas de transformation, sert le fichier original via le media server.
- **Remuxed** : extension dans { flv, mkv, ts, m2ts, mts, mov, 3gp, 3g2, **avi, wmv, asf, f4v** } ET codec dans { h264, hevc, vp8, vp9, av1 } → ffmpeg `-c copy -movflags +faststart` vers `app_local_data_dir/video_remux/<hash>.mp4` (quasi instantané, pas de reencodage vidéo NI audio).
- **Unsupported** : tout le reste (`.avi` mpeg4 / Xvid / DivX, `.wmv` WMV2/WMV3, audio AC3 / WMA / Vorbis / Speex incompatible mp4, codecs anciens) → l'UI affiche un placeholder + bouton "ouvrir dans lecteur système". **Pas de fallback de réencodage audio** : si `-c copy` échoue, on tombe directement en Unsupported pour ne pas figer l'UI plusieurs secondes/minutes par fichier. Ces cas seront pris en charge par la Phase 30 (lecteur natif libmpv).

Le tempdir `video_remux/` est purgé au démarrage de l'app (`lib.rs::run` setup). Les noms de fichiers sont déterministes (hash de path+mtime+size) pour réutiliser le remux entre lancements **dans la même session** (purge au boot suivant).

Côté frontend : `prepare_video_for_playback(path)` est appelé dans `useEffect` du VideoComparator pour chaque côté ; pendant l'attente, état `preparing` qui affiche un spinner.

### Lecture de fichiers media dans Tauri/Linux : utiliser un serveur HTTP local
Trois approches ont ete essayees pour servir des fichiers video locaux dans un `<video>` element :

1. `convertFileSrc` (asset protocol) - ne fonctionne pas sans configuration specifique
2. `readFile` via IPC + blob URL - **bloque le thread UI** pour tout fichier (serialisation IPC en JSON base64)
3. Scheme custom (`localfile://` via `register_uri_scheme_protocol`) - **ecran noir** sur Linux :
   WebKitGTK utilise GStreamer comme backend media. GStreamer ne connait que `http://`, `https://`,
   `file://` - il ignore completement les schemes WebKit personnalises pour les elements `<video>`.

**Solution correcte** : serveur HTTP local axum sur `127.0.0.1:0` (port aleatoire), expose via
une commande Tauri `get_media_server_port`. Inclure le support des requetes Range pour que la
barre de progression et le scrubbing fonctionnent :
```rust
// media_server.rs
pub fn start() -> u16 {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    listener.set_nonblocking(true).unwrap();
    tauri::async_runtime::spawn(async move {
        let tl = tokio::net::TcpListener::from_std(listener).unwrap();
        axum::serve(tl, Router::new().fallback(handle)).await.ok();
    });
    port
}
```
Et dans le handler : retourner `206 Partial Content` avec `Content-Range` si la requete contient
un header `Range`, sinon `200 OK` avec le fichier complet + `Accept-Ranges: bytes`.

Le media server sert aussi les **GIF animes** (MIME `image/gif`) via `get_image_url` pour le
comparateur d'images : `get_image_thumbnail` (crate `image` -> data URL JPEG) aplatit toute
animation en une seule frame ; pour preserver l'animation, on sert le fichier d'origine au
`<img>` HTML5 qui anime nativement. La detection combine extension `.gif` ET magic bytes
(`GIF87a` / `GIF89a`) pour ne pas servir un fichier menteur avec MIME image/gif (l'image
casserait dans le navigateur). Les autres formats (PNG, JPEG, WEBP...) restent en data URL
JPEG redimensionnee (800 px) pour limiter la memoire.

### Composants React definis dans un autre composant : remontage a chaque rendu
Definir `MetaBlock` ou `VideoPanel` comme fonctions a l'interieur de `VideoComparator` cree une
nouvelle reference de fonction a chaque rendu du parent. React interprete ca comme un nouveau
type de composant et demonte/remonte l'integralite du sous-arbre DOM - l'element `<video>` est
recrée et perd son etat (position, lecture en cours). **Toujours definir les composants au niveau
module**, jamais a l'interieur d'un autre composant.

### Synchronisation de deux GIF animes `<img>` : reset les deux thumbs ensemble, pas juste une `key`

Les GIF animes affiches via `<img src=...>` n'ont **aucune API JS pour controler la position d'animation**. Quand deux GIF jouent en parallele dans un comparateur et que l'utilisateur change l'un des deux via une barre d'onglets, le cote modifie redemarre a frame 0 (le navigateur charge la nouvelle src) mais l'autre cote continue son animation -> desync visible.

**Premiere tentative (insuffisante)** : passer une `key` partagee aux deux `<img>` qui change a chaque modif d'onglet, en se reposant sur React pour demonter+remonter les deux balises ensemble. Marche sous **WebKitGTK (Linux)** mais PAS sous **WebView2 (Windows)** : WebView2 conserve l'element DOM et l'animation en cours quand seule la `key` React change et que la `src` est inchangee. Le remount React n'est pas honore.

**Solution qui marche partout** : forcer le demontage reel via la condition de rendu, puis batcher les setState :
1. Detecter si le groupe contient au moins un GIF (`file.path.toLowerCase().endsWith(".gif")`).
2. Si oui, dans le `useEffect` qui suit les changements d'onglet : `setLeftThumb(null)` ET `setRightThumb(null)`. Les `<img>` disparaissent vraiment du DOM (rendu conditionnel `{thumb && ...}` devient false).
3. Fetch les deux URLs en parallele via `Promise.all`.
4. `setLeftThumb` + `setRightThumb` dans le **meme `.then()`** : React batche les setState en un seul re-render -> les deux `<img>` montent dans le meme tick -> les deux GIF demarrent a frame 0 ensemble.
5. Si pas de GIF : preserver l'UX en ne refetchant que le cote qui a vraiment change (sinon clignotement parasite sur l'autre cote pour des images statiques qui n'en ont pas besoin).

Detection du "cote qui a change" via `useRef({ left: "", right: "" })` qui memorise les paths au precedent render, car le `useEffect` doit maintenant dependre des DEUX indices pour pouvoir reset les deux ensemble en cas de GIF.

Cf. `src/ImageComparator.tsx` pour l'implementation. Tests d'invariance dans `src/ImageComparator.test.tsx` section F.

### Synchronisation bidirectionnelle de deux `<video>` : boucle infinie asynchrone
Un guard `syncingRef` ne protege pas contre les evenements asynchrones du navigateur.
Scenario : `left.play()` → `onPlay` → `syncingRef = true` → `right.play()` → `syncingRef = false`
→ `right.play()` resout de facon asynchrone → `onPlay` de droite fire → `syncingRef` est deja
`false` → boucle infinie. `useState` pour le flag ne fonctionne pas non plus (batching React :
`true` puis `false` dans le meme evenement = un seul rendu avec `false`).

**Solution** : pattern maitre/esclave. Une seule video a `controls` (la gauche). La droite n'a
aucun controle et aucun handler d'evenement. La gauche synchronise la droite via :
```tsx
function syncPlay() {
  const rv = rightVideoRef.current, lv = leftVideoRef.current;
  if (rv && lv) { rv.currentTime = lv.currentTime; rv.play().catch(() => {}); }
}
function syncPause() { rightVideoRef.current?.pause(); }
function syncSeek() {
  const lv = leftVideoRef.current, rv = rightVideoRef.current;
  if (lv && rv) rv.currentTime = lv.currentTime;
}
// VideoPanel gauche : master onPlay={syncPlay} onPause={syncPause} onSeeked={syncSeek}
// VideoPanel droite : master={false} (aucun handler)
```

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


### Lecture des dimensions d'image : parser PNG/JPEG manuellement, pas le crate image
`image::io::Reader::with_guessed_format().into_dimensions()` peut bloquer indefiniment sur HDD
(contention de seeks en parallele rayon) ou sur des fichiers corrompus/inhabituels. Utiliser
`read_png_dimensions` / `read_jpeg_dimensions` qui lisent au plus 64 Ko et parsent les headers
directement (IHDR pour PNG, scan des marqueurs SOF pour JPEG). Retourne `None` pour les autres
formats (WebP, TIFF...) - le filtre d'aspect est alors simplement ignore pour ces fichiers.
Ne jamais remettre le crate `image` dans cette fonction.

### Cache video : stocker les metadonnees pour eviter ffprobe sur les hits
`get_video_metadata()` lance un subprocess ffprobe par fichier. Sans cache des metadonnees,
il est appele pour TOUS les candidats meme si leur hash est deja en cache. Stocker
`duration_secs`, `width`, `height`, `codec` dans `VideoCacheEntry` permet de reconstruire
`VideoMetadata` directement depuis le cache. Ne lancer ffprobe que pour les cache misses.
Meme pattern que pour l'aspect ratio dans le cache pHash.

### Lazy loading des thumbnails : IntersectionObserver avec rootMargin
Rendre toutes les GroupCard simultanement avec `invoke("get_image_thumbnail")` pour chacune
rame l'UI au chargement d'un gros scan. Utiliser `IntersectionObserver` avec
`rootMargin: "300px 0px"` (environ 2 cards de buffer) dans `FileThumbnail` : l'invoke n'est
declenche que quand le placeholder entre dans la zone etendue. En test (jsdom), mocker
`IntersectionObserver` pour qu'il declenche immediatement `isIntersecting: true` dans
`src/test-setup.ts` - sinon tous les tests de thumbnails echouent (invoke jamais appele).

### Phase silencieuse → barre de progression "morte" + ETA cassé
Quand une phase de scan ne fait pas d'émissions `on_progress` régulières, le frontend voit `progress.current` figé et :
- Le heartbeat ne bouge plus (impression de freeze)
- `ProgressETA` calcule `rate = 0`, n'affiche plus "X min restantes"
- La barre semble bloquée à un pourcentage

C'est arrivé avec la phase 2 archives (extraction tempdir + pHash parallèle rayon) qui n'émettait rien pendant son exécution. Le fix correct n'est pas de bricoler côté frontend, mais d'**émettre depuis chaque iteration**, y compris depuis le `par_iter` rayon. Pour cela la signature de `on_progress` doit avoir `+ Send + Sync`. Pattern :
```rust
// Dans la fonction phase :
on_progress: &(impl Fn(...) + Send + Sync),

// Dans le par_iter :
let phashes: Vec<_> = items.par_iter().map(|item| {
    let n = counter.fetch_add(1, Ordering::Relaxed) + 1;
    on_progress(progress_base + n, total_work, ..., n, phase_total, "phase_label");
    compute(item)
}).collect();
```

### `count_and_estimate_archive_*` pour les estimations upfront
Pour qu'une nouvelle phase respecte la règle "total_work fixé upfront", il faut pouvoir estimer son travail avant que le scan démarre. Pour les phases archives, `archive::count_and_estimate_archive_image_entries(path) -> (usize, u64)` et son pendant `count_and_estimate_archive_audio_entries` retournent en une seule passe sur les headers : (nombre d'entrées filtrées, estimation de la taille décompressée totale). Pour ZIP/7z, la taille décompressée est exacte (`entry.size()`). Pour tar.*, on itère réellement le flux pour compter les entrées (la signature `ustar` à offset 257 et les headers POSIX sont lus en streaming) et l'estimation de taille décompressée utilise `taille_archive * 4` comme borne supérieure réaliste. Voir `scanner/mod.rs::scan_folder` pour le calcul de `archive_phase1_count` + `archive_phase2_image_count` ajoutés à `total_work`, et le check d'espace disque combiné via `DiskDecisionState`.

L'ancienne `count_archive_image_entries` (sans estimation, et avec une heuristique tar `1/3`) a été supprimée Phase 31 : la double passe count + estimate disque était redondante. Ne jamais réintroduire d'heuristique basée sur la taille du fichier - l'expérience a montré qu'elle sous-estime systématiquement les tars denses (cf. la règle "Comptage des entrées d'archive : exact, pas heuristique" dans la section progression).

### Scan d'archives 7z : utiliser sevenz-rust2, pas sevenz-rust
`sevenz-rust` (version 0.6) expose `for_each_entries` avec une signature HRTB
(`for<'a> FnMut(&'a ArchiveEntry, &'a mut SevenZReader<'a>)`) impossible a satisfaire
en Rust stable depuis un closure qui capture une variable mutable. Utiliser
`sevenz-rust2` (fork actif, version 0.21+) qui simplifie en `FnMut(&ArchiveEntry, &mut dyn Read) -> Result<bool, Error>`.
Le closure peut capturer `&mut Vec<ArchiveEntry>` sans probleme.
```rust
let mut reader = ArchiveReader::open(path, Password::empty())?;
let mut entries = Vec::new();
reader.for_each_entries(|entry, stream| {
    if entry.is_directory() || !entry.has_stream() { return Ok(true); }
    let hash = hash_reader(stream)?;
    entries.push(...);
    Ok(true)  // continuer
})?;
```

### Lecteur video natif libmpv : fenetre fille + wid + paire master/slave
La Phase 30 ajoute un lecteur libmpv embarque pour decoder les codecs/conteneurs que le `<video>` HTML5 ne sait pas lire (MPEG-4 ASP, WMV3, Xvid/DivX, audio AC3/WMA/Vorbis, etc.).

**Architecture cle** :
1. Une fenetre native (HWND child sur Windows, sous-fenetre X11 sur Linux) est creee par-dessus l'emplacement DOM d'un placeholder. Sur Wayland, pas de support (pas d'API d'embedding cross-process), retombe en `Unsupported` placeholder.
2. libmpv est instanciee avec `wid=<handle>` pour rendre directement dans cette fenetre.
3. Sync maitre/esclave via le registre Rust : commandes `play_pair / pause_pair / seek_pair` qui acquerent les Mutex des deux instances dans un ordre fixe (id ascendant) pour eviter les deadlocks. Cas particulier `left == right` traite via `with` simple.
4. Frontend : ResizeObserver + scroll listener envoient `set_geometry` au backend a chaque changement de layout. IntersectionObserver cache la fenetre native quand le placeholder sort du viewport (sinon elle reste affichee par-dessus le contenu suivant - le z-order natif est toujours superieur a la WebView).
5. Une barre de controles DOM en `position: fixed` flotte sous les videos (par-dessus la WebView, mais en dessous de la fenetre native qui est positionnee plus haut). C'est l'envers de l'UX habituelle, mais necessaire car les controles DOM ne peuvent pas s'afficher SUR la fenetre native.

**Pieges connus** :
- **Thread affinity Win32 = dispatch obligatoire vers le thread principal**. Les fenetres Win32 ont une thread affinity : seul le thread qui a fait `CreateWindowExW` peut appeler `SetWindowPos` / `ShowWindow` / `DestroyWindow` sans risque de deadlock. `SetWindowPos` avec changement de z-order utilise `SendMessage` synchrone vers les autres top-level windows ; si le thread proprietaire ne pompe pas la file Win32, deadlock immediat de toute l'app. Les commandes Tauri async tournent sur des workers tokio, pas le thread principal. **Solution** : toutes les ops Win32 (`create`, `destroy`, `set_geometry`, `set_visible`) sont dispatchees vers le thread principal via `Window::run_on_main_thread` + `tokio::sync::oneshot::channel` pour recuperer le resultat, cf. `commands/native_player.rs::run_main`. Les ops mpv pures (load, play, pause, seek, get_state) n'ont pas ce probleme : libmpv gere sa propre sync interne. Symptome si on oublie : `cargo run` fonctionne (au moins l'audio joue), puis premier resize ou changement de z-order fige toute l'UI - obligation de tuer via gestionnaire des taches.
- Les fenetres natives sont **toujours au-dessus** du DOM. Quand un modal s'ouvre par-dessus le comparateur, passer `hidden=true` au composant pour qu'il appelle `set_visible(false)` sur la fenetre native, sinon le modal est cache derriere.
- Les screenshots de la WebView Tauri ne contiennent pas la fenetre native (composition separee). Ce n'est pas un probleme pour le comparateur, mais documenter la limite.
- DPI scaling : le frontend envoie des pixels CSS, le backend convertit en pixels physiques via `tauri::Window::scale_factor()` avant SetWindowPos / configure_window.
- libmpv2-sys necessite libmpv-dev sur Linux (apt) et libmpv-2.dll + mpv.lib + headers dans `src-tauri/binaries/` sur Windows. Sur Windows, le build script `scripts/download-mpv.sh` recupere ces fichiers ; en CI le step est conditionnel a `runner.os == 'Windows'`. Variable d'env `LIBMPV_PATH` doit pointer sur ce repertoire avant `cargo build` sur Windows.
- Feature flag Cargo `native-player` (default ON) : permet de builder sans libmpv (`--no-default-features`) pour de la review de code ou des environnements minimaux. Les commandes Tauri `native_player_*` retournent alors `feature_disabled` et le frontend retombe sur le placeholder + bouton lecteur systeme.

**Fichiers cles** :
- `src-tauri/src/native_player/mod.rs` (exports + types Rect / PlayerState)
- `src-tauri/src/native_player/platform.rs` (impl Win32 et X11 conditionnelle, detection Wayland)
- `src-tauri/src/native_player/player.rs` (wrapper `Mpv` + lifecycle)
- `src-tauri/src/native_player/registry.rs` (HashMap<id, Arc<Mutex<NativePlayer>>>, with_pair, lock ordering)
- `src-tauri/src/commands/native_player.rs` (10 commandes Tauri, gating feature via cfg)
- `src/components/NativeVideo.tsx` (composant placeholder + ref imperatif)
- `src/components/NativeComparatorBody.tsx` (orchestration deux NativeVideo + barre de controles)
