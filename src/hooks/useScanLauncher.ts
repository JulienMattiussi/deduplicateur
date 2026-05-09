import { invoke } from "@tauri-apps/api/core";
import { toHammingThreshold } from "../utils";
import type { ScanProfile } from "../types";
import type { ScanInvokeArgs } from "./useScanExecution";

interface ScanConfigShape {
  folder: string;
  recursive: boolean;
  excluded: string[];
  scanMode: "all" | "by_folder" | "compare_folder";
  detectionMode: "files" | "images" | "videos" | "audio";
  simSimilarity: number;
  videoSimilarity: number;
  audioSimilarity: number;
  excludeExtensions: string[];
  includeExtensions: string[];
  minFileSizeKb: number;
  maxFileSizeKb: number;
  exactCacheEnabled: boolean;
  audioConfig: { cache_enabled: boolean; duration_tolerance: number };
  secondaryFolder: string;
  minModifiedDate: string;
  maxModifiedDate: string;
  scanArchives: boolean;
}

/**
 * Construit les args d'invocation de scan_folder a partir de l'etat de configuration courant.
 * Inclut les options post-profile (notification, dossier secondaire, archives, dates).
 */
export function buildScanArgsFromConfig(config: ScanConfigShape, lang: string): ScanInvokeArgs {
  const effectiveRecursive = (config.scanMode === "by_folder" || config.scanMode === "compare_folder") ? true : config.recursive;
  const minModifiedTimestamp = config.minModifiedDate
    ? Math.floor(new Date(config.minModifiedDate).getTime() / 1000)
    : 0;
  const maxModifiedTimestamp = config.maxModifiedDate
    ? Math.floor(new Date(config.maxModifiedDate + "T23:59:59").getTime() / 1000)
    : 0;
  return {
    path: config.folder,
    recursive: effectiveRecursive,
    excluded: config.excluded,
    byFolder: config.scanMode === "by_folder",
    findSimilar: config.detectionMode === "images",
    simThreshold: toHammingThreshold(config.simSimilarity),
    findSimilarVideos: config.detectionMode === "videos",
    videoSimThreshold: toHammingThreshold(config.videoSimilarity),
    findSimilarAudio: config.detectionMode === "audio",
    audioSimThreshold: 100 - config.audioSimilarity,
    audioCacheEnabled: config.audioConfig.cache_enabled,
    audioDurationTolerance: config.audioConfig.duration_tolerance,
    exactCacheEnabled: config.exactCacheEnabled,
    excludeExtensions: config.excludeExtensions,
    includeExtensions: config.includeExtensions,
    minFileSizeKb: config.minFileSizeKb,
    maxFileSizeKb: config.maxFileSizeKb,
    notificationThresholdSecs: 10,
    notificationLang: lang,
    secondaryFolder: config.scanMode === "compare_folder" ? (config.secondaryFolder || null) : null,
    minModifiedTimestamp: minModifiedTimestamp || undefined,
    maxModifiedTimestamp: maxModifiedTimestamp || undefined,
    scanArchives: config.scanArchives,
  };
}

/**
 * Construit les args d'invocation de scan_folder a partir d'un profil sauvegarde.
 * Les profils ne stockent pas les options post-v1 (notification, dossier secondaire, archives, dates),
 * d'ou des champs `audioCacheEnabled` / `audioDurationTolerance` repris de la config audio courante.
 */
export function buildScanArgsFromProfile(
  profile: ScanProfile,
  audioConfig: { cache_enabled: boolean; duration_tolerance: number },
): ScanInvokeArgs {
  const effectiveRecursive = profile.scan_mode === "by_folder" ? true : profile.recursive;
  return {
    path: profile.folder,
    recursive: effectiveRecursive,
    excluded: profile.excluded,
    byFolder: profile.scan_mode === "by_folder",
    findSimilar: profile.detection_mode === "images",
    simThreshold: toHammingThreshold(profile.sim_similarity),
    findSimilarVideos: profile.detection_mode === "videos",
    videoSimThreshold: toHammingThreshold(profile.video_similarity),
    findSimilarAudio: profile.detection_mode === "audio",
    audioSimThreshold: 100 - (profile.audio_similarity ?? 80),
    audioCacheEnabled: audioConfig.cache_enabled,
    audioDurationTolerance: audioConfig.duration_tolerance,
    exactCacheEnabled: profile.exact_cache_enabled,
    excludeExtensions: profile.exclude_extensions,
    includeExtensions: profile.include_extensions,
    minFileSizeKb: profile.min_file_size_kb,
    maxFileSizeKb: profile.max_file_size_kb,
    scanArchives: false,
  };
}

/**
 * Verifie la disponibilite des outils externes (ffmpeg/fpcalc) avant un scan.
 * Retourne le nom de l'outil manquant ou null si tout est OK.
 */
export async function checkRequiredTools(detectionMode: "files" | "images" | "videos" | "audio"): Promise<"ffmpeg" | "fpcalc" | null> {
  if (detectionMode !== "videos" && detectionMode !== "audio") return null;
  const tools = await invoke<{ ffmpeg_available: boolean; fpcalc_available: boolean }>("check_tools");
  if (detectionMode === "videos" && !tools.ffmpeg_available) return "ffmpeg";
  if (detectionMode === "audio" && !tools.fpcalc_available) return "fpcalc";
  return null;
}
