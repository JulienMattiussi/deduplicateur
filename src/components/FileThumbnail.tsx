import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DuplicateFile } from "../types";
import { openFile } from "../fileActions";

export function FileThumbnail({ file, mode }: { file: DuplicateFile; mode: "image" | "video" }) {
  const [thumb, setThumb] = useState<string | null>(null);

  useEffect(() => {
    const cmd = mode === "video" ? "get_video_thumbnail" : "get_image_thumbnail";
    const args = mode === "video"
      ? { path: file.path, maxSize: 64, duration: file.video_metadata?.duration_secs ?? null }
      : { path: file.path, maxSize: 64 };
    invoke<string>(cmd, args)
      .then(setThumb)
      .catch(() => setThumb("error"));
  }, [file.path, mode]);

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
