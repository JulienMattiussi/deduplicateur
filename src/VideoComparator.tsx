import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DuplicateGroup, DuplicateFile, VideoMetadata } from "./types";
import { formatSize, formatDurationSecs, dirname } from "./utils";
import { useLang } from "./LangContext";

function toMediaUrl(path: string, port: number): string {
  const normalized = path.replace(/\\/g, "/");
  const withSlash = normalized.startsWith("/") ? normalized : "/" + normalized;
  return `http://127.0.0.1:${port}${withSlash.split("/").map(encodeURIComponent).join("/")}`;
}

function MetaBlock({ file, meta }: { file: DuplicateFile; meta: VideoMetadata | null }) {
  const { t } = useLang();
  return (
    <div className="comparator-meta">
      <div className="comparator-meta-row">
        <span className="comparator-meta-label">{t.colName}</span>
        <span className="comparator-meta-value comparator-meta-filename">{file.name}</span>
      </div>
      <div className="comparator-meta-row">
        <span className="comparator-meta-label">{t.colFolder}</span>
        <span className="comparator-meta-value comparator-meta-path" title={file.path}>{dirname(file.path)}</span>
      </div>
      <div className="comparator-meta-row">
        <span className="comparator-meta-label">{t.colSize}</span>
        <span className="comparator-meta-value">{formatSize(file.size)}</span>
      </div>
      {meta ? (
        <>
          <div className="comparator-meta-row">
            <span className="comparator-meta-label">{t.imageMetaDimensions}</span>
            <span className="comparator-meta-value">{meta.width}x{meta.height}</span>
          </div>
          <div className="comparator-meta-row">
            <span className="comparator-meta-label">{t.colDuration}</span>
            <span className="comparator-meta-value">{formatDurationSecs(meta.duration_secs)}</span>
          </div>
          <div className="comparator-meta-row">
            <span className="comparator-meta-label">{t.videoMetaCodec}</span>
            <span className="comparator-meta-value">{meta.codec}</span>
          </div>
        </>
      ) : (
        <div className="comparator-meta-row">
          <span className="comparator-meta-label" style={{ opacity: 0.5 }}>...</span>
        </div>
      )}
    </div>
  );
}

function VideoPanel({
  file,
  meta,
  videoRef,
  kept,
  side,
  src,
  master,
  onPlay,
  onPause,
  onSeeked,
  onKeep,
}: {
  file: DuplicateFile;
  meta: VideoMetadata | null;
  videoRef: React.RefObject<HTMLVideoElement>;
  kept: boolean;
  side: "left" | "right";
  src: string | undefined;
  master: boolean;
  onPlay?: () => void;
  onPause?: () => void;
  onSeeked?: () => void;
  onKeep: () => void;
}) {
  const { t } = useLang();
  return (
    <div className="comparator-panel">
      <div className="comparator-image-area comparator-video-area">
        {!src && <span className="comparator-video-loading">…</span>}
        <video
          ref={videoRef}
          src={src}
          className="comparator-video"
          controls={master}
          muted={!master}
          onPlay={master ? onPlay : undefined}
          onPause={master ? onPause : undefined}
          onSeeked={master ? onSeeked : undefined}
          data-testid={`video-${side}`}
        />
      </div>
      <div className="comparator-footer">
        <button
          className={`comparator-keep-btn${kept ? " comparator-keep-btn--kept" : ""}`}
          onClick={onKeep}
        >
          {kept ? "✓ " : ""}{t.keepThis}
        </button>
        <MetaBlock file={file} meta={meta} />
      </div>
    </div>
  );
}

