export interface VideoMetadata {
  duration_secs: number;
  width: number;
  height: number;
  codec: string;
}

export interface DuplicateFile {
  path: string;
  size: number;
  name: string;
  modified: number;
  video_metadata?: VideoMetadata;
}

export interface DuplicateGroup {
  id: string;
  hash: string;
  size: number;
  files: DuplicateFile[];
  folder_key?: string;
  similar?: boolean;
  video_similar?: boolean;
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
