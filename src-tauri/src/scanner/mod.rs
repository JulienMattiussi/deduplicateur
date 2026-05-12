mod types;
mod fs;
pub mod hash;
mod exact_phase;
mod phash_phase;
mod video_phase;
mod audio_phase;
mod archive_phase;

pub use types::{
    DuplicateFile, DuplicateGroup, DiskWarningHandler, DiskWarningMode, FileSource, ScanParams,
    ScanResult, ArchiveGroupResult,
};
// `ArchiveInGroup` est utilise par les tests du crate (lib.rs) ; la re-export
// declenche un warning "unused" en build prod, donc on l'expose seulement
// pour les tests via cfg(test).
#[cfg(test)]
pub use types::ArchiveInGroup;

use std::collections::HashMap;
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Instant;

use crate::archive;
use crate::audio::{fpcalc_available, is_audio};
use crate::video::is_ffmpeg_available;
use fs::{collect_files, first_level_subdir, size_candidates, is_image, is_video};

/// Donnees partagees entre les phases (calculees une seule fois dans scan_folder).
struct Ctx {
    pub total_to_hash: usize,
    pub phash_estimate: usize,
    pub phash_compare_estimate: usize,
    pub video_estimate: usize,
    pub total_work: usize,
    pub analysis_total: usize,
    pub scanned_files: usize,
    pub compare_mode: bool,
}

fn timing_log(enabled: bool, data_dir: Option<&str>, t_start: &Instant, msg: &str) {
    if !enabled { return; }
    let Some(dir) = data_dir else { return };
    let elapsed = t_start.elapsed().as_secs();
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(Path::new(dir).join("timing.log"))
    {
        let _ = writeln!(f, "[+{}s] {}", elapsed, msg);
    }
}