export function VideoComparator({
  groups,
  startIdx,
  selected,
  onSelectPaths,
  onClose,
}: {
  groups: DuplicateGroup[];
  startIdx: number;
  selected: Set<string>;
  onSelectPaths: (toAdd: string[], toRemove: string[]) => void;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [mediaPort, setMediaPort] = useState<number | null>(null);
  const [groupIdx, setGroupIdx] = useState(Math.max(0, Math.min(startIdx, groups.length - 1)));
  const [leftFileIdx, setLeftFileIdx] = useState(0);
  const [rightFileIdx, setRightFileIdx] = useState(1);
  const [leftMeta, setLeftMeta] = useState<VideoMetadata | null>(null);
  const [rightMeta, setRightMeta] = useState<VideoMetadata | null>(null);
  const leftVideoRef = useRef<HTMLVideoElement>(null);
  const rightVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    invoke<number>("get_media_server_port").then(setMediaPort).catch(() => {});
  }, []);

  const group = groups[groupIdx];
  if (!group || group.files.length < 2) return null;

  const effectiveLeftIdx = Math.min(leftFileIdx, group.files.length - 1);
  const effectiveRightIdx = Math.min(rightFileIdx, group.files.length - 1);
  const leftFile = group.files[effectiveLeftIdx];
  const rightFile = group.files[effectiveRightIdx];

  const leftSrc = mediaPort ? toMediaUrl(leftFile.path, mediaPort) : undefined;
  const rightSrc = mediaPort ? toMediaUrl(rightFile.path, mediaPort) : undefined;

  useEffect(() => {
    setLeftMeta(null);
    const lf = group.files[effectiveLeftIdx];
    if (lf.video_metadata) {
      setLeftMeta(lf.video_metadata);
    } else {
      invoke<VideoMetadata>("get_video_metadata", { path: lf.path })
        .then(setLeftMeta).catch(() => {});
    }
  }, [groupIdx, leftFileIdx]);

  useEffect(() => {
    setRightMeta(null);
    const rf = group.files[effectiveRightIdx];
    if (rf.video_metadata) {
      setRightMeta(rf.video_metadata);
    } else {
      invoke<VideoMetadata>("get_video_metadata", { path: rf.path })
        .then(setRightMeta).catch(() => {});
    }
  }, [groupIdx, rightFileIdx]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const inInput = (e.target as HTMLElement).tagName === "INPUT";
      if (inInput) return;
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowLeft") goGroup(-1);
      if (e.key === "ArrowRight") goGroup(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [groupIdx, groups.length, onClose]);

  function goGroup(delta: number) {
    const next = groupIdx + delta;
    if (next >= 0 && next < groups.length) {
      setGroupIdx(next);
      setLeftFileIdx(0);
      setRightFileIdx(1);
    }
  }

  function pickLeft(i: number) {
    if (i === rightFileIdx) setRightFileIdx(leftFileIdx);
    setLeftFileIdx(i);
  }

  function pickRight(i: number) {
    if (i === leftFileIdx) setLeftFileIdx(rightFileIdx);
    setRightFileIdx(i);
  }

  function keepFile(keepPath: string) {
    const toAdd = group.files.filter((f) => f.path !== keepPath).map((f) => f.path);
    onSelectPaths(toAdd, [keepPath]);
    onClose();
  }

  function isKept(file: DuplicateFile): boolean {
    return (
      !selected.has(file.path) &&
      group.files.filter((f) => f.path !== file.path).every((f) => selected.has(f.path))
    );
  }

  function syncPlay() {
    const rv = rightVideoRef.current;
    const lv = leftVideoRef.current;
    if (rv && lv) { rv.currentTime = lv.currentTime; rv.play().catch(() => {}); }
  }

  function syncPause() {
    rightVideoRef.current?.pause();
  }

  function syncSeek() {
    const lv = leftVideoRef.current;
    const rv = rightVideoRef.current;
    if (lv && rv) rv.currentTime = lv.currentTime;
  }

  return (
    <div className="comparator-overlay">
      <div className="comparator-header">
        <div className="comparator-nav">
          <button className="btn-ghost btn-sm" onClick={() => goGroup(-1)} disabled={groupIdx === 0}>◀</button>
          <span className="comparator-counter">{groupIdx + 1} / {groups.length}</span>
          <button className="btn-ghost btn-sm" onClick={() => goGroup(1)} disabled={groupIdx === groups.length - 1}>▶</button>
        </div>
        <span className="comparator-title">{t.videoComparator}</span>
        <div className="comparator-header-right">
          <button className="btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
      </div>

      <div className="comparator-tabs">
        <div className="comparator-tabs-group" data-testid="tabs-left">
          <span className="comparator-tabs-side">{t.panelLeft}</span>
          {group.files.map((f, i) => (
            <button
              key={`l${i}`}
              className={`comparator-tab${effectiveLeftIdx === i ? " comparator-tab--active" : ""}`}
              onClick={() => pickLeft(i)}
              title={f.name}
            >{f.name}</button>
          ))}
        </div>
        <div className="comparator-tabs-group" data-testid="tabs-right">
          <span className="comparator-tabs-side">{t.panelRight}</span>
          {group.files.map((f, i) => (
            <button
              key={`r${i}`}
              className={`comparator-tab${effectiveRightIdx === i ? " comparator-tab--active" : ""}`}
              onClick={() => pickRight(i)}
              title={f.name}
            >{f.name}</button>
          ))}
        </div>
      </div>

      <div className="comparator-body" data-testid="comparator-body">
        <VideoPanel
          file={leftFile} meta={leftMeta} videoRef={leftVideoRef}
          kept={isKept(leftFile)} side="left" src={leftSrc} master
          onPlay={syncPlay} onPause={syncPause} onSeeked={syncSeek}
          onKeep={() => keepFile(leftFile.path)}
        />
        <div className="comparator-divider" />
        <VideoPanel
          file={rightFile} meta={rightMeta} videoRef={rightVideoRef}
          kept={isKept(rightFile)} side="right" src={rightSrc} master={false}
          onKeep={() => keepFile(rightFile.path)}
        />
      </div>
    </div>
  );
}
