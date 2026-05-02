import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DuplicateFile } from "../types";
import { openFile } from "../fileActions";

export function FileThumbnail({ file, mode }: { file: DuplicateFile; mode: "image" | "video" | "audio" }) {
  const [thumb, setThumb] = useState<string | null>(null);

  useEffect(() => {
    if (mode === "audio") return;
    const cmd = mode === "video" ? "get_video_thumbnail" : "get_image_thumbnail";
    const args = mode === "video"
      ? { path: file.path, maxSize: 64, duration: file.video_metadata?.duration_secs ?? null }
      : { path: file.path, maxSize: 64 };
    invoke<string>(cmd, args)
      .then(setThumb)
      .catch(() => setThumb("error"));
  }, [file.path, mode]);

  if (mode === "audio") {
    return (
      <span
        className="file-thumb-audio"
        onClick={(e) => { e.stopPropagation(); openFile(file.path); }}
        title={file.name}
      >
        <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="18" cy="18" r="17" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
          <polygon points="14,11 28,18 14,25" fill="currentColor" opacity="0.7" />
        </svg>
      </span>
    );
  }

  if (thumb && thumb !== "error") {
    return (
      <img
        src={thumb}
        alt=""
        className="file-thumb-img"
        onClick={(e) => { e.stopPropagation(); openFile(file.path); }}
      />
    );
  }
  if (thumb === "error") {
    return <span className="file-thumb-error">{mode === "video" ? "🎬" : "🖼"}</span>;
  }
  return <span className="file-thumb-spinner" />;
}