pub fn scan_folder<F>(
    params: ScanParams,
    cancelled: Arc<AtomicBool>,
    on_progress: F,
) -> Result<ScanResult, String>
where
    F: Fn(usize, usize, usize, &str, usize, usize, &str) + Send + Sync,
{
    let start = Instant::now();

    let timing_enabled = params.phash_config.perf_log_enabled;
    if timing_enabled {
        if let Some(dir) = params.data_dir.as_deref() {
            let _ = std::fs::write(Path::new(dir).join("timing.log"), "");
        }
    }

    let compare_mode = params.secondary_folder.is_some();

    let primary_files_raw = collect_files(
        Path::new(&params.folder),
        params.recursive,
        &params.excluded,
        &cancelled,
        &params.exclude_extensions,
        &params.include_extensions,
        params.min_file_size_kb.saturating_mul(1024),
        params.max_file_size_kb.saturating_mul(1024),
        params.min_modified_timestamp,
        params.max_modified_timestamp,
    )?;

    let secondary_files_raw: Vec<DuplicateFile> = if let Some(ref sec) = params.secondary_folder {
        collect_files(
            Path::new(sec),
            true,
            &params.excluded,
            &cancelled,
            &params.exclude_extensions,
            &params.include_extensions,
            params.min_file_size_kb.saturating_mul(1024),
            params.max_file_size_kb.saturating_mul(1024),
            params.min_modified_timestamp,
            params.max_modified_timestamp,
        )?
    } else {
        vec![]
    };

    let primary_files: Vec<DuplicateFile> = if compare_mode {
        primary_files_raw.into_iter().map(|mut f| { f.source = Some(FileSource::Primary); f }).collect()
    } else {
        primary_files_raw
    };
    let secondary_files: Vec<DuplicateFile> = secondary_files_raw.into_iter()
        .map(|mut f| { f.source = Some(FileSource::Secondary); f })
        .collect();

    let mut all_files = primary_files;
    all_files.extend(secondary_files);

    let scanned_files = all_files.len();

    // Conserver une copie pour la phase archives (avant la consommation par le filtrage)
    let all_files_for_archives: Vec<DuplicateFile> = if params.scan_archives {
        all_files.clone()
    } else {
        vec![]
    };

    let files: Vec<DuplicateFile> = if params.find_similar_audio && !params.find_similar && !params.find_similar_videos {
        all_files.into_iter().filter(|f| is_audio(&f.path)).collect()
    } else if params.find_similar && !params.find_similar_videos && !params.find_similar_audio {
        all_files.into_iter().filter(|f| is_image(&f.path)).collect()
    } else if params.find_similar_videos && !params.find_similar && !params.find_similar_audio {
        all_files.into_iter().filter(|f| is_video(&f.path)).collect()
    } else {
        all_files
    };

    let analysis_total = files.len();

    let phash_candidates_all: Vec<DuplicateFile> = if params.find_similar {
        files.iter().filter(|f| is_image(&f.path)).cloned().collect()
    } else {
        vec![]
    };
    let phash_estimate = phash_candidates_all.len();

    let video_candidates_all: Vec<DuplicateFile> = if params.find_similar_videos {
        files.iter().filter(|f| is_video(&f.path)).cloned().collect()
    } else {
        vec![]
    };
    let video_estimate = video_candidates_all.len();

    let audio_candidates_all: Vec<DuplicateFile> = if params.find_similar_audio {
        files.iter().filter(|f| is_audio(&f.path)).cloned().collect()
    } else {
        vec![]
    };
    let audio_estimate = audio_candidates_all.len();

    let partitions: Vec<(Option<String>, Vec<DuplicateFile>)> = if params.by_folder {
        let root = Path::new(&params.folder);
        let mut map: HashMap<String, Vec<DuplicateFile>> = HashMap::new();
        for f in files {
            let key = first_level_subdir(root, Path::new(&f.path));
            map.entry(key).or_default().push(f);
        }
        map.into_iter().map(|(k, v)| (Some(k), v)).collect()
    } else {
        vec![(None, files)]
    };

    let partition_candidates: Vec<(Option<String>, Vec<Vec<DuplicateFile>>)> = partitions
        .into_iter()
        .map(|(key, files)| (key, size_candidates(files)))
        .collect();

    let total_to_hash: usize = partition_candidates
        .iter()
        .map(|(_, cands)| cands.iter().map(|v| v.len()).sum::<usize>())
        .sum();

    // Chaque phase emet plusieurs `on_progress` par item traite (sous-phases : decode,
    // hash, compare, etc.). Pour que `total_work` soit une borne SUPERIEURE stricte du
    // nombre d'emits attendus, on multiplie le compte d'items par le nb d'emits par item.
    // Ces constantes doivent rester alignees avec le code des phases (cf. audit dans
    // PLAN.md / AGENTS.md : exact=1, images=3, videos=2, audio=2, archives_p1=1, archives_p2=2).
    const EMITS_EXACT: usize = 1;
    const EMITS_IMAGES: usize = 3;
    const EMITS_VIDEOS: usize = 2;
    const EMITS_AUDIO: usize = 2;
    const EMITS_ARCH_P1: usize = 1;
    const EMITS_ARCH_P2: usize = 2;       // extraction + pHash (images), matching silencieux
    const EMITS_ARCH_AUDIO: usize = 2;    // extraction + fpcalc (audio), matching silencieux

    // Estimation du travail des phases archives, INCLUSE dans total_work upfront pour que
    // la barre de progression avance de maniere monotone tout au long du scan.
    // - archive_phase1 : xxh3 sur toutes les entrees (count_entries_fast)
    // - archive_phase2 : extraction + pHash sur les images (mode Image)
    // - archive_phase_audio : extraction + fpcalc sur les audios (mode Audio)
    // Phase 2 et phase audio sont mutuellement exclusives (mode Image vs Audio).
    //
    // Pour les tar.* le comptage exact requiert de decompresser le stream pour lire
    // les headers (5-30s sur de gros tar.bz2). On emet une phase "counting_archives"
    // visible cote frontend avec le nom de l'archive en cours, sinon l'utilisateur voit
    // l'app figee entre "Lecture des fichiers" et la Phase 1.
    // L'estimation de taille d'extraction (image ou audio) est calculee dans la meme
    // passe que le comptage (`count_and_estimate_archive_*`) pour eviter une double
    // iteration des en-tetes d'archives. Apres la boucle, si le handler est fourni et
    // que l'estimation depasse l'espace libre - MARGE, on bloque sur le handler qui
    // affiche la modale frontend. La decision peut basculer `effective_skip_extraction`
    // a true pour la suite du scan (Phase 2/3 sautent l'extraction).
    let mut effective_skip_extraction = params.skip_archive_extraction;
    let (archive_phase1_count, archive_phase2_image_count, archive_audio_count) = if params.scan_archives {
        // Verification stricte : extension + magic bytes du contenu. Sans ca, un fichier
        // dont l'extension ment (ex. `.cbz` qui contient en realite du RAR) etait confie
        // au crate `zip` qui scanne tout le fichier a la recherche d'une signature EOCD
        // inexistante, pouvant bloquer ou prendre plusieurs minutes par fichier. Cout :
        // 1 ouverture + lecture de 6 octets par archive, fait une seule fois ici.
        let archive_files: Vec<&DuplicateFile> = all_files_for_archives.iter()
            .filter(|f| archive::detect_archive_format_verified(std::path::Path::new(&f.path)).is_some())
            .collect();
        if archive_files.len() < 2 {
            (0usize, 0usize, 0usize)
        } else {
            let n_arch = archive_files.len();
            let mut p1: usize = 0;
            let mut p2: usize = 0;
            let mut p3: usize = 0;
            let mut bytes_p2: u64 = 0;
            let mut bytes_p3: u64 = 0;
            let want_p2 = params.find_similar && !effective_skip_extraction;
            let want_p3 = params.find_similar_audio && !effective_skip_extraction;
            for (i, f) in archive_files.iter().enumerate() {
                if cancelled.load(Ordering::Relaxed) { break; }
                // total=0 signale au frontend qu'on est en phase preliminaire (pas de
                // bar de progression, juste un spinner + label + nom de fichier).
                on_progress(0, 0, scanned_files, &f.name, i + 1, n_arch, "counting_archives");
                let path = std::path::Path::new(&f.path);
                p1 += archive::count_entries_fast(path);
                if want_p2 {
                    let (n, b) = archive::count_and_estimate_archive_image_entries(path);
                    p2 += n;
                    bytes_p2 = bytes_p2.saturating_add(b);
                }
                if want_p3 {
                    let (n, b) = archive::count_and_estimate_archive_audio_entries(path);
                    p3 += n;
                    bytes_p3 = bytes_p3.saturating_add(b);
                }
            }
            // Pre-check espace disque : si une extraction est prevue (mode Image ou Audio
            // + scan_archives + handler fourni), on verifie l'espace dispo. Si insuffisant,
            // on bloque sur le handler qui affiche la modale frontend et attend la decision.
            if !cancelled.load(Ordering::Relaxed) {
                if let Some(handler) = params.disk_warning_handler.as_ref() {
                    let (mode, needed) = if want_p2 {
                        (Some(DiskWarningMode::Image), bytes_p2)
                    } else if want_p3 {
                        (Some(DiskWarningMode::Audio), bytes_p3)
                    } else {
                        (None, 0u64)
                    };
                    if let (Some(mode), Some(data_dir)) = (mode, params.data_dir.as_deref()) {
                        if needed > 0 {
                            let available = archive::extractor::available_disk_space(Path::new(data_dir));
                            // Marge de securite : on exige `available - needed >= 1 Go`.
                            // Doit rester aligne avec l'ancien `MIN_FREE_AFTER_EXTRACT_BYTES`
                            // de commands/archive.rs (ce dernier est devenu dead code).
                            const MIN_FREE_AFTER_EXTRACT_BYTES: u64 = 1 << 30;
                            let needs_warning = available < needed.saturating_add(MIN_FREE_AFTER_EXTRACT_BYTES);
                            if needs_warning {
                                let deficit = needed.saturating_add(MIN_FREE_AFTER_EXTRACT_BYTES).saturating_sub(available);
                                let decision = handler(needed, available, deficit, mode);
                                match decision {
                                    crate::DiskDecision::Skip => {
                                        effective_skip_extraction = true;
                                        // Le total_work compte deja les emits Phase 2/3. Ils ne
                                        // seront pas emis (extraction sautee), mais le sync_to
                                        // final rattrape jusqu'a total_work. Pas de divergence.
                                    }
                                    crate::DiskDecision::Cancel => {
                                        cancelled.store(true, Ordering::Relaxed);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            (p1.max(1), p2, p3)
        }
    } else {
        (0, 0, 0)
    };

    let total_work = total_to_hash * EMITS_EXACT
        + phash_estimate * EMITS_IMAGES
        + video_estimate * EMITS_VIDEOS
        + audio_estimate * EMITS_AUDIO
        + archive_phase1_count * EMITS_ARCH_P1
        + archive_phase2_image_count * EMITS_ARCH_P2
        + archive_audio_count * EMITS_ARCH_AUDIO;

    // Budgets cumulatifs par phase (frontiere atteinte a la fin de chaque phase).
    // Utilises pour le sync de fin de phase qui force le compteur global a sa valeur exacte,
    // garantissant la monotonie : meme si une phase emet moins que son budget (ex. cache warm,
    // exclusions par filtres), on rattrape la difference avant la phase suivante.
    // Le budget apres archives_phash est total_work par construction (derniere phase).
    let budget_after_exact = total_to_hash * EMITS_EXACT;
    let budget_after_images = budget_after_exact + phash_estimate * EMITS_IMAGES;
    let budget_after_videos = budget_after_images + video_estimate * EMITS_VIDEOS;
    let budget_after_audio = budget_after_videos + audio_estimate * EMITS_AUDIO;

    // Compteur global d'emits. Chaque emit incremente de 1, peu importe sa sous-phase.
    // Le wrapper `wrapped_on_progress` ignore le `current` calcule par les phases et
    // utilise ce compteur a la place. Garantit la monotonie absolue : current ne fait
    // que monter, jamais redescendre, meme aux frontieres entre sous-phases.
    let progress_counter = Arc::new(AtomicUsize::new(0));

    // Ctx contient encore phash_compare_estimate / phash_estimate / video_estimate utilises
    // par video_phase et audio_phase pour calculer un offset local. Cet offset alimente le
    // `current` envoye a on_progress, mais notre wrapper l'ECRASE avec le compteur global.
    // Donc ces valeurs sont dead-flow ; on les laisse pour ne pas modifier les phases.
    let ctx = Ctx {
        total_to_hash,
        phash_estimate,
        phash_compare_estimate: phash_estimate,
        video_estimate,
        total_work,
        analysis_total,
        scanned_files,
        compare_mode,
    };

    timing_log(timing_enabled, params.data_dir.as_deref(), &start, &format!(
        "scan_start: files={} total_to_hash={} phash_estimate={} total_work={}",
        analysis_total, total_to_hash, phash_estimate, total_work
    ));

    let groups_counter = params.groups_counter.clone()
        .unwrap_or_else(|| Arc::new(AtomicUsize::new(0)));

    // Wrapper qui remplace le `current` calcule par chaque phase par un compteur global
    // incremente de 1 par emit. Garantit la monotonie : meme si une phase a un emit pattern
    // qui se chevauche entre sous-phases (ex. pHash decode + hash compute partagent leur
    // range), le compteur partage ne fait jamais marche arriere.
    let pc = Arc::clone(&progress_counter);
    let on_progress_ref = &on_progress;
    let wrapped_on_progress = move |_current: usize, total: usize, scanned: usize, file: &str, phase_current: usize, phase_total: usize, phase: &str| {
        let cur = pc.fetch_add(1, Ordering::Relaxed) + 1;
        on_progress_ref(cur, total, scanned, file, phase_current, phase_total, phase);
    };

    // Sync de fin de phase : force le compteur global a la valeur exacte du budget cumule
    // jusqu'a cette phase incluse, SANS jamais reculer (fetch_max). Si la phase a emis moins
    // que prevu (cache warm, exclusions par filtres), on rattrape la difference d'un coup.
    // Si la phase a emis plus (defensif : ne devrait pas arriver), le compteur reste a sa
    // valeur courante. La barre ne fait jamais marche arriere. Cf. principe "+ aux transitions".
    let sync_to = |target: usize, phase: &str, total_work: usize, scanned: usize| {
        let prev = progress_counter.fetch_max(target, Ordering::Relaxed);
        let new = prev.max(target);
        if new > prev {
            on_progress(new, total_work, scanned, "", new.saturating_sub(prev), 0, phase);
        }
    };

    // --- Phase 1 : doublons exacts ---
    let (mut groups, mut was_cancelled) = exact_phase::run(
        &params,
        &ctx,
        partition_candidates,
        timing_enabled,
        &start,
        &cancelled,
        &wrapped_on_progress,
        &groups_counter,
    );
    sync_to(budget_after_exact, "exact", total_work, scanned_files);

    // --- Phase 2 : images similaires (pHash) ---
    timing_log(timing_enabled, params.data_dir.as_deref(), &start, "phash_start");
    if params.find_similar && !was_cancelled && !cancelled.load(Ordering::Relaxed) {
        let (new_groups, wc) = phash_phase::run(
            &params,
            &ctx,
            phash_candidates_all,
            &groups,
            timing_enabled,
            &start,
            &cancelled,
            &wrapped_on_progress,
            &groups_counter,
        );
        groups.extend(new_groups);
        was_cancelled |= wc;
    }
    sync_to(budget_after_images, "images", total_work, scanned_files);

    // --- Phase 3 : videos similaires ---
    let ffmpeg_missing = params.find_similar_videos && !is_ffmpeg_available();
    let fpcalc_missing = params.find_similar_audio && !fpcalc_available();

    if params.find_similar_videos && !was_cancelled && !cancelled.load(Ordering::Relaxed)
        && !ffmpeg_missing
    {
        let (new_groups, wc) = video_phase::run(
            &params,
            &ctx,
            video_candidates_all,
            &groups,
            timing_enabled,
            &start,
            &cancelled,
            &wrapped_on_progress,
            &groups_counter,
        );
        groups.extend(new_groups);
        was_cancelled |= wc;
    }
    sync_to(budget_after_videos, "videos", total_work, scanned_files);

    // --- Phase 4 : audio similaire ---
    if params.find_similar_audio && !was_cancelled && !cancelled.load(Ordering::Relaxed)
        && !fpcalc_missing
    {
        let (new_groups, wc) = audio_phase::run(
            &params,
            &ctx,
            audio_candidates_all,
            &groups,
            timing_enabled,
            &start,
            &cancelled,
            &wrapped_on_progress,
            &groups_counter,
        );
        groups.extend(new_groups);
        was_cancelled |= wc;
    }
    sync_to(budget_after_audio, "audio", total_work, scanned_files);

    // --- Phase 5 : archives (comparaison de contenu entre archives) ---
    let (archive_groups, archive_entries_cache) = if params.scan_archives && !was_cancelled {
        let archive_progress_base = budget_after_audio;  // pas utilise par les phases archives, garde pour API
        let res = archive_phase::run(
            &all_files_for_archives,
            &cancelled,
            archive_progress_base,
            ctx.total_work,
            params.find_similar,
            params.sim_threshold,
            params.find_similar_audio,
            params.audio_sim_threshold,
            params.audio_duration_tolerance,
            params.data_dir.as_deref(),
            effective_skip_extraction,
            &wrapped_on_progress,
        );
        (res.groups, res.entries_cache)
    } else {
        (vec![], std::collections::HashMap::new())
    };
    // Sync final a total_work : garantit qu'on atteint exactement 100% (rattrape le matching
    // silencieux d'archives Phase 2 et toute autre sous-phase qui n'aurait pas emis).
    sync_to(total_work, "archives_phash", total_work, scanned_files);

    if params.by_folder {
        groups.sort_by(|a, b| {
            let ka = a.folder_key.as_deref().unwrap_or("");
            let kb = b.folder_key.as_deref().unwrap_or("");
            let wa = a.size * (a.files.len() as u64 - 1);
            let wb = b.size * (b.files.len() as u64 - 1);
            ka.cmp(kb).then_with(|| wb.cmp(&wa))
        });
    } else {
        groups.sort_by(|a, b| {
            let wa = a.size * (a.files.len() as u64 - 1);
            let wb = b.size * (b.files.len() as u64 - 1);
            wb.cmp(&wa)
        });
    }

    if !params.ignored_keys.is_empty() {
        groups.retain(|g| {
            let mut paths: Vec<&str> = g.files.iter().map(|f| f.path.as_str()).collect();
            paths.sort_unstable();
            let key = paths.join("|");
            !params.ignored_keys.contains(&key)
        });
    }

    let total_wasted_bytes = groups
        .iter()
        .map(|g| g.size * (g.files.len() as u64 - 1))
        .sum();

    Ok(ScanResult {
        groups,
        total_wasted_bytes,
        scanned_files,
        duration_ms: start.elapsed().as_millis(),
        partial: was_cancelled,
        ffmpeg_missing,
        fpcalc_missing,
        archive_groups,
        archive_entries_cache,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::Ordering;
    use std::sync::Arc;
    use tempfile::TempDir;

    fn no_progress(_: usize, _: usize, _: usize, _: &str, _: usize, _: usize, _: &str) {}
    fn no_cancel() -> Arc<AtomicBool> {
        Arc::new(AtomicBool::new(false))
    }

    fn write_file(dir: &std::path::Path, name: &str, content: &[u8]) {
        fs::write(dir.join(name), content).unwrap();
    }

    fn write_solid_png(dir: &std::path::Path, name: &str, color: [u8; 3], size: u32) {
        write_solid_png_dims(dir, name, color, size, size);
    }

    fn write_solid_png_dims(
        dir: &std::path::Path,
        name: &str,
        color: [u8; 3],
        width: u32,
        height: u32,
    ) {
        use image::{ImageBuffer, Rgb};
        let img: ImageBuffer<Rgb<u8>, Vec<u8>> =
            ImageBuffer::from_pixel(width, height, Rgb(color));
        img.save(dir.join(name)).unwrap();
    }

    // --- Tests doublons exacts ---

    #[test]
    fn dossier_vide() {
        let dir = TempDir::new().unwrap();
        let r = scan_folder(ScanParams::new(dir.path().to_str().unwrap()), no_cancel(), no_progress).unwrap();
        assert_eq!(r.groups.len(), 0);
        assert_eq!(r.scanned_files, 0);
        assert_eq!(r.total_wasted_bytes, 0);
    }

    #[test]
    fn aucun_doublon() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.txt", b"contenu A");
        write_file(dir.path(), "b.txt", b"contenu B");
        write_file(dir.path(), "c.txt", b"contenu C");
        let r = scan_folder(ScanParams::new(dir.path().to_str().unwrap()), no_cancel(), no_progress).unwrap();
        assert_eq!(r.groups.len(), 0);
        assert_eq!(r.scanned_files, 3);
    }

    #[test]
    fn deux_fichiers_identiques() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.txt", b"contenu duplique");
        write_file(dir.path(), "b.txt", b"contenu duplique");
        let r = scan_folder(ScanParams::new(dir.path().to_str().unwrap()), no_cancel(), no_progress).unwrap();
        assert_eq!(r.groups.len(), 1);
        assert_eq!(r.groups[0].files.len(), 2);
    }

    #[test]
    fn trois_copies() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.txt", b"triple exemplaire");
        write_file(dir.path(), "b.txt", b"triple exemplaire");
        write_file(dir.path(), "c.txt", b"triple exemplaire");
        let r = scan_folder(ScanParams::new(dir.path().to_str().unwrap()), no_cancel(), no_progress).unwrap();
        assert_eq!(r.groups.len(), 1);
        assert_eq!(r.groups[0].files.len(), 3);
    }

    #[test]
    fn meme_taille_contenu_different() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.txt", b"aaaaaaa!!");
        write_file(dir.path(), "b.txt", b"bbbbbbb!!");
        let r = scan_folder(ScanParams::new(dir.path().to_str().unwrap()), no_cancel(), no_progress).unwrap();
        assert_eq!(r.groups.len(), 0);
    }

    #[test]
    fn tailles_differentes_pas_doublons() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "petit.txt", b"hi");
        write_file(dir.path(), "grand.txt", b"bonjour le monde");
        let r = scan_folder(ScanParams::new(dir.path().to_str().unwrap()), no_cancel(), no_progress).unwrap();
        assert_eq!(r.groups.len(), 0);
    }

    #[test]
    fn plusieurs_groupes() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a1.txt", b"groupe un ici!!");
        write_file(dir.path(), "a2.txt", b"groupe un ici!!");
        write_file(dir.path(), "b1.txt", b"groupe deux la!!");
        write_file(dir.path(), "b2.txt", b"groupe deux la!!");
        write_file(dir.path(), "c.txt",  b"fichier unique !!");
        let r = scan_folder(ScanParams::new(dir.path().to_str().unwrap()), no_cancel(), no_progress).unwrap();
        assert_eq!(r.groups.len(), 2);
        assert_eq!(r.scanned_files, 5);
    }

    #[test]
    fn calcul_espace_gaspille() {
        let dir = TempDir::new().unwrap();
        let content = b"exactement ce contenu";
        write_file(dir.path(), "a.txt", content);
        write_file(dir.path(), "b.txt", content);
        write_file(dir.path(), "c.txt", content);
        let r = scan_folder(ScanParams::new(dir.path().to_str().unwrap()), no_cancel(), no_progress).unwrap();
        assert_eq!(r.total_wasted_bytes, content.len() as u64 * 2);
    }

    #[test]
    fn recursif_detecte_sous_dossiers() {
        let dir = TempDir::new().unwrap();
        let sub = dir.path().join("sous");
        fs::create_dir(&sub).unwrap();
        write_file(dir.path(), "a.txt", b"contenu commun");
        write_file(&sub, "b.txt", b"contenu commun");

        let r = scan_folder(ScanParams::new(dir.path().to_str().unwrap()), no_cancel(), no_progress).unwrap();
        assert_eq!(r.scanned_files, 1);
        assert_eq!(r.groups.len(), 0);

        let r = scan_folder(
            ScanParams { recursive: true, ..ScanParams::new(dir.path().to_str().unwrap()) },
            no_cancel(), no_progress,
        ).unwrap();
        assert_eq!(r.scanned_files, 2);
        assert_eq!(r.groups.len(), 1);
    }

    #[test]
    fn exclusion_de_dossier() {
        let dir = TempDir::new().unwrap();
        let nm = dir.path().join("node_modules");
        fs::create_dir(&nm).unwrap();
        write_file(dir.path(), "a.txt", b"contenu commun");
        write_file(&nm, "b.txt", b"contenu commun");

        let r = scan_folder(
            ScanParams {
                recursive: true,
                excluded: vec!["node_modules".to_string()],
                ..ScanParams::new(dir.path().to_str().unwrap())
            },
            no_cancel(), no_progress,
        ).unwrap();
        assert_eq!(r.scanned_files, 1);
        assert_eq!(r.groups.len(), 0);
    }

    #[test]
    fn annulation_retourne_resultat_partiel() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.txt", b"contenu identique");
        write_file(dir.path(), "b.txt", b"contenu identique");
        let cancelled = Arc::new(AtomicBool::new(true));
        let r = scan_folder(ScanParams::new(dir.path().to_str().unwrap()), cancelled, no_progress);
        let result = r.expect("scan_folder doit reussir meme si annule");
        assert!(result.partial, "le resultat doit etre marque partiel");
    }

    #[test]
    fn progression_est_appelee() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.txt", b"contenu identique");
        write_file(dir.path(), "b.txt", b"contenu identique");
        let count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let c = Arc::clone(&count);
        scan_folder(
            ScanParams::new(dir.path().to_str().unwrap()),
            no_cancel(),
            move |_, _, _, _: &str, _, _, _: &str| { c.fetch_add(1, Ordering::Relaxed); },
        ).unwrap();
        assert!(count.load(Ordering::Relaxed) > 0);
    }

    /// Verifie les invariants de la progression :
    /// - aucun emit ne depasse `total_work` (borne stricte)
    /// - le compteur global atteint exactement `total_work` a la fin (= 100%)
    ///
    /// Note : on ne teste PAS la monotonie emit-par-emit ici parce que les phases
    /// utilisent rayon (par_iter) et les emits paralleles peuvent arriver dans le
    /// desordre dans un test direct. La monotonie *visible* est garantie par le
    /// filtre max dans `commands/scan.rs` (snapshot ne s'ecrase que si current >=
    /// existing) ; cf. test d'integration scan_progress_monotone_via_throttle.
    ///
    /// Les emits avec total=0 sont **preliminaires** (phase counting_archives, avant que
    /// total_work soit calcule) et exclus de la verification d'invariants. Ils servent
    /// uniquement a faire vivre l'UI pendant le comptage des entrees d'archives tar/7z.
    fn assert_progress_invariants(recorded: &[(usize, usize)]) {
        let scan_emits: Vec<(usize, usize)> = recorded.iter().filter(|(_, t)| *t > 0).copied().collect();
        assert!(!scan_emits.is_empty(), "au moins un emit avec total > 0 attendu");
        let total = scan_emits[0].1;
        for (i, &(cur, t)) in scan_emits.iter().enumerate() {
            assert_eq!(t, total, "total doit etre constant (emit #{})", i);
            assert!(cur <= total, "current ne doit jamais depasser total : emit #{} cur={} > total={}", i, cur, total);
        }
        let max_cur = scan_emits.iter().map(|(c, _)| *c).max().unwrap();
        assert_eq!(max_cur, total, "current max doit egaler total (= 100% atteint)");
    }

    #[test]
    fn progression_atteint_total_avec_phases_simples() {
        // Cas standard : exact + pHash. Verifie qu'on atteint pile total_work.
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.txt", b"contenu duplique exemplaire");
        write_file(dir.path(), "b.txt", b"contenu duplique exemplaire");
        write_solid_png(dir.path(), "img1.png", [0, 128, 255], 40);
        write_solid_png(dir.path(), "img2.png", [0, 128, 255], 80);

        let emits: Arc<std::sync::Mutex<Vec<(usize, usize)>>> = Arc::new(std::sync::Mutex::new(vec![]));
        let e = Arc::clone(&emits);
        scan_folder(
            ScanParams { find_similar: true, ..ScanParams::new(dir.path().to_str().unwrap()) },
            no_cancel(),
            move |current, total, _, _: &str, _, _, _: &str| {
                e.lock().unwrap().push((current, total));
            },
        ).unwrap();

        assert_progress_invariants(&emits.lock().unwrap());
    }

    #[test]
    fn progression_atteint_total_avec_archives() {
        // Cas complexe : archives + find_similar. Le matching final dans archive_phase
        // est silencieux ; le sync de fin doit donc rattraper jusqu'a total_work exact.
        let dir = TempDir::new().unwrap();
        write_solid_png(dir.path(), "img1.png", [0, 128, 255], 40);
        write_solid_png(dir.path(), "img2.png", [0, 128, 255], 80);

        for name in ["pack_a.zip", "pack_b.zip"] {
            let zip_path = dir.path().join(name);
            let f = std::fs::File::create(&zip_path).unwrap();
            let mut w = zip::ZipWriter::new(std::io::BufWriter::new(f));
            let opts = zip::write::SimpleFileOptions::default();
            w.start_file("photo.png", opts).unwrap();
            use image::{ImageBuffer, Rgb, ImageFormat};
            use std::io::Cursor;
            let mut img: ImageBuffer<Rgb<u8>, Vec<u8>> = ImageBuffer::new(16, 16);
            for (_, _, p) in img.enumerate_pixels_mut() {
                *p = Rgb([100, 50, 30]);
            }
            let mut buf = Vec::new();
            img.write_to(&mut Cursor::new(&mut buf), ImageFormat::Png).unwrap();
            std::io::Write::write_all(&mut w, &buf).unwrap();
            w.finish().unwrap();
        }

        let data_tmp = TempDir::new().unwrap();
        let emits: Arc<std::sync::Mutex<Vec<(usize, usize)>>> = Arc::new(std::sync::Mutex::new(vec![]));
        let e = Arc::clone(&emits);
        scan_folder(
            ScanParams {
                find_similar: true,
                scan_archives: true,
                data_dir: Some(data_tmp.path().to_str().unwrap().to_string()),
                ..ScanParams::new(dir.path().to_str().unwrap())
            },
            no_cancel(),
            move |current, total, _, _: &str, _, _, _: &str| {
                e.lock().unwrap().push((current, total));
            },
        ).unwrap();

        assert_progress_invariants(&emits.lock().unwrap());
    }

    #[test]
    fn progression_apres_filtre_snapshot_max_strictement_monotone() {
        // Simule le filtrage par max applique dans commands/scan.rs : meme avec emits
        // paralleles desordonnes, le snapshot vu par le frontend est strictement monotone.
        let dir = TempDir::new().unwrap();
        for i in 0..6 {
            write_solid_png(dir.path(), &format!("img_{}.png", i), [200, 100, 50], 30);
        }

        let snapshot_current: Arc<std::sync::Mutex<usize>> = Arc::new(std::sync::Mutex::new(0));
        let observed: Arc<std::sync::Mutex<Vec<usize>>> = Arc::new(std::sync::Mutex::new(vec![]));
        let s = Arc::clone(&snapshot_current);
        let o = Arc::clone(&observed);
        scan_folder(
            ScanParams { find_similar: true, ..ScanParams::new(dir.path().to_str().unwrap()) },
            no_cancel(),
            move |current, _total, _, _: &str, _, _, _: &str| {
                let mut snap = s.lock().unwrap();
                if current >= *snap {
                    *snap = current;
                    o.lock().unwrap().push(current);
                }
            },
        ).unwrap();

        let observed_seq = observed.lock().unwrap().clone();
        assert!(!observed_seq.is_empty());
        for w in observed_seq.windows(2) {
            assert!(w[1] >= w[0], "snapshot filtre doit etre strictement monotone : {} -> {}", w[0], w[1]);
        }
    }

    #[test]
    fn modified_est_populate() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.txt", b"hello world");
        write_file(dir.path(), "b.txt", b"hello world");
        let r = scan_folder(ScanParams::new(dir.path().to_str().unwrap()), no_cancel(), no_progress).unwrap();
        assert_eq!(r.groups.len(), 1);
        for f in &r.groups[0].files {
            assert!(f.modified > 0, "modified doit etre un timestamp unix non nul");
        }
    }

    #[test]
    fn groupes_tries_par_espace_gaspille_decroissant() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "p1.txt", b"petit");
        write_file(dir.path(), "p2.txt", b"petit");
        write_file(dir.path(), "g1.txt", b"grand ici!");
        write_file(dir.path(), "g2.txt", b"grand ici!");
        let r = scan_folder(ScanParams::new(dir.path().to_str().unwrap()), no_cancel(), no_progress).unwrap();
        assert_eq!(r.groups.len(), 2);
        assert!(r.groups[0].size >= r.groups[1].size);
    }

    #[test]
    fn by_folder_isole_les_dossiers() {
        let dir = TempDir::new().unwrap();
        let sub_a = dir.path().join("A");
        let sub_b = dir.path().join("B");
        fs::create_dir(&sub_a).unwrap();
        fs::create_dir(&sub_b).unwrap();

        write_file(&sub_a, "f.txt", b"contenu commun");
        write_file(&sub_b, "f.txt", b"contenu commun");
        write_file(&sub_a, "f2.txt", b"contenu commun");

        let r = scan_folder(
            ScanParams { recursive: true, ..ScanParams::new(dir.path().to_str().unwrap()) },
            no_cancel(), no_progress,
        ).unwrap();
        assert_eq!(r.groups.len(), 1);
        assert_eq!(r.groups[0].files.len(), 3);
        assert!(r.groups[0].folder_key.is_none());

        let r = scan_folder(
            ScanParams {
                recursive: true,
                by_folder: true,
                ..ScanParams::new(dir.path().to_str().unwrap())
            },
            no_cancel(), no_progress,
        ).unwrap();
        assert_eq!(r.groups.len(), 1);
        assert_eq!(r.groups[0].files.len(), 2);
        assert_eq!(r.groups[0].folder_key.as_deref(), Some("A"));
    }

    #[test]
    fn by_folder_met_a_plat_les_sous_sous_dossiers() {
        let dir = TempDir::new().unwrap();
        let sub_a = dir.path().join("A");
        let sub_a_deep = sub_a.join("deep").join("deeper");
        fs::create_dir_all(&sub_a_deep).unwrap();

        write_file(&sub_a, "f1.txt", b"contenu commun");
        write_file(&sub_a_deep, "f2.txt", b"contenu commun");

        let r = scan_folder(
            ScanParams {
                recursive: true,
                by_folder: true,
                ..ScanParams::new(dir.path().to_str().unwrap())
            },
            no_cancel(), no_progress,
        ).unwrap();
        assert_eq!(r.groups.len(), 1);
        assert_eq!(r.groups[0].files.len(), 2);
        assert_eq!(r.groups[0].folder_key.as_deref(), Some("A"));
    }

    #[test]
    fn by_folder_trie_par_dossier_puis_espace() {
        let dir = TempDir::new().unwrap();
        let sub_a = dir.path().join("A");
        let sub_b = dir.path().join("B");
        fs::create_dir(&sub_a).unwrap();
        fs::create_dir(&sub_b).unwrap();

        write_file(&sub_b, "big1.txt", b"grand contenu!!");
        write_file(&sub_b, "big2.txt", b"grand contenu!!");
        write_file(&sub_a, "s1.txt", b"petit");
        write_file(&sub_a, "s2.txt", b"petit");

        let r = scan_folder(
            ScanParams {
                recursive: true,
                by_folder: true,
                ..ScanParams::new(dir.path().to_str().unwrap())
            },
            no_cancel(), no_progress,
        ).unwrap();
        assert_eq!(r.groups.len(), 2);
        assert_eq!(r.groups[0].folder_key.as_deref(), Some("A"));
        assert_eq!(r.groups[1].folder_key.as_deref(), Some("B"));
    }

    #[test]
    fn by_folder_fichiers_racine_ont_cle_vide() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.txt", b"contenu racine");
        write_file(dir.path(), "b.txt", b"contenu racine");

        let r = scan_folder(
            ScanParams {
                recursive: true,
                by_folder: true,
                ..ScanParams::new(dir.path().to_str().unwrap())
            },
            no_cancel(), no_progress,
        ).unwrap();
        assert_eq!(r.groups.len(), 1);
        assert_eq!(r.groups[0].folder_key.as_deref(), Some(""));
    }

    #[test]
    fn by_folder_phash_attribue_folder_key() {
        let dir = TempDir::new().unwrap();
        std::fs::create_dir(dir.path().join("A")).unwrap();
        write_solid_png(&dir.path().join("A"), "img1.png", [0, 128, 255], 40);
        write_solid_png(&dir.path().join("A"), "img2.png", [0, 128, 255], 80);

        let r = scan_folder(
            ScanParams {
                find_similar: true,
                by_folder: true,
                recursive: true,
                ..ScanParams::new(dir.path().to_str().unwrap())
            },
            no_cancel(), no_progress,
        ).unwrap();
        let similar: Vec<_> = r.groups.iter().filter(|g| g.similar).collect();
        assert_eq!(similar.len(), 1);
        assert_eq!(similar[0].folder_key.as_deref(), Some("A"));
    }

    #[test]
    fn by_folder_phash_groupe_multi_dossiers_cle_vide() {
        let dir = TempDir::new().unwrap();
        std::fs::create_dir(dir.path().join("A")).unwrap();
        std::fs::create_dir(dir.path().join("B")).unwrap();
        write_solid_png(&dir.path().join("A"), "img1.png", [0, 128, 255], 40);
        write_solid_png(&dir.path().join("B"), "img2.png", [0, 128, 255], 80);

        let r = scan_folder(
            ScanParams {
                find_similar: true,
                by_folder: true,
                recursive: true,
                ..ScanParams::new(dir.path().to_str().unwrap())
            },
            no_cancel(), no_progress,
        ).unwrap();
        let similar: Vec<_> = r.groups.iter().filter(|g| g.similar).collect();
        assert_eq!(similar.len(), 1);
        assert_eq!(similar[0].folder_key.as_deref(), Some(""));
    }

    // --- Tests pHash ---

    #[test]
    fn phash_ignore_les_non_images() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.txt", b"texte quelconque");
        write_file(dir.path(), "b.txt", b"autre texte ici");
        let r = scan_folder(
            ScanParams { find_similar: true, ..ScanParams::new(dir.path().to_str().unwrap()) },
            no_cancel(), no_progress,
        ).unwrap();
        assert_eq!(r.groups.len(), 0);
    }

    #[test]
    fn phash_ne_duplique_pas_les_doublons_exacts() {
        let dir = TempDir::new().unwrap();
        write_solid_png(dir.path(), "a.png", [255, 0, 0], 50);
        fs::copy(dir.path().join("a.png"), dir.path().join("b.png")).unwrap();

        let r = scan_folder(
            ScanParams { find_similar: true, ..ScanParams::new(dir.path().to_str().unwrap()) },
            no_cancel(), no_progress,
        ).unwrap();
        assert_eq!(r.groups.len(), 1);
        assert!(!r.groups[0].similar);
    }

    #[test]
    fn phash_groupe_images_identiques_differentes_tailles() {
        let dir = TempDir::new().unwrap();
        write_solid_png(dir.path(), "small.png", [0, 128, 255], 30);
        write_solid_png(dir.path(), "large.png", [0, 128, 255], 120);

        let r = scan_folder(
            ScanParams { find_similar: true, ..ScanParams::new(dir.path().to_str().unwrap()) },
            no_cancel(), no_progress,
        ).unwrap();
        let similar_groups: Vec<_> = r.groups.iter().filter(|g| g.similar).collect();
        assert_eq!(similar_groups.len(), 1);
        assert_eq!(similar_groups[0].files.len(), 2);
    }

    // --- Tests des optimisations ---

    #[test]
    fn phash_filtre_taille_exclut_images_sous_seuil() {
        let dir = TempDir::new().unwrap();
        for i in 0..6 {
            write_solid_png(dir.path(), &format!("small_{}.png", i), [200, 100, 50], 5);
        }

        let path = dir.path().to_str().unwrap();
        let mut cfg = crate::phash::PHashConfig::default();
        cfg.min_file_size_bytes = 5000;
        cfg.min_images_size_filter = 5;

        let r = scan_folder(
            ScanParams {
                find_similar: true,
                phash_config: cfg,
                ..ScanParams::new(path)
            },
            no_cancel(), no_progress,
        ).unwrap();
        let similar: Vec<_> = r.groups.iter().filter(|g| g.similar).collect();
        assert_eq!(similar.len(), 0);
    }

    #[test]
    fn phash_filtre_taille_inactif_sous_seuil_dimages() {
        let dir = TempDir::new().unwrap();
        write_solid_png(dir.path(), "a.png", [200, 100, 50], 5);
        write_solid_png(dir.path(), "b.png", [200, 100, 50], 6);
        write_solid_png(dir.path(), "c.png", [200, 100, 50], 7);

        let path = dir.path().to_str().unwrap();
        let mut cfg = crate::phash::PHashConfig::default();
        cfg.min_file_size_bytes = 5000;
        cfg.min_images_size_filter = 5;

        let r = scan_folder(
            ScanParams {
                find_similar: true,
                phash_config: cfg,
                ..ScanParams::new(path)
            },
            no_cancel(), no_progress,
        ).unwrap();
        let similar: Vec<_> = r.groups.iter().filter(|g| g.similar).collect();
        assert_eq!(similar.len(), 1);
        assert_eq!(similar[0].files.len(), 3);
    }

    #[test]
    fn phash_aspect_ratio_exclut_paires_incompatibles() {
        let dir = TempDir::new().unwrap();
        write_solid_png_dims(dir.path(), "portrait.png", [128, 64, 32], 10, 100);
        write_solid_png_dims(dir.path(), "landscape.png", [128, 64, 32], 100, 10);

        let path = dir.path().to_str().unwrap();
        let mut cfg = crate::phash::PHashConfig::default();
        cfg.aspect_ratio_tolerance = 0.20;
        cfg.min_images_aspect_filter = 2;

        let with_filter = scan_folder(
            ScanParams {
                find_similar: true,
                phash_config: cfg,
                ..ScanParams::new(path)
            },
            no_cancel(), no_progress,
        ).unwrap();
        let similar_with: Vec<_> = with_filter.groups.iter().filter(|g| g.similar).collect();
        assert_eq!(similar_with.len(), 0, "le filtre ratio doit exclure portrait vs paysage");

        let mut cfg_no_filter = crate::phash::PHashConfig::default();
        cfg_no_filter.aspect_ratio_tolerance = 1.0;
        cfg_no_filter.min_images_aspect_filter = 2;

        let without_filter = scan_folder(
            ScanParams {
                find_similar: true,
                phash_config: cfg_no_filter,
                ..ScanParams::new(path)
            },
            no_cancel(), no_progress,
        ).unwrap();
        let similar_without: Vec<_> = without_filter.groups.iter().filter(|g| g.similar).collect();
        assert_eq!(similar_without.len(), 1, "sans filtre ratio, les images solides sont groupees");
    }

    #[test]
    fn phash_deux_passes_meme_resultat_que_une_passe() {
        let dir = TempDir::new().unwrap();
        write_solid_png(dir.path(), "a.png", [0, 200, 100], 40);
        write_solid_png(dir.path(), "b.png", [0, 200, 100], 80);
        write_solid_png(dir.path(), "c.png", [255, 0, 0], 40);

        let path = dir.path().to_str().unwrap();

        let mut cfg_with = crate::phash::PHashConfig::default();
        cfg_with.two_pass_enabled = true;
        cfg_with.min_images_two_pass = 2;

        let mut cfg_without = crate::phash::PHashConfig::default();
        cfg_without.two_pass_enabled = false;

        let r_with = scan_folder(
            ScanParams { find_similar: true, phash_config: cfg_with, ..ScanParams::new(path) },
            no_cancel(), no_progress,
        ).unwrap();
        let r_without = scan_folder(
            ScanParams { find_similar: true, phash_config: cfg_without, ..ScanParams::new(path) },
            no_cancel(), no_progress,
        ).unwrap();

        let similar_with: usize = r_with.groups.iter().filter(|g| g.similar).map(|g| g.files.len()).sum();
        let similar_without: usize = r_without.groups.iter().filter(|g| g.similar).map(|g| g.files.len()).sum();
        assert_eq!(similar_with, similar_without, "deux-passes doit donner le meme resultat");
    }

    #[test]
    fn phash_comparaison_parallele_meme_resultat_que_sequentielle() {
        let dir = TempDir::new().unwrap();
        write_solid_png(dir.path(), "a.png", [100, 150, 200], 30);
        write_solid_png(dir.path(), "b.png", [100, 150, 200], 60);
        write_solid_png(dir.path(), "c.png", [50, 50, 50], 30);

        let path = dir.path().to_str().unwrap();

        let mut cfg_par = crate::phash::PHashConfig::default();
        cfg_par.parallel_compare_enabled = true;
        cfg_par.min_images_parallel_compare = 2;

        let mut cfg_seq = crate::phash::PHashConfig::default();
        cfg_seq.parallel_compare_enabled = false;

        let r_par = scan_folder(
            ScanParams { find_similar: true, phash_config: cfg_par, ..ScanParams::new(path) },
            no_cancel(), no_progress,
        ).unwrap();
        let r_seq = scan_folder(
            ScanParams { find_similar: true, phash_config: cfg_seq, ..ScanParams::new(path) },
            no_cancel(), no_progress,
        ).unwrap();

        let groups_par: usize = r_par.groups.iter().filter(|g| g.similar).count();
        let groups_seq: usize = r_seq.groups.iter().filter(|g| g.similar).count();
        assert_eq!(groups_par, groups_seq, "parallele et sequentiel doivent trouver les memes groupes");
    }

    #[test]
    fn annulation_pendant_phash_retourne_resultat_partiel() {
        let dir = TempDir::new().unwrap();
        write_solid_png(dir.path(), "a.png", [255, 0, 0], 20);
        write_solid_png(dir.path(), "b.png", [0, 255, 0], 20);
        write_solid_png(dir.path(), "c.png", [0, 0, 255], 20);
        write_solid_png(dir.path(), "d.png", [128, 128, 0], 20);

        let path = dir.path().to_str().unwrap();
        let cancelled = Arc::new(AtomicBool::new(true));

        let r = scan_folder(
            ScanParams {
                find_similar: true,
                phash_config: crate::phash::PHashConfig { cache_enabled: false, ..crate::phash::PHashConfig::default() },
                ..ScanParams::new(path)
            },
            cancelled,
            no_progress,
        ).expect("scan_folder doit reussir meme si annule");

        assert!(r.partial, "le resultat doit etre marque partiel quand annule pendant phash");
    }

    #[test]
    fn phash_cache_invalide_si_mtime_change() {
        let dir = TempDir::new().unwrap();
        let cache_dir = TempDir::new().unwrap();
        write_solid_png(dir.path(), "a.png", [10, 20, 30], 30);
        write_solid_png(dir.path(), "b.png", [10, 20, 30], 30);

        let path = dir.path().to_str().unwrap();
        let data_dir = cache_dir.path().to_str().unwrap().to_string();

        let r1 = scan_folder(
            ScanParams {
                find_similar: true,
                phash_config: crate::phash::PHashConfig { cache_enabled: true, ..crate::phash::PHashConfig::default() },
                data_dir: Some(data_dir.clone()),
                ..ScanParams::new(path)
            },
            no_cancel(),
            no_progress,
        ).expect("scan 1 doit reussir");
        assert!(!r1.partial, "scan 1 ne doit pas etre partiel");

        write_solid_png(dir.path(), "a.png", [255, 128, 64], 30);
        std::thread::sleep(std::time::Duration::from_millis(10));

        let r2 = scan_folder(
            ScanParams {
                find_similar: true,
                phash_config: crate::phash::PHashConfig { cache_enabled: true, ..crate::phash::PHashConfig::default() },
                data_dir: Some(data_dir),
                ..ScanParams::new(path)
            },
            no_cancel(),
            no_progress,
        ).expect("scan 2 doit reussir meme apres changement de mtime");

        assert!(!r2.partial, "scan 2 ne doit pas etre partiel");
    }

    #[test]
    fn phash_aspect_ratio_exclut_exactement_au_seuil() {
        let dir = TempDir::new().unwrap();
        write_solid_png_dims(dir.path(), "portrait.png", [100, 200, 150], 1, 4);
        write_solid_png_dims(dir.path(), "landscape.png", [100, 200, 150], 4, 1);

        let path = dir.path().to_str().unwrap();
        let mut cfg = crate::phash::PHashConfig::default();
        cfg.aspect_ratio_tolerance = 0.1;
        cfg.min_images_aspect_filter = 2;
        cfg.cache_enabled = false;

        let r = scan_folder(
            ScanParams {
                find_similar: true,
                phash_config: cfg,
                ..ScanParams::new(path)
            },
            no_cancel(),
            no_progress,
        ).unwrap();

        let similar: Vec<_> = r.groups.iter().filter(|g| g.similar).collect();
        assert_eq!(
            similar.len(), 0,
            "avec tolerance stricte, portrait et paysage ne doivent pas etre groupes"
        );
    }

    #[test]
    fn phash_bucket_index_meme_resultat_que_fallback() {
        let dir = TempDir::new().unwrap();
        write_solid_png(dir.path(), "a.png", [100, 150, 200], 30);
        write_solid_png(dir.path(), "b.png", [100, 150, 200], 60);
        write_solid_png(dir.path(), "c.png", [50, 50, 50], 30);

        let path = dir.path().to_str().unwrap();

        // coarse_threshold_multiplier = 0 => coarse_threshold = 0 => bucket index eligible
        let mut cfg_bucket = crate::phash::PHashConfig::default();
        cfg_bucket.use_bucket_index = true;
        cfg_bucket.coarse_threshold_multiplier = 0.0;
        cfg_bucket.min_images_two_pass = 2;

        let mut cfg_fallback = crate::phash::PHashConfig::default();
        cfg_fallback.use_bucket_index = false;
        cfg_fallback.coarse_threshold_multiplier = 0.0;
        cfg_fallback.min_images_two_pass = 2;

        let r_bucket = scan_folder(
            ScanParams { find_similar: true, phash_config: cfg_bucket, ..ScanParams::new(path) },
            no_cancel(), no_progress,
        ).unwrap();
        let r_fallback = scan_folder(
            ScanParams { find_similar: true, phash_config: cfg_fallback, ..ScanParams::new(path) },
            no_cancel(), no_progress,
        ).unwrap();

        let similar_bucket: usize = r_bucket.groups.iter().filter(|g| g.similar).map(|g| g.files.len()).sum();
        let similar_fallback: usize = r_fallback.groups.iter().filter(|g| g.similar).map(|g| g.files.len()).sum();
        assert_eq!(similar_bucket, similar_fallback, "bucket index doit trouver les memes groupes que le fallback O(n^2)");
    }

    #[test]
    fn phash_sorted_aspect_meme_resultat_que_fallback() {
        let dir = TempDir::new().unwrap();
        // 3 images landscape similaires + 1 portrait tres different
        write_solid_png_dims(dir.path(), "land1.png", [100, 150, 200], 100, 60);
        write_solid_png_dims(dir.path(), "land2.png", [100, 150, 200], 80, 50);
        write_solid_png_dims(dir.path(), "land3.png", [100, 150, 200], 120, 70);
        write_solid_png_dims(dir.path(), "port.png", [50, 50, 50], 60, 100);

        let path = dir.path().to_str().unwrap();

        let mut cfg_sorted = crate::phash::PHashConfig::default();
        cfg_sorted.use_sorted_aspect = true;
        cfg_sorted.use_bucket_index = false; // isoler la variable testee
        cfg_sorted.min_images_aspect_filter = 2;

        let mut cfg_fallback = crate::phash::PHashConfig::default();
        cfg_fallback.use_sorted_aspect = false;
        cfg_fallback.use_bucket_index = false;
        cfg_fallback.min_images_aspect_filter = 2;

        let r_sorted = scan_folder(
            ScanParams { find_similar: true, phash_config: cfg_sorted, ..ScanParams::new(path) },
            no_cancel(), no_progress,
        ).unwrap();
        let r_fallback = scan_folder(
            ScanParams { find_similar: true, phash_config: cfg_fallback, ..ScanParams::new(path) },
            no_cancel(), no_progress,
        ).unwrap();

        let similar_sorted: usize = r_sorted.groups.iter().filter(|g| g.similar).map(|g| g.files.len()).sum();
        let similar_fallback: usize = r_fallback.groups.iter().filter(|g| g.similar).map(|g| g.files.len()).sum();
        assert_eq!(similar_sorted, similar_fallback, "sorted aspect doit trouver les memes groupes que le fallback O(n^2)");
    }

    // --- Tests filtres dans scan_folder ---

    #[test]
    fn filtre_extension_exclue_reduit_scan() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.txt", b"contenu duplique");
        write_file(dir.path(), "b.txt", b"contenu duplique");
        write_file(dir.path(), "c.tmp", b"contenu duplique");
        write_file(dir.path(), "d.tmp", b"contenu duplique");
        let path = dir.path().to_str().unwrap();
        let r = scan_folder(
            ScanParams {
                exclude_extensions: vec!["tmp".to_string()],
                ..ScanParams::new(path)
            },
            no_cancel(),
            no_progress,
        ).unwrap();
        assert_eq!(r.scanned_files, 2);
        assert_eq!(r.groups.len(), 1);
    }

    #[test]
    fn filtre_extension_incluse_restreint_scan() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.txt", b"contenu duplique");
        write_file(dir.path(), "b.txt", b"contenu duplique");
        write_file(dir.path(), "c.jpg", b"contenu duplique");
        write_file(dir.path(), "d.jpg", b"contenu duplique");
        let path = dir.path().to_str().unwrap();
        let r = scan_folder(
            ScanParams {
                include_extensions: vec!["jpg".to_string()],
                ..ScanParams::new(path)
            },
            no_cancel(),
            no_progress,
        ).unwrap();
        assert_eq!(r.scanned_files, 2);
        assert_eq!(r.groups.len(), 1);
        assert!(r.groups[0].files.iter().all(|f| f.name.ends_with(".jpg")));
    }

    #[test]
    fn filtre_taille_min_exclut_petits_fichiers() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.txt", b"x");
        write_file(dir.path(), "b.txt", b"x");
        let path = dir.path().to_str().unwrap();
        let r = scan_folder(
            ScanParams { min_file_size_kb: 1, ..ScanParams::new(path) },
            no_cancel(),
            no_progress,
        ).unwrap();
        assert_eq!(r.scanned_files, 0);
        assert_eq!(r.groups.len(), 0);
    }

    #[test]
    fn filtre_taille_max_exclut_grands_fichiers() {
        let dir = TempDir::new().unwrap();
        let content = vec![b'A'; 2048];
        write_file(dir.path(), "a.bin", &content);
        write_file(dir.path(), "b.bin", &content);
        let path = dir.path().to_str().unwrap();
        let r = scan_folder(
            ScanParams { max_file_size_kb: 1, ..ScanParams::new(path) },
            no_cancel(),
            no_progress,
        ).unwrap();
        assert_eq!(r.scanned_files, 0);
        assert_eq!(r.groups.len(), 0);
    }

    // --- Tests groupes ignores ---

    #[test]
    fn ignored_keys_exclut_un_groupe() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.txt", b"contenu duplique");
        write_file(dir.path(), "b.txt", b"contenu duplique");
        let path_a = dir.path().join("a.txt").to_string_lossy().to_string();
        let path_b = dir.path().join("b.txt").to_string_lossy().to_string();
        let mut sorted = [path_a.as_str(), path_b.as_str()];
        sorted.sort_unstable();
        let key = sorted.join("|");

        let mut ignored = std::collections::HashSet::new();
        ignored.insert(key);

        let path = dir.path().to_str().unwrap();
        let r = scan_folder(
            ScanParams { ignored_keys: ignored, ..ScanParams::new(path) },
            no_cancel(),
            no_progress,
        ).unwrap();
        assert_eq!(r.groups.len(), 0);
    }

    #[test]
    fn ignored_keys_garde_les_autres_groupes() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a1.txt", b"groupe un!!!!!");
        write_file(dir.path(), "a2.txt", b"groupe un!!!!!");
        write_file(dir.path(), "b1.txt", b"groupe deux!!!!");
        write_file(dir.path(), "b2.txt", b"groupe deux!!!!");
        let path_a1 = dir.path().join("a1.txt").to_string_lossy().to_string();
        let path_a2 = dir.path().join("a2.txt").to_string_lossy().to_string();
        let mut sorted = [path_a1.as_str(), path_a2.as_str()];
        sorted.sort_unstable();
        let key = sorted.join("|");

        let mut ignored = std::collections::HashSet::new();
        ignored.insert(key);

        let path = dir.path().to_str().unwrap();
        let r = scan_folder(
            ScanParams { ignored_keys: ignored, ..ScanParams::new(path) },
            no_cancel(),
            no_progress,
        ).unwrap();
        assert_eq!(r.groups.len(), 1);
        assert!(r.groups[0].files.iter().any(|f| f.name == "b1.txt" || f.name == "b2.txt"));
    }

    #[test]
    fn ignored_keys_vide_ne_filtre_rien() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.txt", b"contenu duplique");
        write_file(dir.path(), "b.txt", b"contenu duplique");
        let path = dir.path().to_str().unwrap();
        let r = scan_folder(ScanParams::new(path), no_cancel(), no_progress).unwrap();
        assert_eq!(r.groups.len(), 1);
    }

    // --- Tests cache exact ---

    #[test]
    fn cache_exact_cree_apres_scan() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.txt", b"contenu duplique");
        write_file(dir.path(), "b.txt", b"contenu duplique");
        let path = dir.path().to_str().unwrap();
        let r = scan_folder(
            ScanParams {
                exact_cache_enabled: true,
                data_dir: Some(dir.path().to_str().unwrap().to_string()),
                ..ScanParams::new(path)
            },
            no_cancel(),
            no_progress,
        ).unwrap();
        assert_eq!(r.groups.len(), 1);
        assert!(dir.path().join("exact_cache.json").exists(), "le cache doit etre cree apres le scan");
    }

    #[test]
    fn cache_exact_rescan_retrouve_memes_doublons() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.txt", b"contenu duplique");
        write_file(dir.path(), "b.txt", b"contenu duplique");
        write_file(dir.path(), "c.txt", b"unique");
        let path = dir.path().to_str().unwrap();
        let data_dir = dir.path().to_str().unwrap().to_string();

        let make_params = || ScanParams {
            exact_cache_enabled: true,
            data_dir: Some(data_dir.clone()),
            ..ScanParams::new(path)
        };

        let r1 = scan_folder(make_params(), no_cancel(), no_progress).unwrap();
        assert_eq!(r1.groups.len(), 1);

        let r2 = scan_folder(make_params(), no_cancel(), no_progress).unwrap();
        assert_eq!(r2.groups.len(), 1);
        assert_eq!(r2.groups[0].files.len(), r1.groups[0].files.len());
    }

    #[test]
    fn audio_phase_desactivee_par_defaut() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.mp3", b"audio content");
        let result = scan_folder(ScanParams::new(dir.path().to_str().unwrap()), no_cancel(), no_progress).unwrap();
        assert!(!result.fpcalc_missing, "fpcalc_missing doit etre false quand find_similar_audio=false");
    }

    #[test]
    fn audio_fpcalc_missing_quand_active_et_absent() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.mp3", b"audio1");
        write_file(dir.path(), "b.mp3", b"audio2");
        if crate::audio::fpcalc_available() {
            return;
        }
        let result = scan_folder(
            ScanParams { find_similar_audio: true, ..ScanParams::new(dir.path().to_str().unwrap()) },
            no_cancel(),
            no_progress,
        ).unwrap();
        assert!(result.fpcalc_missing, "fpcalc_missing doit etre true quand fpcalc est absent");
        assert!(!result.groups.iter().any(|g| g.audio_similar));
    }

    #[test]
    fn audio_phase_ignore_non_audio() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "doc.txt", b"texte");
        write_file(dir.path(), "image.jpg", b"image");
        let result = scan_folder(
            ScanParams { find_similar_audio: true, ..ScanParams::new(dir.path().to_str().unwrap()) },
            no_cancel(),
            no_progress,
        ).unwrap();
        assert!(!result.groups.iter().any(|g| g.audio_similar));
    }

    // --- Tests mode "comparer avec un autre dossier" ---

    #[test]
    fn compare_mode_groupe_croise_detecte() {
        let src = TempDir::new().unwrap();
        let ref_dir = TempDir::new().unwrap();
        write_file(src.path(), "file.txt", b"contenu identique!!");
        write_file(ref_dir.path(), "file_copy.txt", b"contenu identique!!");

        let r = scan_folder(
            ScanParams {
                secondary_folder: Some(ref_dir.path().to_str().unwrap().to_string()),
                recursive: true,
                ..ScanParams::new(src.path().to_str().unwrap())
            },
            no_cancel(),
            no_progress,
        ).unwrap();

        assert_eq!(r.groups.len(), 1, "le doublon croise doit etre detecte");
        let g = &r.groups[0];
        assert_eq!(g.files.len(), 2);
        let has_primary = g.files.iter().any(|f| f.source == Some(FileSource::Primary));
        let has_secondary = g.files.iter().any(|f| f.source == Some(FileSource::Secondary));
        assert!(has_primary, "le groupe doit contenir un fichier primaire");
        assert!(has_secondary, "le groupe doit contenir un fichier secondaire");
    }

    #[test]
    fn compare_mode_groupe_interne_s_ignore() {
        let src = TempDir::new().unwrap();
        let ref_dir = TempDir::new().unwrap();
        write_file(src.path(), "a.txt", b"doublon interne!!");
        write_file(src.path(), "b.txt", b"doublon interne!!");
        write_file(ref_dir.path(), "unique.txt", b"fichier unique !!");

        let r = scan_folder(
            ScanParams {
                secondary_folder: Some(ref_dir.path().to_str().unwrap().to_string()),
                recursive: true,
                ..ScanParams::new(src.path().to_str().unwrap())
            },
            no_cancel(),
            no_progress,
        ).unwrap();
        assert_eq!(r.groups.len(), 0, "les doublons internes a S ne doivent pas etre signales");
    }

    #[test]
    fn compare_mode_groupe_interne_r_ignore() {
        let src = TempDir::new().unwrap();
        let ref_dir = TempDir::new().unwrap();
        write_file(src.path(), "unique.txt", b"fichier unique!!!!!");
        write_file(ref_dir.path(), "a.txt", b"doublon interne ref!");
        write_file(ref_dir.path(), "b.txt", b"doublon interne ref!");

        let r = scan_folder(
            ScanParams {
                secondary_folder: Some(ref_dir.path().to_str().unwrap().to_string()),
                recursive: true,
                ..ScanParams::new(src.path().to_str().unwrap())
            },
            no_cancel(),
            no_progress,
        ).unwrap();
        assert_eq!(r.groups.len(), 0, "les doublons internes a R ne doivent pas etre signales");
    }

    #[test]
    fn compare_mode_fichier_present_dans_un_seul_dossier_ignore() {
        let src = TempDir::new().unwrap();
        let ref_dir = TempDir::new().unwrap();
        write_file(src.path(), "only_in_s.txt", b"seulement dans S!!");

        let r = scan_folder(
            ScanParams {
                secondary_folder: Some(ref_dir.path().to_str().unwrap().to_string()),
                recursive: true,
                ..ScanParams::new(src.path().to_str().unwrap())
            },
            no_cancel(),
            no_progress,
        ).unwrap();
        assert_eq!(r.groups.len(), 0, "un fichier present dans un seul dossier ne doit pas etre signale");
    }

    #[test]
    fn compare_mode_sans_secondary_folder_fonctionne_normalement() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.txt", b"contenu duplique!!");
        write_file(dir.path(), "b.txt", b"contenu duplique!!");

        let r = scan_folder(
            ScanParams::new(dir.path().to_str().unwrap()),
            no_cancel(),
            no_progress,
        ).unwrap();

        assert_eq!(r.groups.len(), 1, "sans secondary_folder les doublons internes doivent etre detectes");
        assert!(r.groups[0].files.iter().all(|f| f.source.is_none()));
    }
}
