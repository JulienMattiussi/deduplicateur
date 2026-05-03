export interface VideoMetadata {
  duration_secs: number;
  width: number;
  height: number;
  codec: string;
}

export interface AudioMetadata {
  duration_secs: number;
}

export interface AudioConfig {
  duration_tolerance: number;
  cache_enabled: boolean;
}

export interface DuplicateFile {
  path: string;
  size: number;
  name: string;
  modified: number;
  video_metadata?: VideoMetadata;
  audio_metadata?: AudioMetadata;
  /** Provenance du fichier en mode "comparer avec un autre dossier". */
  source?: "primary" | "secondary";
}

export interface DuplicateGroup {
  id: string;
  hash: string;
  size: number;
  files: DuplicateFile[];
  folder_key?: string;
  similar?: boolean;
  video_similar?: boolean;
  audio_similar?: boolean;
}

export interface ScanSummary {
  id: string;
  folder: string;
  total_wasted_bytes: number;
  total_groups: number;
  scanned_files: number;
  duration_ms: number;
  by_folder: boolean;
  total_folders: number;
  partial?: boolean;
  recursive?: boolean;
  find_similar?: boolean;
  find_similar_videos?: boolean;
  ffmpeg_missing?: boolean;
  find_similar_audio?: boolean;
  fpcalc_missing?: boolean;
}

export interface PHashConfig {
  min_file_size_bytes: number;
  min_images_size_filter: number;
  aspect_ratio_tolerance: number;
  min_images_aspect_filter: number;
  two_pass_enabled: boolean;
  coarse_hash_size: number;
  fine_hash_size: number;
  coarse_threshold_multiplier: number;
  min_images_two_pass: number;
  cache_enabled: boolean;
  parallel_compare_enabled: boolean;
  min_images_parallel_compare: number;
  perf_log_enabled: boolean;
}

export interface ImageMeta {
  width: number;
  height: number;
  format: string;
  exif_date?: string;
}

export interface VideoConfig {
  n_frames: number;
  duration_tolerance: number;
  cache_enabled: boolean;
  use_dtw: boolean;
}

export interface FolderSummary {
  folder_key: string;
  group_count: number;
  total_wasted_bytes: number;
}

export interface GroupsPage {
  groups: DuplicateGroup[];
  offset: number;
  total: number;
  has_more: boolean;
}

export interface IgnoreEntry {
  key: string;
  display_names: string[];
  ignored_at: number;
}

export interface ScanProfile {
  id: string;
  name: string;
  created_at: number;
  folder: string;
  recursive: boolean;
  scan_mode: string;
  detection_mode: string;
  sim_similarity: number;
  video_similarity: number;
  audio_similarity: number;
  excluded: string[];
  exclude_extensions: string[];
  include_extensions: string[];
  min_file_size_kb: number;
  max_file_size_kb: number;
  exact_cache_enabled: boolean;
}
