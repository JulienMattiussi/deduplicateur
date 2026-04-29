# Plan d'action - Déduplicateur

## Stack technique
- **Backend** : Rust (Tauri) - hachage xxhash, parallélisme Rayon
- **Frontend** : React + TypeScript + Tailwind CSS + shadcn/ui
- **Packaging** : `.exe` autonome via `tauri build`

---

## Phase 1 - Moteur exact + UI minimale ✅
**Objectif : avoir un `.exe` qui tourne sur un vrai dossier**

- [x] Initialiser le projet Tauri + React
- [x] Moteur Rust : grouper par taille de fichier
- [x] Moteur Rust : hash complet (xxhash) des candidats
- [x] UI : champ de sélection de dossier + bouton "Analyser"
- [x] UI : liste des groupes de doublons avec fichiers dépliables
- [x] Suppression vers la corbeille
- [x] Validé sur un vrai dossier (626 fichiers, 10 groupes, 11.4 Mo, 105 ms)

**Critère de validation : détecter et supprimer des doublons exacts dans un dossier plat**

---

## Phase 2 - Performance + filtrage en cascade ✅
**Objectif : tenir sur des dossiers de plusieurs milliers de fichiers**

- [x] Ajouter hash partiel (4 Ko) entre tri par taille et hash complet
- [x] Parallélisme avec Rayon
- [x] Barre de progression dans l'UI (fichiers traités / total)
- [x] Affichage du temps d'analyse et de l'espace récupérable
- [x] Sessions persistantes (JSON dans `~/.local/share/deduplicateur/sessions/`)
- [x] Pagination des résultats (50 groupes par page, chargement à la demande)
- [x] Annulation du scan en cours

**Critère de validation : analyser 50 000 fichiers en moins de 30 secondes**

---

## Phase 3 - Interface soignée
**Objectif : UX agréable et utilisable**

- [x] Dark mode + thème cohérent
- [x] Gestion des erreurs (banner d'erreur, fichier absent ignoré silencieusement)
- [ ] Liste des groupes avec colonnes (nom, taille, date, chemin)
- [ ] Sélection intelligente : "garder le plus récent", "garder le plus grand", "tout cocher"
- [ ] Confirmation avant suppression avec récapitulatif (N fichiers, X Mo)

**Critère de validation : test utilisateur sur un vrai cas d'usage**

---

## Phase 4 - Sous-dossiers
**Objectif : traiter une arborescence entière, dossier par dossier**

- [x] Parcours récursif de l'arborescence (walkdir)
- [x] Option : inclure ou exclure les sous-dossiers (toggle + panneau d'exclusions)
- [ ] Analyse indépendante par dossier (pas de comparaison cross-dossiers) - actuellement tout est mis à plat
- [ ] UI : vue arborescente des résultats (dossier → groupes de doublons)

**Critère de validation : analyser `/Photos` avec 20 sous-dossiers sans mélanger les résultats**

---

## Phase 5 - Similarité images
**Objectif : détecter les mêmes images en formats/résolutions différents**

- [ ] Intégrer `image-hasher` (pHash, résolution-agnostique)
- [ ] Pipeline séparé pour les fichiers image (jpg, png, webp, bmp, gif...)
- [ ] Seuil de similarité configurable dans l'UI
- [ ] Thumbnails dans la liste des groupes
- [ ] Affichage côte à côte des doublons visuels

**Critère de validation : détecter photo.jpg (640×480) et photo_hd.webp (1920×1080) comme doublons**

---

## Phase 6 - Similarité vidéos
**Objectif : détecter les mêmes vidéos en formats/résolutions différents**

- [ ] Intégrer `ffmpeg-next` pour l'extraction de frames
- [ ] Échantillonnage de N frames à intervalles réguliers
- [ ] Comparaison de séquences de pHash (alignement temporel approximatif)
- [ ] Seuil de similarité configurable
- [ ] Affichage des métadonnées vidéo (durée, résolution, codec, poids)

**Critère de validation : détecter film.avi (480p) et film.mp4 (1080p) comme doublons**
