export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} Go`;
}

export function dirname(path: string): string {
  const sep = path.includes("/") ? "/" : "\\";
  if (!path.includes(sep)) return "";
  const parts = path.split(sep);
  parts.pop();
  return parts.join(sep) || sep;
}

export function fileExt(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

export const VIDEO_EXTS = new Set(["mp4","avi","mkv","mov","wmv","webm","flv","m4v","mpg","mpeg","3gp","ts","mts","m2ts"]);
export const IMAGE_EXTS = new Set(["jpg","jpeg","png","webp","bmp","gif","tiff","tif","avif"]);
export const AUDIO_EXTS = new Set(["mp3","flac","ogg","m4a","aac","wav","wma","opus","aiff","aif","ape"]);

export function formatDate(ts: number, dateLocale: string): string {
  if (!ts) return "-";
  return new Date(ts * 1000).toLocaleDateString(dateLocale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDurationSecs(secs: number): string {
  const total = Math.round(secs);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
