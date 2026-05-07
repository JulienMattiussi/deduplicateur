# Estimations de performance du pipeline d'analyse

Deux scenarios de reference sont couverts dans ce document :

| Scenario | Images | Doublons | Section |
|---|---|---|---|
| A | 1 000 | 10 paires exactes (20 fichiers) | [Estimations 1 000 images](#estimations-de-temps---1-000-images) |
| B | 10 000 | 50 paires exactes (100 fichiers) | [Estimations 10 000 images](#estimations-de-temps---10-000-images) |
| C | 100 000 | 100 paires exactes (200 fichiers) | [Estimations 100 000 images](#estimations-de-temps---100-000-images) |

Mode commun : "Images + tout le dossier + sous-dossiers", parametres avancés par défaut, SSD NVMe, 8 coeurs, JPEG ~3 MP (~2-4 Mo chacun).

---

## Pipeline séquentiel détaillé

### Paramètres envoyés au backend

```
recursive: true
byFolder: false
findSimilar: true
simThreshold: 0 bits        (UI 100% → toHammingThreshold(100) = 0 bits Hamming)
exactCacheEnabled: true
excludeExtensions: ["tmp", "DS_Store", "Thumbs.db", "desktop.ini", "lnk"]
excluded: ["node_modules", ".git", "target", "dist", ".next", "__pycache__", ...]
minFileSizeKb: 0, maxFileSizeKb: 0
phashConfig: {
  min_file_size_bytes: 10240,
  coarse_hash_size: 4, fine_hash_size: 8,
  aspect_ratio_tolerance: 0.20,
  min_images_size_filter: 50,
  min_images_aspect_filter: 10,
  min_images_two_pass: 20,
  min_images_parallel_compare: 200,
  coarse_threshold_multiplier: 2.0,
  cache_enabled: true, parallel_compare_enabled: true
}
```

---

### Phase reading - Collecte des fichiers

`walkdir::WalkDir` (recursif). Pour chaque fichier :

1. Ignore les dossiers exclus (`node_modules`, `.git`, etc.)
2. Ignore les extensions exclues (`*.tmp`, `*.DS_Store`, etc.)
3. Lit la taille et le mtime
4. Ignore si taille < `minFileSizeKb * 1024` (ici 0, donc rien filtré)

Résultat : 1000 fichiers collectés avec `(path, size, mtime)`.

Événement `scan:progress` émis toutes les 100 ms avec `phase: "reading"`.

Les fichiers sont ensuite groupés par taille - seules les tailles avec >= 2 fichiers sont candidates à la suite.

---

### Phase exact - Détection des doublons exacts

#### Étape 2.1 - Chargement du cache exact

Si `exact_cache_enabled: true` : chargement de `exact_cache.json`. Une entrée est valide si `mtime` ET `size` correspondent exactement.

#### Étape 2.2 - Hash partiel (xxhash3 sur les 4 premiers Ko)

Parallélisé via Rayon, sur les fichiers dont la taille est partagée par >= 2 fichiers.

Pour chaque fichier :
- Cache hit : lecture du `hash_partial` depuis le cache, pas d'I/O disque
- Cache miss : lecture des 4 premiers Ko → XXH3 → hex 16 caractères

Regroupement par `hash_partial`. Les groupes avec une seule entrée sont éliminés.

#### Étape 2.3 - Hash complet (xxhash3 sur le fichier entier)

Uniquement sur les survivants (>= 2 fichiers partagent le même hash partiel).

- Cache hit : lecture du `hash_full` depuis le cache
- Cache miss : lecture du fichier entier par chunks de 64 Ko → XXH3 → hex 16 caractères

Regroupement par `hash_full`. Les groupes avec >= 2 fichiers sont des doublons exacts confirmés.

#### Résultat (10 paires exactes)

- 10 groupes créés avec `similar: false`
- Les 20 fichiers concernés sont mémorisés dans `exact_paths` (exclus de la phase pHash)
- Cache exact sauvegardé si au moins un miss

---

### Phase images - Détection des images similaires (pHash)

#### Étape 3.0 - Candidats pHash

```
candidates = 1000 fichiers - les 20 fichiers déjà dans des groupes exacts = 980 images
```

#### Étape 3.1 - Filtres d'activation

Tous actifs ici car 980 >= tous les seuils :

| Optimisation | Seuil | 980 images |
|---|---|---|
| Filtre taille min (10 Ko) | >= 50 images | ACTIVE |
| Filtre ratio d'aspect | >= 10 images | ACTIVE |
| Hash 2 passes (coarse + fine) | >= 20 images | ACTIVE |
| Comparaison parallele Rayon | >= 200 images | ACTIVE |

Après filtre taille : images < 10 Ko éliminées.

#### Étape 3.2 - Chargement du cache pHash

Chargement de `phash_cache.json`. Une entrée est valide si `mtime`, `size` ET les tailles de hash (`coarse_hash_size`, `fine_hash_size`) correspondent.

#### Étape 3.3 - Lecture des dimensions (pour le filtre d'aspect)

Parallélisé, pour chaque image :
- Cache hit avec aspect : lecture directe depuis le cache
- Cache hit sans aspect (ancien format) : lecture en-tête PNG/JPEG (64 Ko max), parsing manuel IHDR (PNG) ou marqueurs SOF (JPEG)
- Cache miss : idem
- Format non reconnu (WebP, TIFF...) : `aspect = None`, filtre ignoré pour ce fichier

Ratio = `largeur / hauteur`.

#### Étape 3.4 - Calcul des hashs (2 passes sur les cache misses)

Parallélisé via Rayon, pour chaque cache miss :

```
image::open(path)  → décodage complet de l'image en mémoire
coarse_hash = Gradient pHash 4x4 → 16 bits
fine_hash   = Gradient pHash 8x8 → 64 bits
Encodage Base64 → insertion dans le cache
```

Pour les cache hits : hashs lus directement, `on_progress` appelé quand même.

#### Étape 3.5 - Comparaison pHash de toutes les paires

Parallélisé via Rayon (`flat_map_iter`), pour chaque paire `(i, j)` parmi 980 × 979 / 2 ≈ 500 000 paires :

**Filtre 1 - Ratio d'aspect :**
```
Si |ratio_i - ratio_j| / max(ratio_i, ratio_j) > 0.20 → SKIP
```

**Filtre 2 - Hash coarse (pré-filtre rapide) :**
```
seuil_coarse = floor(0 * (16/64) * 2.0) = 0 bits  (simThreshold = 0)
Si hamming(coarse_i, coarse_j) > 0 → SKIP
```

**Filtre 3 - Hash fine :**
```
Si hamming(fine_i, fine_j) <= 0 → MATCH
```

Avec seuil 0 bit (UI à 100%), seules les images au gradient strictement identique passent.

> Note : avec UI à 100%, la phase pHash ne détecte que des copies pixel-parfaites. Pour des photos similaires, régler le curseur en dessous de 100% (ex. 80% ≈ 12 bits Hamming).

#### Étape 3.6 - Union-Find (groupement transitif)

Toutes les paires similaires sont fusionnées avec Union-Find (compression de chemin). Si A ≈ B et B ≈ C, alors {A, B, C} forment un seul groupe.

#### Étape 3.7 - Création des groupes similaires

Pour chaque composante connexe avec >= 2 images :

```
DuplicateGroup {
  id: UUID,
  hash: "phash",
  size: taille_premier_fichier,
  similar: true,
  files: [images du groupe]
}
```

#### Étape 3.8 - Sauvegarde du cache pHash

`phash_cache.json` sauvegardé si au moins un miss. Les entrées incluent `coarse_hash`, `fine_hash`, `aspect_ratio`, `mtime`, `size`.

---

### Résultat final

```
ScanSummary {
  total_groups: 10 (+ groupes similaires si seuil > 0),
  scanned_files: 1000,
  find_similar: true,
  recursive: true,
  partial: false
}
```

Groupes triés par espace gaspillé décroissant (`taille × (nb_fichiers - 1)`).

Résultat sauvegardé dans `<app_data_dir>/sessions/<id>.json`.

---

## Estimations de temps - 1 000 images

Candidats pHash : 980 (1 000 - 20 doublons exacts). Paires a comparer : 980 × 979 / 2 ≈ **500 000**.

### Cache froid (premier lancement)

Durée totale estimée : **15 - 60 secondes**

| Étape | Description | % du total |
|---|---|---|
| **reading** | `walkdir` + `stat()` sur 1 000 fichiers | 1 - 3 % |
| **2.1** | Chargement cache exact (fichier absent) | < 1 % |
| **2.2** | Hash partiel 4 Ko (~20-50 fichiers qui partagent une taille) | 2 - 5 % |
| **2.3** | Hash complet (20 fichiers doublons, ~60 Mo a lire) | 1 - 3 % |
| **2.x** | Groupement par hash, filtrage, sauvegarde cache exact | < 1 % |
| **3.0** | Soustraction des 20 fichiers exacts des candidats pHash | < 1 % |
| **3.1** | Verification des seuils d'activation (980 >= tous les seuils) | < 1 % |
| **3.2** | Chargement cache pHash (absent) | < 1 % |
| **3.3** | Lecture headers PNG/JPEG pour dimensions (980 × quelques Ko) | 1 - 2 % |
| **3.4** | **Décodage complet + calcul pHash (980 × image::open + gradient 4×4 + 8×8)** | **70 - 85 %** |
| **3.5** | Comparaison 500 K paires (XOR + popcount, parallelisé Rayon) | < 1 % |
| **3.6** | Union-Find (fusion des composantes connexes) | < 1 % |
| **3.7** | Construction des DuplicateGroup | < 1 % |
| **3.8** | Sauvegarde cache pHash JSON (~1 Mo, 980 entrées) | 1 - 3 % |

L'étape 3.4 écrase tout le reste : lire ~3 Go de JPEG et décoder chaque image en bitmap RGB avant de calculer le gradient 8×8. La comparaison 3.5 est négligeable a cette échelle (500 K paires ≈ quelques ms sur 8 coeurs).

### Cache chaud (relancement a l'identique)

Durée totale estimée : **0.5 - 3 secondes**

| Étape | Description | % du total |
|---|---|---|
| **reading** | `walkdir` + `stat()` (total ~20× plus court, donc représente davantage) | 5 - 10 % |
| **2.1** | **Chargement + désérialisation JSON cache exact (1 000 entrées)** | **15 - 25 %** |
| **2.2** | Tous hits, émettre progress | < 1 % |
| **2.3** | Tous hits | < 1 % |
| **2.x** | Groupement, filtrage | < 1 % |
| **3.0 - 3.1** | Trivial | < 1 % |
| **3.2** | **Chargement + désérialisation JSON cache pHash (~1 Mo, 980 entrées)** | **20 - 30 %** |
| **3.3** | Tous en cache, juste émettre progress | < 1 % |
| **3.4** | Tous hits, aucun `image::open`. Coût = émettre 980 events | 2 - 5 % |
| **3.5** | **Comparaison 500 K paires : devient l'étape dominante visible** | **20 - 35 %** |
| **3.6** | Union-Find | < 1 % |
| **3.7** | Construction des groupes | < 1 % |
| **3.8** | Aucune entrée dirty, écriture sautée | < 1 % |

Les deux lectures JSON (2.1 + 3.2) et la comparaison pHash (3.5) se partagent le temps a parts quasi égales.

---

## Estimations de temps - 10 000 images

### Grandeurs clés

| Grandeur | 1 000 images | 10 000 images | Facteur |
|---|---|---|---|
| Candidats pHash | 980 | 9 900 | ×10 |
| Paires a comparer | ~500 K | **~49 millions** | **×98** |
| Données I/O decode (3 Mo/img) | ~3 Go | ~30 Go | ×10 |
| Cache pHash JSON | ~1 Mo | ~2.5 Mo | ×2.5 |
| Cache exact JSON | ~0.5 Mo | ~5 Mo | ×10 |

Le nombre de paires reste gérable (49 M contre 500 K a 1 000 images et 5 milliards a 100 K). L'I/O de décodage (30 Go) reste le facteur limitant sur cache froid. Sur cache chaud, les lectures JSON commencent a peser davantage mais la comparaison reste secondaire.

### Cache froid (premier lancement)

Durée totale estimée : **1 - 5 minutes** (SSD NVMe, 8 coeurs)

| Étape | Description | % du total |
|---|---|---|
| **reading** | `walkdir` + `stat()` sur 10 000 fichiers | 1 - 3 % |
| **2.1** | Chargement cache exact (fichier absent) | < 1 % |
| **2.2** | Hash partiel 4 Ko (~100-500 fichiers partageant une taille) | 1 - 3 % |
| **2.3** | Hash complet (100 fichiers doublons, ~300 Mo a lire) | 1 - 2 % |
| **2.x** | Groupement, filtrage, sauvegarde cache exact | < 1 % |
| **3.0** | Soustraction des 100 fichiers exacts des candidats | < 1 % |
| **3.1** | Verification des seuils (9 900 >> tous les seuils) | < 1 % |
| **3.2** | Chargement cache pHash (absent) | < 1 % |
| **3.3** | Lecture headers pour dimensions (9 900 × quelques Ko) | 1 - 2 % |
| **3.4** | **Décodage complet + calcul pHash (9 900 × image::open, ~30 Go d'I/O)** | **80 - 90 %** |
| **3.5** | Comparaison 49 M paires (Rayon, 8 coeurs) | < 1 % |
| **3.6** | Union-Find | < 1 % |
| **3.7** | Construction des groupes | < 1 % |
| **3.8** | Sauvegarde cache pHash JSON (~2.5 Mo, 9 900 entrées) | 1 - 2 % |

La 3.4 est encore plus hégémonique qu'a 1 000 images : 30 Go d'I/O a lire, mais la 3.5 (49 M paires) reste négligeable - quelques centaines de ms sur 8 coeurs. Le rapport I/O/comparaison est encore favorable au decode.

### Cache chaud (relancement a l'identique)

Durée totale estimée : **3 - 10 secondes**

| Étape | Description | % du total |
|---|---|---|
| **reading** | `walkdir` + `stat()` sur 10 000 fichiers | 20 - 35 % |
| **2.1** | **Chargement + désérialisation JSON cache exact (~5 Mo, 10 K entrées)** | **15 - 25 %** |
| **2.2** | Tous hits, émettre progress | < 1 % |
| **2.3** | Tous hits | < 1 % |
| **2.x** | Groupement, filtrage | < 1 % |
| **3.0 - 3.1** | Trivial | < 1 % |
| **3.2** | **Chargement + désérialisation JSON cache pHash (~2.5 Mo, 9 900 entrées)** | **15 - 25 %** |
| **3.3** | Tous en cache, juste émettre progress | < 1 % |
| **3.4** | Tous hits, aucun `image::open`. Coût = émettre 9 900 events | 3 - 8 % |
| **3.5** | Comparaison 49 M paires (Rayon, ~100-300 ms) | **5 - 10 %** |
| **3.6** | Union-Find | < 1 % |
| **3.7** | Construction des groupes | < 1 % |
| **3.8** | Aucune entrée dirty, écriture sautée | < 1 % |

La 3.5 commence a pointer le bout de son nez (5-10 %) mais n'est pas encore dominante. Le reading et les deux chargements JSON (2.1 + 3.2) se partagent la majorité du temps - même structure qu'a 1 000 images, avec des fichiers JSON un peu plus lourds.

---

## Estimations de temps - 100 000 images

### Grandeurs clés

| Grandeur | 1 000 images | 100 000 images | Facteur |
|---|---|---|---|
| Candidats pHash | 980 | 99 800 | ×102 |
| Paires a comparer | ~500 K | **~5 milliards** | **×10 000** |
| Données I/O decode (3 Mo/img) | ~3 Go | ~300 Go | ×100 |
| Cache pHash JSON | ~1 Mo | ~25 Mo | ×25 |
| Cache exact JSON | ~0.5 Mo | ~50 Mo | ×100 |

Le nombre de paires explose quadratiquement (O(n²)) : 100× plus d'images = 10 000× plus de paires. C'est le fait dominant de tout ce qui suit.

### Filtres d'activation pHash (étape 3.1)

Tous actifs, encore plus largement qu'a 1 000 images :

| Optimisation | Seuil | 99 800 images |
|---|---|---|
| Filtre taille min (10 Ko) | >= 50 | ACTIVE |
| Filtre ratio d'aspect | >= 10 | ACTIVE |
| Hash 2 passes (coarse + fine) | >= 20 | ACTIVE |
| Comparaison parallele Rayon | >= 200 | ACTIVE |

### Cache froid (premier lancement)

Durée totale estimée : **10 - 30 minutes** (SSD NVMe, 8 coeurs)

| Étape | Description | % du total |
|---|---|---|
| **reading** | `walkdir` + `stat()` sur 100 000 fichiers | 1 - 2 % |
| **2.1** | Chargement cache exact (fichier absent) | < 1 % |
| **2.2** | Hash partiel 4 Ko (~500-2 000 fichiers partageant une taille) | 1 - 3 % |
| **2.3** | Hash complet (200 fichiers doublons, ~600 Mo a lire) | 1 - 2 % |
| **2.x** | Groupement, filtrage, sauvegarde cache exact | < 1 % |
| **3.0** | Soustraction des 200 fichiers exacts des candidats | < 1 % |
| **3.1** | Verification des seuils (99 800 >> tous les seuils) | < 1 % |
| **3.2** | Chargement cache pHash (absent) | < 1 % |
| **3.3** | Lecture headers pour dimensions (99 800 × quelques Ko) | 1 - 2 % |
| **3.4** | **Décodage complet + calcul pHash (99 800 × image::open, ~300 Go d'I/O)** | **75 - 85 %** |
| **3.5** | **Comparaison ~5 milliards de paires (Rayon, 8 coeurs) : émerge** | **5 - 15 %** |
| **3.6** | Union-Find | < 1 % |
| **3.7** | Construction des groupes | < 1 % |
| **3.8** | Sauvegarde cache pHash JSON (~25 Mo, 99 800 entrées) | 1 - 3 % |

La 3.4 reste dominante (300 Go d'I/O disque, decodage parallele mais I/O bound). La 3.5 émerge : même parallelisée sur 8 coeurs, itérer 5 milliards de paires a 5-10 ns chacune représente plusieurs dizaines de secondes. Elle était invisible a 1 000 images, elle pèse ici 5-15 %.

### Cache chaud (relancement a l'identique)

Durée totale estimée : **2 - 8 minutes**

| Étape | Description | % du total |
|---|---|---|
| **reading** | `walkdir` + `stat()` sur 100 000 fichiers | 5 - 10 % |
| **2.1** | **Chargement + désérialisation JSON cache exact (~50 Mo, 100 K entrées)** | **10 - 15 %** |
| **2.2** | Tous hits, émettre progress | < 1 % |
| **2.3** | Tous hits | < 1 % |
| **2.x** | Groupement, filtrage | < 1 % |
| **3.0 - 3.1** | Trivial | < 1 % |
| **3.2** | **Chargement + désérialisation JSON cache pHash (~25 Mo, 99 800 entrées)** | **10 - 20 %** |
| **3.3** | Tous en cache, juste émettre progress | < 1 % |
| **3.4** | Tous hits, aucun `image::open`. Coût = émettre 99 800 events | 2 - 5 % |
| **3.5** | **Comparaison ~5 milliards de paires : goulot d'étranglement absolu** | **50 - 70 %** |
| **3.6** | Union-Find | < 1 % |
| **3.7** | Construction des groupes | < 1 % |
| **3.8** | Aucune entrée dirty, écriture sautée | < 1 % |

Inversion totale par rapport au cache chaud a 1 000 images : la 3.5 passe de 20-35 % a 50-70 %. Les lectures JSON (2.1 + 3.2) deviennent secondaires malgré des fichiers 25-50× plus lourds. La 3.4 a completement disparu.

---

## Synthèse comparative

### Cache froid

| | 1 000 images | 10 000 images | 100 000 images |
|---|---|---|---|
| Étape dominante | 3.4 : 70-85 % | **3.4 : 80-90 %** | 3.4 : 75-85 %, 3.5 émerge |
| 3.5 (comparaison) | < 1 % | < 1 % | 5-15 % |
| Durée totale | 15-60 s | 1-5 min | 10-30 min |

### Cache chaud

| | 1 000 images | 10 000 images | 100 000 images |
|---|---|---|---|
| Étape dominante | 2.1 + 3.2 + 3.5 a égalité | reading + 2.1 + 3.2 a égalité | **3.5 seule : 50-70 %** |
| 3.5 (comparaison) | 20-35 % | 5-10 % | 50-70 % |
| Durée totale | 0.5-3 s | 3-10 s | 2-8 min |

### Lecture

**Cache froid** : la 3.4 (decodage image) domine a toutes les échelles. Elle est plus hégémonique encore a 10 K qu'a 1 K (proportion relative des autres étapes plus faible). La 3.5 n'émerge qu'a partir de 100 K images.

**Cache chaud** : la loi quadratique s'impose progressivement. A 1 K images, la 3.5 partage le podium avec les lectures JSON. A 10 K, elle devient visible mais secondaire. A 100 K, elle écrase tout seule. Le cache ne résout pas le problème O(n²), il le révele en faisant disparaitre tout le reste.

**Seuil de bascule** : entre 10 K et 100 K images, la 3.5 passe de "secondaire" a "dominante" sur cache chaud. Le seuil se situe autour de 30-50 K images.

**SSD vs HDD** : sur HDD, les seeks aléatoires de la 3.3 (en-têtes de dimensions) peuvent passer de 1-2 % a 15-30 % du total sur cache froid, quelle que soit l'échelle.

**Résolution** : des photos RAW 24 Mp (30-50 Mo) multiplient le temps de la 3.4 par ×8-15. A 100 K images en RAW, le cache froid peut dépasser 2 heures.
