# Changelog

All notable changes to Déduplicateur are documented here.

This file follows the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format and the project adheres to [Semantic Versioning](https://semver.org/).

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
