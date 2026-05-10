# Changelog

All notable changes to Déduplicateur are documented here.

This file follows the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format and the project adheres to [Semantic Versioning](https://semver.org/).

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
