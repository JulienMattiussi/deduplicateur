import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { AudioConfig, PHashConfig, VideoConfig } from "../types";

export const DEFAULT_PHASH_CONFIG: PHashConfig = {
  min_file_size_bytes: 10240,
  min_images_size_filter: 50,
  aspect_ratio_tolerance: 0.20,
  min_images_aspect_filter: 10,
  two_pass_enabled: true,
  coarse_hash_size: 4,
  fine_hash_size: 8,
  coarse_threshold_multiplier: 2.0,
  min_images_two_pass: 20,
  cache_enabled: true,
  parallel_compare_enabled: true,
  min_images_parallel_compare: 200,
  perf_log_enabled: false,
  use_exif_thumbnail: true,
  use_bucket_index: true,
  use_sorted_aspect: true,
};

export const DEFAULT_VIDEO_CONFIG: VideoConfig = {
  n_frames: 8,
  duration_tolerance: 0.20,
  cache_enabled: true,
  use_dtw: false,
};

export const DEFAULT_AUDIO_CONFIG: AudioConfig = {
  duration_tolerance: 0.20,
  cache_enabled: true,
};

export const DEFAULT_EXCLUDE_EXTENSIONS = ["tmp", "DS_Store", "Thumbs.db", "desktop.ini", "lnk"];

export function useScanConfig() {
  const [folder, setFolder] = useState("");
  const [recursive, setRecursive] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([
    "node_modules", ".git", "target", "dist", ".next",
    "__pycache__", ".cache", "vendor", "build", ".npm",
  ]);
  const [scanMode, setScanMode] = useState<"all" | "by_folder" | "compare_folder">("all");
  const [secondaryFolder, setSecondaryFolder] = useState("");
  const [pickingSecondary, setPickingSecondary] = useState(false);
  const [detectionMode, setDetectionMode] = useState<"files" | "images" | "videos" | "audio">("files");
  const [simSimilarity, setSimSimilarity] = useState(100);
  const [videoSimilarity, setVideoSimilarity] = useState(100);
  const [phashConfig, setPhashConfig] = useState<PHashConfig>(DEFAULT_PHASH_CONFIG);
  const [videoConfig, setVideoConfig] = useState<VideoConfig>(DEFAULT_VIDEO_CONFIG);
  const [audioConfig, setAudioConfig] = useState<AudioConfig>(DEFAULT_AUDIO_CONFIG);
  const [audioSimilarity, setAudioSimilarity] = useState(100);
  const [picking, setPicking] = useState(false);
  const [excludeExtensions, setExcludeExtensions] = useState<string[]>(DEFAULT_EXCLUDE_EXTENSIONS);
  const [includeExtensions, setIncludeExtensions] = useState<string[]>([]);
  const [minFileSizeKb, setMinFileSizeKb] = useState(0);
  const [maxFileSizeKb, setMaxFileSizeKb] = useState(0);
  const [exactCacheEnabled, setExactCacheEnabled] = useState(true);
  const [minModifiedDate, setMinModifiedDate] = useState("");
  const [maxModifiedDate, setMaxModifiedDate] = useState("");
  const [scanArchives, setScanArchives] = useState(false);

  useEffect(() => {
    invoke<PHashConfig>("get_phash_config").then(setPhashConfig).catch(() => {});
    invoke<VideoConfig>("get_video_config").then(setVideoConfig).catch(() => {});
    invoke<AudioConfig>("get_audio_config").then(setAudioConfig).catch(() => {});
  }, []);

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

  async function pickSecondaryFolder() {
    if (pickingSecondary) return;
    setPickingSecondary(true);
    try {
      const dir = await open({ directory: true, multiple: false });
      if (typeof dir === "string") setSecondaryFolder(dir);
    } finally {
      setPickingSecondary(false);
    }
  }

  async function updatePhashConfig(cfg: PHashConfig) {
    setPhashConfig(cfg);
    try { await invoke("set_phash_config", { config: cfg }); } catch { /* best-effort */ }
  }

  async function updateVideoConfig(cfg: VideoConfig) {
    setVideoConfig(cfg);
    try { await invoke("set_video_config", { config: cfg }); } catch { /* best-effort */ }
  }

  async function updateAudioConfig(cfg: AudioConfig) {
    setAudioConfig(cfg);
    try { await invoke("set_audio_config", { config: cfg }); } catch { /* best-effort */ }
  }

  return {
    folder, setFolder,
    recursive, setRecursive,
    excluded, setExcluded,
    scanMode, setScanMode,
    detectionMode, setDetectionMode,
    simSimilarity, setSimSimilarity,
    videoSimilarity, setVideoSimilarity,
    phashConfig, videoConfig, audioConfig,
    updatePhashConfig, updateVideoConfig, updateAudioConfig,
    audioSimilarity, setAudioSimilarity,
    picking, pickFolder,
    secondaryFolder, setSecondaryFolder,
    pickingSecondary, pickSecondaryFolder,
    excludeExtensions, setExcludeExtensions,
    includeExtensions, setIncludeExtensions,
    minFileSizeKb, setMinFileSizeKb,
    maxFileSizeKb, setMaxFileSizeKb,
    exactCacheEnabled, setExactCacheEnabled,
    minModifiedDate, setMinModifiedDate,
    maxModifiedDate, setMaxModifiedDate,
    scanArchives, setScanArchives,
  };
}
