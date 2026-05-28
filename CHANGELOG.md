# Changelog

All notable changes to Déduplicateur are documented here.

This file follows the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format and the project adheres to [Semantic Versioning](https://semver.org/).

## [1.3.0] - 2026-05-28

Minor release focused on the comparator and the results view. The comparators (image, video, audio) gain a fast triage loop with **Keep & next**, **Ignore & next** and the `1`/`2`/`i` keyboard shortcuts. The by-folder text filter is now scoped backend-side and matches folder names **and** file names/paths, so typing a file name surfaces the folder that contains it. The Ignored Groups and Profiles panels move to a shared side-drawer with search, and folder/group banners stick to the top of the scroll for orientation. Underneath: scanner subfolder isolation is now enforced in similarity phases, the Sessions counters honour the ignore list, and pagination after a full-page deletion no longer drops a folder.

### Added

- **Fast triage in the image, video and audio comparators**. Below each panel, two buttons: **Keep & next** (primary) marks the duplicates and jumps to the next group (closes if last), **Keep & close** (ghost, smaller) keeps the historical "mark + close" for single-group reviews. A new **🚫 Ignore & next** button in the header removes the current group from results then jumps to the next. Keyboard shortcuts `1` / `2` keep left/right & next, `i` ignore & next (plus `←`/`→` to navigate and `Esc` to close). The shared logic lives in `useComparatorNav` so adding a new comparator (archives, future formats) inherits the workflow by taking a single `onIgnore` prop.
- **By-folder text filter now searches everything**. In by-folder mode the filter previously only matched the folder name. It now matches the folder name **OR** any file name **OR** any file path: typing a file name surfaces the folder that contains it, and only the matching groups appear when that folder is expanded. Because the file list is loaded lazily per folder, the filter is applied backend-side (`list_folder_keys` and `get_folder_groups_page` both accept a `filter_text` parameter) with a 250ms debounce on the frontend. The selection actions (`select_all_duplicates`, `smart_select`) use the same predicate so their scope stays aligned with the displayed view.
- **Ignored Groups panel as a side drawer with search and sort**. The "Groupes ignorés" panel moves from a dropdown to a full-height side drawer (840px wide). A search field filters entries by file name or path, the sort can be toggled between "most recent" and "alphabetical", and each row shows a thumbnail + "open file" / "reveal in folder" buttons. The previous dropdown could overflow the viewport on small windows; the drawer scrolls cleanly.
- **Profiles panel as a side drawer with search**. The "Mes profils" panel adopts the same `SideDrawer` component as Ignored Groups, with a search field filtering by profile name **or** folder. The previous dropdown could overflow.
- **Sticky folder + group banners in by-folder mode**. The folder section header and the inner group headers now stick to the top of the scroll while scrolling through long groups, so the user always sees which folder and which group is currently being inspected. The group banner is anchored exactly under the folder banner thanks to a CSS variable measured at runtime (`--folder-header-h`), so no thin strip of scrolling content shows through between the two banners.
- **Scroll arrows on comparator tabs when overflowing**. Groups with many files (10+, typically the same file copied across a tree) used to hide tabs off-screen with a hidden scrollbar. Discoverable `◀` / `▶` arrows appear at each side of the tab strip when overflow is detected (`scrollWidth > clientWidth` via `ResizeObserver`), greyed out at the scroll bounds, hidden when everything fits. Applied to both file comparators (image/video/audio) and the archive comparator via a shared `DualScrollableTabs<T>` component.
- **Icon alignment between the list and the comparator**. The per-group ignore button in the list now uses the same `🚫` icon as the comparator header (instead of `✕` which was already overloaded with "close"). The Ignored Groups and Profiles drawers gain `🚫` and `👤` prefixes in their toggle button and drawer title for visual consistency.

### Changed

- **By-folder filter is now backend-driven (architectural change)**. Because the frontend does not hold the file list in by-folder mode (lazy load per folder), the filter cannot match file names client-side. It is now applied in `list_folder_keys` and `get_folder_groups_page` with a frontend `useEffect` (debounced 250ms) reloading folder summaries and resetting expanded folders on filter changes. Expanded folders re-collapse on filter change and reload filtered on reopen - the explicit trade-off documented in AGENTS.md.
- **Comparator "Garder celui-ci" replaced by "Garder & suivant" + "Garder & fermer"**. The historical single-button keep is now split into a primary triage action (advance) and a secondary close action (the old behaviour). The signature of `useComparatorNav.keepFile` gained an `advance` boolean; the shared `KeepButton` component is replaced by `KeepActions`. Internal API change only - no impact on session files, profiles, ignore lists or caches.
- **`apply_text_filter` predicate unified across modes**. In both normal and by-folder modes a group matches if its `folder_key` **OR** any file name **OR** any file path contains the query. The `by_folder` branch that matched on `folder_key` alone was removed; a new shared `group_matches_filter` helper is the single source of truth. Tests renamed accordingly.
- **Side drawers widened to 840px** (from 420px) to make room for paths and thumbnails in the Ignored Groups panel.

### Fixed

- **Scanner: by-folder mode now respects subfolder isolation in similarity phases**. The exact-hash phase already partitioned candidates per first-level subdir before hashing. The similar phases (pHash images, video pHash, audio fpcalc) compared candidates globally, then relied on `group_folder_key` to assign `folder_key=""` to groups spanning multiple subfolders - which contradicted the documented "files from different folders are never compared" guarantee. Each similar phase now pre-computes a `Vec<String>` of `first_level_subdir` for the candidates and filters `similar_pairs` to only keep pairs where both indices belong to the same subfolder. The cross-folder regression test was replaced by two anti-regression tests (no cross-folder group + intra-folder still works) and AGENTS.md gained an explicit rule so future similar phases inherit the filter.
- **Sessions list ignored the ignore list**. A session where every group had been ignored or deleted still displayed its original counters ("12 groups / 5.4 GB recoverable") in "Mes analyses". `list_sessions` returned `file.summary` verbatim, bypassing the "raw cache, dynamic filter" pattern that every other read command follows. Both sides fixed: backend `list_sessions` now applies `filtered_view` per session summary; frontend `resetResults` re-fetches `list_sessions` so the list stays in sync after deletion or ignore.
- **By-folder pagination broke after deleting / ignoring a full page**. In by-folder mode, a folder with more groups than the page size (50) lost its pagination as soon as a whole displayed page was handled: selecting all 50, then deleting them, made the folder vanish instead of loading the next 50. The frontend cumulative offset (`folderState[key].offset`) did not track the backend cache purge after deletion. `loadFolderPage` now accepts an `offsetOverride` and `handleDeleteComplete` / `handleIgnoreGroup` pass `offsetOverride = number of groups still displayed in that folder`, which matches the offset to resume from in the purged cache. Bonus: `handleIgnoreGroup` now awaits the backend `ignore_group` confirmation before reloading, since the ignore filter is only applied at read time.
- **Sticky group banner no longer leaves a thin strip below the folder banner**. The group banner was anchored at `top: 40px` hardcoded, but the actual folder banner height is not exactly 40px - a fine band of scrolling content showed through. `FolderSection` now measures the folder banner with `offsetHeight` + `ResizeObserver` and exposes it via a CSS variable consumed by the group banner.
- **Windows build broken after a clippy --fix sweep**. `RawWindowHandle::Xlib(h.window)` was missing its `as u64` cast on Windows where `h.window` is `u32` (vs `u64` on 64-bit Linux). Cast restored with a local `#[allow(clippy::unnecessary_cast)]` and a comment to prevent a future clippy --fix from re-removing it.

### Documentation

- Help articles updated (FR + EN): `filter-sort` reflects the new by-folder "search everything" behaviour; `comparator-modes`, `video-comparator-keep` and `audio-comparator-keep` document Keep & next / Keep & close / Ignore & next and the `1` / `2` / `i` shortcuts; `profiles` covers the drawer + search.
- New AGENTS.md rule "Actions de triage dans le comparateur (keep & next / ignore & next)" describing the shared `useComparatorNav` workflow, the asymmetric "advance" semantics of keep (groups stable) vs ignore (groups removed, index unchanged), and the keyboard contract.
- AGENTS.md rule "Filtre d'affichage frontend = portée des actions backend" extended with the unified predicate (`group_matches_filter`) and the backend-driven by-folder filter implementation (debounced reload, folder collapse on filter change).
- AGENTS.md rule "Mode par dossier" enriched with the subfolder isolation requirement for similarity phases (filter `similar_pairs` before `build_similar_groups` to prevent cross-folder groups).
- 13 dead i18n keys removed (`notifTitle`, `notifBodyNone`, `estimating`, `aboutTime`, `verifying`, `collectingFiles`, `phaseCounter`, `archiveDuplicate`, `archiveUnique`, `archiveViewContent`, `archiveVs`, `toolMissingPreScan`, `videoNativeStarting`).

### Quality

- 332 Rust tests (+11 since 1.2.2): unified filter predicate (`group_matches_filter`), filter passthrough / normal / by-folder branches, session list ignored regression (`filtered_view_session_integralement_ignoree_retourne_compteurs_zero`), by-folder similar phases isolation (`by_folder_phash_ne_compare_pas_images_de_dossiers_differents` + intra-folder guard), media extension constants (`media_types.rs`: dedup / browser-native / case-insensitivity / GIF magic gating).
- 518 TypeScript tests (+31 since 1.2.2): `KeepActions` (primary / ghost / kept / click), comparator triage scenarios (Keep & next advances / closes on last, Keep & close closes, Ignore & next via button and `i` key, `1` / `2` shortcuts), by-folder filter calling `list_folder_keys` + `get_folder_groups_page` with `filterText`, `useTheme` (4) and `useIgnoreList` (3) hooks, `MetaField` rendering, `SideDrawer` Escape + overlay click, pagination Bug 5 regression.
- Refactors: `useTheme` and `useIgnoreList` extracted from `App.tsx`; `DualScrollableTabs<T>` + `MetaField` + `KeepActions` shared between comparators; `ComparatorBasicShell` moved local to `ArchiveComparator`; media extension lists centralised in `media_types.rs` with `pub use` re-exports for compatibility; Tauri test mocks centralised in `src/test-setup.ts`.
- 0 clippy warning on lib + lib test (clippy --fix sweep: `redundant_closure`, `deref_addrof`, `unnecessary_cast`, `manual_checked_division`, `field_reassign_with_default`).

[1.3.0]: https://github.com/JulienMattiussi/deduplicateur/releases/tag/v1.3.0

## [1.2.2] - 2026-05-23

Patch release focused on the image and video comparators: synchronised zoom + pan via the mouse wheel on both, images served at their native resolution so the zoom is meaningful, and a final fix for animated GIF synchronisation under WebView2 (Windows) that had eluded the 1.2.1 release.

### Added

- **Synchronised zoom + pan in the image and video comparators**. Mouse wheel zooms (1x to 10x, factor 1.2 per tic) centered on the cursor position. Drag-pan once zoomed past 1x. Both panels mirror each other automatically because the same CSS transform is applied to both `<img>` (or both `<video>`). Reset on close+reopen, preserved across tab and group navigation. Magnifier cursor (`zoom-in`) on idle zoom signals the interaction; `grab` / `grabbing` once zoomed. The shared logic lives in a new `useZoomPan` hook used by both comparators. Note for the video comparator: while zoomed, the native player controls (click to play/pause, scrubber) are temporarily intercepted by drag-pan; zooming back out restores them.

### Changed

- **Image comparator now serves images at native resolution**. Previously the comparator displayed a 800px JPEG thumbnail (data URL) for every format except `.gif`, which meant zooming past 1x on any image larger than 800px showed resampled pixels - defeating the purpose of a deduplication comparator where you want to inspect details at the pixel level. For formats the `<img>` element can decode natively (PNG, JPEG, WEBP, AVIF, BMP, SVG, ICO, plus GIF with magic-byte verification), `get_image_url` now returns the media server URL pointing at the original file. The 800px thumbnail pipeline is kept as a fallback for formats the browser cannot decode (TIFF, HEIC, RAW).

### Fixed

- **Animated GIF synchronisation in the image comparator under WebView2 (Windows)**. The 1.2.1 fix relied on a shared React `key` to force both `<img>` to remount in lockstep when one tab changed - which works under WebKitGTK (Linux) but not under WebView2 (Windows), where the DOM element is kept when only the React key changes and the `src` is unchanged. After multiple iterations the working fix combines three mechanisms: (1) reset both thumb states to `null` so the `<img>` are actually removed from the DOM via the conditional render, (2) wait for two `requestAnimationFrame` cycles to guarantee a real browser paint of the absent state (React 18 was coalescing the renders so fast that WebView2 was skipping the intermediate paint - the user reported "not even a flicker"), and (3) append a `?_remount=N` query string to the URLs so WebView2 treats each load as a distinct cache entry instead of reusing the in-progress GIF decode. All five attempts are documented in AGENTS.md.

### Documentation

- Help article `comparator-modes` updated FR+EN to mention zoom/pan and the magnifier cursor for images.
- Help article `video-comparator-sync` updated FR+EN to mention zoom/pan and the "controls intercepted at zoom > 1" compromise.
- AGENTS.md: new section "Synchronisation de deux GIF animes" documents the five attempts and why only the fifth one works under WebView2.

### Quality

- 321 Rust tests (+4 since 1.2.1): all on `is_browser_native_image` (accepted formats, case-insensitivity, rejected formats, GIF magic-byte gating).
- 487 TypeScript tests (+15 since 1.2.1): zoom/pan tests on the image and video comparators, magnifier cursor tests, GIF sync regression tests (query param appended to URLs, no query on non-GIF groups).
- `useZoomPan` hook extracted from `ImageComparator` to share zoom/pan logic between both comparators (~50 lines centralised, behaviour strictly equivalent).

[1.2.2]: https://github.com/JulienMattiussi/deduplicateur/releases/tag/v1.2.2

## [1.2.1] - 2026-05-22

Patch release focused on UX coherence in the results view: the text filter now also scopes the automatic selection actions, the "Original" badge correctly stays on the oldest file regardless of local sort, animated GIFs in the image comparator stay synchronised when switching tabs, and the folder counter in by-folder mode updates as folders are emptied.

### Fixed

- **Folder counter frozen in by-folder mode**. Removing or ignoring the last group of a folder correctly removes the folder from the displayed list, but `summary.total_folders` was never decremented, so the "X folders" stat at the top stayed frozen on the original value. The backend `filtered_view` also forgot to recompute `total_folders` when groups were filtered out by the ignore list, so `load_session` returned a stale count too. Both sides now stay in sync.
- **"Original" badge moved with local column sort**. The badge was bound to `idx === 0` of the displayed order, so clicking "Modified ↓" on a column header moved the badge to the most recent file. The badge is now anchored to the file with the smallest `mtime` (the actual "original" per the documented convention), regardless of local sort order.
- **Animated GIFs desynchronised in the image comparator**. When comparing a group of 3+ files containing animated GIFs, switching one side via the tab bar made that side restart from frame 0 while the other side kept playing - the two animations drifted out of sync. Both `<img>` elements now share a remount key so they restart together when either side changes.

### Changed

- **Text filter now also restricts automatic selections**. When a filter is active, "Select all duplicates" and the selection rules ("keep newest", "keep highest resolution", etc.) only operate on the groups visible in the filtered view. Previously these actions ignored the filter and acted on the entire scan, which could check files the user could not see. The filter logic matches the frontend display in both modes: by file name/path in normal mode, by folder key in by-subfolder mode.
- **"Filter" input moved above the selection toolbar** (instead of below). Reflects the natural user flow: filter results first, then choose a selection rule, then apply.
- **`filtered_view` recomputes `total_folders` alongside `total_groups` and `total_wasted_bytes`** when groups are removed by the ignore filter, so `load_session` always returns a consistent summary in by-folder mode.

### Documentation

- New AGENTS.md rule "Filtre d'affichage frontend = portée des actions backend" formalising the pattern of propagating frontend display filters to backend actions that operate on the full set.
- Existing AGENTS.md rule "Filtres d'affichage : cache brut, filtre dynamique à chaque lecture" extended to require `filtered_view` to recalculate **all** summary counters (including `total_folders`), with a pointer to the post-1.2.0 regression that prompted the rule.
- Help articles updated (FR + EN): `filter-sort` documents the by-folder vs normal filter behaviour and the new "filter → selection" synergy; `manual-select` and `smart-rules` mention that the filter narrows their scope when active.

### Quality

- 317 Rust tests (+5 since 1.2.0): 3 on `apply_text_filter` (passthrough, normal mode, by-folder mode), 2 on `filtered_view` recomputing `total_folders` (only in by-folder mode, no-op otherwise).
- 472 TypeScript tests (+7): 2 in `App.test.tsx` on `filterText` being passed to `smart_select` and `select_all_duplicates`, 3 in `GroupCard.test.tsx` on the "Original" badge staying anchored to the oldest file across local sorts, 1 in `scan-scenarios.test.tsx` on `total_folders` decrementing when ignoring the last group of a folder, 1 in `ImageComparator.test.tsx` on both `<img>` DOM nodes being remounted when one side's tab changes.

[1.2.1]: https://github.com/JulienMattiussi/deduplicateur/releases/tag/v1.2.1

## [1.2.0] - 2026-05-13

Minor release introducing animated GIF support in the image comparator, real-time scan progress in the OS taskbar, and an architectural refactor making the in-memory cache and the ignore list fully independent.

### Added

- **Animated GIFs in the image comparator**: `.gif` files (detected via extension + magic bytes `GIF87a` / `GIF89a`) are now served by the local media server and animated natively by the embedded `<img>` element, instead of being flattened to a single JPEG frame by the `image` crate. Other formats (PNG, JPEG, WEBP) still go through the downscaled JPEG data URL pipeline for memory efficiency.
- **Scan progress in the OS window title**: while a scan runs, the window title is updated to `"XX % - Déduplicateur"` so the percentage is visible from the OS taskbar / Alt-Tab switcher without having to focus the window. Uses Tauri's `getCurrentWindow().setTitle()` (the `document.title` web API does not propagate to the OS titlebar in WebView2 / WebKitGTK). Permission `core:window:allow-set-title` added to `capabilities/default.json`.

### Changed

- **Architecture refactor: cache and ignore list now fully independent**. `LoadedSession.groups` and `LoadedSession.summary` always hold the raw (unfiltered) data; the ignore filter is applied dynamically on every read command (`get_groups_page`, `get_folder_groups_page`, `list_folder_keys`, `select_all_duplicates`, `smart_select`) via the helpers `current_ignored_keys` + `filtered_view`. Side effects:
  - Removing a group from the ignore list (`clear_ignore_entry`) makes it reappear at the next pagination call, with no session reload required.
  - The fast path of `load_session` (cache hit on the same `id`) now re-reads `ignored_keys` from disk and returns a filtered summary, instead of returning a stale snapshot taken at first load.
  - `ignore_group` and `clear_ignore_entry` no longer mutate the in-memory cache; they only update `ignore_list.json`.
- **Compare and Ignore buttons in group headers enlarged**. Vertical padding on `.group-header` reduced from 10px to 3px and the buttons use `align-self: stretch` so they fill nearly the full row height. This eliminates the thin strip above and below the buttons where a misclick used to collapse the group.

### Documentation

- New AGENTS.md rule "Filtres d'affichage : cache brut, filtre dynamique à chaque lecture" replacing the older "appliquer APRÈS la persistance" guidance.
- New AGENTS.md pitfall "Titre de la fenêtre OS : `document.title` ne se propage pas sous WebView2 / WebKitGTK" with the `getCurrentWindow().setTitle()` solution and required permission.
- AGENTS.md "Lecture de fichiers media" section now documents the GIF animation case (served by the media server when extension and magic match).
- `src/help/content.ts` article "Modes côte à côte et superposition" mentions animated GIFs (FR + EN).

### Quality

- **Audit-driven internal refactor** (no behavior change): `archive/mod.rs` (1235 lines) split into `detect.rs` / `count.rs` / `compare.rs` sub-modules; `lib.rs` (996 lines) split into `notifications.rs` + `selection.rs`; `commands/session.rs` extracted `generate_csv` / `generate_html` / `export_results` into `commands/export.rs`; new `with_filtered_cache<R>` helper in `session.rs` eliminates a 5-line pattern repeated across 6 read commands; `IMAGE_EXTS` and `AUDIO_EXTS` deduplicated (3 → 1 source of truth in `utils.ts`). Mock `@tauri-apps/api/window` centralised in `test-setup.ts`.
- 312 Rust tests (+11 since 1.1.1, including 7 on `is_animated_gif`, `filtered_view_invariant_cache_brut_apres_retrait_ignore` sentinel, 3 new tests on the extracted export module).
- 465 TypeScript tests (+3, including 2 on the OS window title and 1 on `get_image_url` returning a media server URL for `.gif`).

[1.2.0]: https://github.com/JulienMattiussi/deduplicateur/releases/tag/v1.2.0

## [1.1.1] - 2026-05-13

Patch release focused on the archive scanning flow: a cleaner disk-space check during the scan, a comparator threshold fix, and a robustness fix that prevents the counting phase from blocking on files whose extension lies about their content.

### Added

- **Magic-byte verification for archives**: each `.zip` / `.cbz` / `.7z` / `.tar.*` candidate is now checked against its actual format signature before being handed to the decoder. A `.cbz` that secretly contains a RAR archive (or any other extension/content mismatch) is silently excluded from the archive phase instead of making `zip::ZipArchive::new` scan the entire file looking for an EOCD that does not exist. The file still participates in regular hash-based deduplication. Magic numbers checked: ZIP (`PK\x03\x04` / `PK\x05\x06` / `PK\x07\x08`), 7z (`37 7A BC AF 27 1C`), gzip, bzip2, xz, zstd, and `ustar` at offset 257 for tar.
- **Tooltip on the scan Cancel button** explaining that cancelling does not erase prior work: computed fingerprints are cached and the next scan resumes where the previous one stopped.

### Changed

- **Archive disk-space check moved into the scan itself** (Phase 31). The frontend used to run a "Précheck" before the scan (open every archive header to estimate extraction size), which made the user wait for tens of seconds in front of a static screen with no Cancel button. The check now happens during the `counting_archives` phase and reuses the same header iteration that already runs there (single pass instead of two). When extraction is at risk of running out of space, the scan blocks via a Mutex+Condvar rendezvous and the frontend modal appears on top of the live progress bar; the underlying scan Cancel button stays responsive throughout.
- **ArchiveComparator now reads `summary.sim_threshold`** from the loaded session instead of hardcoding `simThreshold={10}`. The number of duplicated entries shown in the GroupCard counter (e.g. `61/90`) now matches the number of pairs displayed in the comparator. Entries below the configured threshold appear as isolated rows in the comparator, which is consistent with their exclusion from the count.

### Fixed

- **`.cbz` files containing RAR data no longer block the `counting_archives` phase**. Previously the file was confused for a ZIP and the decoder spent unbounded time searching for an absent central directory.
- **Cancel button stays accurately labelled** during archive counting and during the disk-space modal (frontend i18n cleanups around the precheck removal).

### Documentation

- New AGENTS.md sections: "Interaction modale UI au milieu d'un scan : pattern Mutex+Condvar" (covers the disk-space modal flow) and "Détection de format : extension + magic bytes, jamais l'extension seule" (rationale and pattern for the magic-byte check).
- `docs/plan.md` extended with Phase 31 (precheck refactor) and Phase 32 (magic-byte verification).

### Quality

- 301 Rust tests (+18 since 1.1.0, including 13 `verify_magic_*` tests and 5 covering `DiskDecisionState` rendezvous behaviour).
- 462 TypeScript tests (+6 since 1.1.0).
- `npx tsc --noEmit` clean.

[1.1.1]: https://github.com/JulienMattiussi/deduplicateur/releases/tag/v1.1.1

## [1.1.0] - 2026-05-11

Major release adding an embedded native libmpv video player for formats and codecs that the WebView's HTML5 `<video>` cannot read.

### Added

- **Embedded native video player (libmpv)** for codecs and containers the WebView's `<video>` element cannot handle: MPEG-4 ASP (Xvid/DivX in `.avi`), WMV3, audio AC3/WMA/Vorbis, etc. Activates automatically in the video comparator when at least one side is `Unsupported`. Sync between left and right via atomic Rust commands (`play_pair` / `pause_pair` / `seek_pair`). Available on Windows and Linux X11; Wayland and macOS fall back to the existing placeholder + "open in system player" button.
- **Volume control** in the native player: slider 0-100 with a 🔇/🔉/🔊 icon, applied only on the master (the slave is muted by design to avoid audio doubling).
- **Multi-track audio detection**: ffprobe extracts every audio stream from the container instead of only the first. The video comparator now lists all tracks with their codec, channel layout, language tag and human title, with a ★ marker on the default track. Useful for MKV / MP4 files with VO + VF + commentaries.
- **Extended remux support** in the HTML5 video path: `.avi`, `.wmv`, `.asf`, `.f4v` are now remuxed to mp4 in-place when their internal codec is compatible (H.264, HEVC, VP9, AV1). Modern AVI / WMV files now play natively in the comparator.
- **Filename tooltips** on all truncated filename displays: file lists, group cards, archive lists, folder section headers, comparator meta blocks. Hover shows the full name.

### Changed

- **HTML5 video path no longer falls back to re-encoding audio**. When `ffmpeg -c copy` fails (incompatible audio codecs like AC3 in MKV), the file is now classified `Unsupported` immediately instead of attempting a slow AAC re-encoding that could block the UI for minutes. These cases are now handled by the native player on supported platforms.
- **Bundle naming harmonized**: the full installer is now `Deduplicateur-full_*` (capital D) to match the light installer `Deduplicateur_*`.
- **CI build**: the rolling `latest` release is now purged of orphan assets before each main push, so old version numbers no longer linger after a version bump.
- **`tauri.conf.json`**: bundle now ships `libmpv-2.dll` as a resource on Windows; on Linux the system package `libmpv2` is required (declared in README install instructions).

### Fixed

- **Ignore list now applies when reloading a saved session**, not only during the original scan. Previously, marking a group as ignored disappeared on reopen because the session file was not filtered at load time. The on-disk session is left untouched; the filter applies only at the display level, so `clear_ignore_entry` properly restores the group on next reload.

### Documentation

- New AGENTS.md section "Lecteur video natif libmpv : fenetre fille + wid + paire master/slave" describing the architecture (HWND child / X11 sub-window / `wid`), the thread-affinity pitfall on Windows (cause of a freeze that bypassed CI), z-order with WebView2's DComposition, DPI scaling, and the feature-flag layout.
- New AGENTS.md section "Filtres d'affichage : appliquer APRES la persistance, jamais avant" derived from the ignore-list bug fix.
- Built-in help article "Ouvrir le comparateur de vidéos" updated FR + EN to mention the native player and the extended container support.
- README: native player listed in features, libmpv-dev added to Linux compile prerequisites, libmpv added to the Stack technique table.
- Copyright year updated from 2024 to 2026.

### Quality

- 283 Rust tests (+38 since 1.0.0, including 6 tests on `parse_ffprobe_metadata` covering multi-track audio, 3 on `NativePlayerRegistry`, 3 on `apply_ignore_filter` for the session bug fix).
- 456 TypeScript tests (+16 since 1.0.0, including 8 on `NativeVideo` and 8 on `NativeComparatorBody`).
- All warnings resolved in the native player module: dead code removed, `ParentHandle` cross-platform variants explicitly allowed.
- `commands/native_player.rs` refactored with a `gated!` macro to eliminate ~60 lines of repetitive feature-flag boilerplate. Both `--default-features` and `--no-default-features` builds verified.

[1.1.0]: https://github.com/JulienMattiussi/deduplicateur/releases/tag/v1.1.0

## [1.0.0] - 2026-05-10

First stable release. Recap of every feature shipped during development.

### Duplicate detection

- Cascading filter: size -> partial hash (4 KB) -> full xxhash3, parallelised across all cores via Rayon.
- Cross-scan hash cache: a file is never re-hashed while its mtime and size stay unchanged.
- "Exact" mode usable on its own (fast) or combined with similarity modes.
- Image similarity via gradient hash (8x8 pHash) with configurable Hamming threshold, transitive grouping (Union-Find), automatic exclusion of exact duplicates to avoid double-reporting.
- Video similarity via N-frame extraction with ffmpeg + 8x8 mean hash, with black-bar detection (intersection across all extracted frames) to avoid false positives on portrait videos placed in landscape canvases.
- Audio similarity via fpcalc / Chromaprint with cross-scan fingerprint cache.
- Archive scanning for ZIP, tar.\*, 7z: exact duplicates between archives, image similarity inside archives, audio similarity inside archives.

### Scan modes and organisation

- Whole-folder scan, recursive or not.
- "Per top-level subfolder" mode: each first-level subfolder is analysed independently, results grouped per folder.
- "Compare with another folder" mode: cross-folder duplicates only (useful for backup verification).
- Persistent sessions: every scan is saved on disk and can be reopened without rescanning.
- Incremental scan: a previous session is resumed and only new or modified files are processed.
- Scan profiles: saved configurations (folder, options, filters) for one-click reruns.

### Side-by-side comparators

- Image comparator: overlay slider, metadata (resolution, size, date), "Keep this one" button.
- Video comparator: master / slave synchronised playback, common scrubbing, metadata (resolution, duration, codec).
- Audio comparator: synchronised players, metadata (duration, bitrate, format).
- Archive comparator: 3-column grid (archive A | score | archive B) with lazy-loaded thumbnails, click to open the entry in the system viewer.
- Video playback: automatic remux to MP4 (no re-encoding) for `.flv`, `.mkv`, `.mov`, `.ts`, `.3gp` and similar containers; placeholder + "open in system player" button for formats the WebView cannot read.
- Local HTTP server with HTTP Range support for smooth scrubbing of natively-unsupported video containers.

### Selection and deletion

- Automatic selection rules: highest resolution, most recent file, priority folder, path pattern, etc.
- Persistent ignore list: mark a file or group to exclude it from all future scans.
- Keyboard shortcuts in comparators (left / right, next, ignore).
- Deletion always sends to the system trash (recoverable).
- Text filter on post-scan results.
- Pre-scan filters: extensions, min / max file size, modification date.

### Export and reporting

- CSV export of duplicate groups.
- Standalone HTML report: navigable offline, embedded thumbnails.

### Performance

- 8 configurable pHash optimisations: size filter, aspect filter via header reading, two-pass hash, compact binary cache (PHCB), Rayon parallel comparison, fast decode via EXIF thumbnail, bucket index O(n * bucket_size), aspect sort O(log n).
- Binary pHash cache: ~79 bytes per entry vs ~350 in JSON, roughly 4x more compact.
- Video cache: stores metadata (duration, resolution, codec) to avoid invoking ffprobe on cache hits.
- Lazy loading of thumbnails via `IntersectionObserver`: no expensive call for groups out of viewport.
- Lazy loading of folder sections in "per subfolder" mode.

### Progress and UX

- Strictly monotonic progress bar: `current` never moves backwards, reaches exactly 100 % at the end.
- Heartbeat counter during silent phases.
- ETA computed from a smoothed throughput.
- System notification at the end of long scans.
- Live phase indicator (reading, exact hash, images, videos, audio, archives).
- Exact archive entry counting (instead of a size-based heuristic) for a reliable bar even with dense `.tar.bz2` files.

### Platform and distribution

- Two installers per platform: **light** (no bundled binaries) and **full** (fpcalc + ffmpeg + ffprobe included).
- Windows: NSIS (`.exe`) and MSI installers.
- Linux: AppImage and `.deb`.
- macOS: `.dmg` (unsigned, see README for first-launch procedure).
- Automatic discovery of external tools (fpcalc, ffmpeg, ffprobe) in common system paths (Chocolatey, Scoop, Homebrew, `/usr/bin`...) before falling back to `PATH`.
- Windows subprocesses use the `CREATE_NO_WINDOW` flag on every ffmpeg / ffprobe / fpcalc call to avoid flashing terminals.

### Help and internationalisation

- 38 bilingual FR / EN help articles (F1 key).
- FR / EN UI with on-the-fly switching.
- Dark and light themes.
- Drag-and-drop a folder onto the window to select it.

### Quality

- 269 Rust tests (engine independent of the UI, testable on its own).
- 440 TypeScript tests (React components + integration).
- Strict TypeScript verification (`tsc --noEmit`) in CI.
- Progress invariant tests (anti-regression sentinel).

[1.0.0]: https://github.com/JulienMattiussi/deduplicateur/releases/tag/v1.0.0
