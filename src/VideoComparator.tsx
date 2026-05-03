import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { DuplicateGroup, DuplicateFile, VideoMetadata } from "./types";
import { formatSize, formatDurationSecs } from "./utils";
import { useLang } from "./LangContext";

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
  const [groupIdx, setGroupIdx] = useState(Math.max(0, Math.min(startIdx, groups.length - 1)));
  const [leftFileIdx, setLeftFileIdx] = useState(0);
  const [rightFileIdx, setRightFileIdx] = useState(1);
  const [leftMeta, setLeftMeta] = useState<VideoMetadata | null>(null);
  const [rightMeta, setRightMeta] = useState<VideoMetadata | null>(null);
  const [scrubPos, setScrubPos] = useState(0);
  const [duration, setDuration] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const leftVideoRef = useRef<HTMLVideoElement>(null);
  const rightVideoRef = useRef<HTMLVideoElement>(null);

  const group = groups[groupIdx];
  if (!group || group.files.length < 2) return null;

  const effectiveLeftIdx = Math.min(leftFileIdx, group.files.length - 1);
  const effectiveRightIdx = Math.min(rightFileIdx, group.files.length - 1);
  const leftFile = group.files[effectiveLeftIdx];
  const rightFile = group.files[effectiveRightIdx];

  useEffect(() => {
    setLeftMeta(null);
    const lf = group.files[Math.min(leftFileIdx, group.files.length - 1)];
    if (lf.video_metadata) {
      setLeftMeta(lf.video_metadata);
    } else {
      invoke<VideoMetadata>("get_video_metadata", { path: lf.path })
        .then(setLeftMeta)
        .catch(() => {});
    }
  }, [groupIdx, leftFileIdx]);

  useEffect(() => {
    setRightMeta(null);
    const rf = group.files[Math.min(rightFileIdx, group.files.length - 1)];
    if (rf.video_metadata) {
      setRightMeta(rf.video_metadata);
    } else {
      invoke<VideoMetadata>("get_video_metadata", { path: rf.path })
        .then(setRightMeta)
        .catch(() => {});
    }
  }, [groupIdx, rightFileIdx]);

  useEffect(() => {
    setScrubPos(0);
    setDuration(0);
  }, [groupIdx, leftFileIdx, rightFileIdx]);

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
  }, [groupIdx, groups.length]);

  function goGroup(delta: number) {
    const next = groupIdx + delta;
    if (next >= 0 && next < groups.length) {
      setGroupIdx(next);
      setLeftFileIdx(0);
      setRightFileIdx(1);
      setScrubPos(0);
      setDuration(0);
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
  }

  function isKept(file: DuplicateFile): boolean {
    return (
      !selected.has(file.path) &&
      group.files.filter((f) => f.path !== file.path).every((f) => selected.has(f.path))
    );
  }

  function syncPlay(source: "left" | "right") {
    if (syncing) return;
    setSyncing(true);
    const other = source === "left" ? rightVideoRef.current : leftVideoRef.current;
    const self = source === "left" ? leftVideoRef.current : rightVideoRef.current;
    if (other && self) {
      if (!self.paused) {
        other.currentTime = self.currentTime;
        other.play().catch(() => {});
      } else {
        other.pause();
      }
    }
    setSyncing(false);
  }

  function syncPause(source: "left" | "right") {
    if (syncing) return;
    setSyncing(true);
    const other = source === "left" ? rightVideoRef.current : leftVideoRef.current;
    if (other) {
      other.pause();
    }
    setSyncing(false);
  }

  function syncSeek(source: "left" | "right") {
    if (syncing) return;
    setSyncing(true);
    const self = source === "left" ? leftVideoRef.current : rightVideoRef.current;
    const other = source === "left" ? rightVideoRef.current : leftVideoRef.current;
    if (self && other) {
      other.currentTime = self.currentTime;
      setScrubPos(self.currentTime);
    }
    setSyncing(false);
  }

  function onTimeUpdate(source: "left" | "right") {
    if (syncing) return;
    const self = source === "left" ? leftVideoRef.current : rightVideoRef.current;
    if (self) {
      setScrubPos(self.currentTime);
    }
  }

  function onLoadedMetadata(source: "left" | "right") {
    const self = source === "left" ? leftVideoRef.current : rightVideoRef.current;
    if (self && self.duration && !isNaN(self.duration)) {
      setDuration((prev) => Math.max(prev, self.duration));
    }
  }

  function onScrubChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = Number(e.target.value);
    setScrubPos(val);
    if (leftVideoRef.current) leftVideoRef.current.currentTime = val;
    if (rightVideoRef.current) rightVideoRef.current.currentTime = val;
  }

  function MetaBlock({ file, meta }: { file: DuplicateFile; meta: VideoMetadata | null }) {
    return (
      <div className="comparator-meta">
        <div className="comparator-meta-row">
          <span className="comparator-meta-label">{t.colName}</span>
          <span className="comparator-meta-value comparator-meta-filename">{file.name}</span>
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
    side,
  }: {
    file: DuplicateFile;
    meta: VideoMetadata | null;
    videoRef: React.RefObject<HTMLVideoElement>;
    side: "left" | "right";
  }) {
    const kept = isKept(file);
    return (
      <div className="comparator-panel">
        <div className="comparator-image-area comparator-video-area">
          <video
            ref={videoRef}
            src={convertFileSrc(file.path)}
            className="comparator-video"
            controls={false}
            onPlay={() => syncPlay(side)}
            onPause={() => syncPause(side)}
            onSeeked={() => syncSeek(side)}
            onTimeUpdate={() => onTimeUpdate(side)}
            onLoadedMetadata={() => onLoadedMetadata(side)}
            data-testid={`video-${side}`}
          />
        </div>
        <div className="comparator-footer">
          <button
            className={`comparator-keep-btn${kept ? " comparator-keep-btn--kept" : ""}`}
            onClick={() => keepFile(file.path)}
          >
            {kept ? "✓ " : ""}{t.keepThis}
          </button>
          <MetaBlock file={file} meta={meta} />
        </div>
      </div>
    );
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
            >
              {f.name}
            </button>
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
            >
              {f.name}
            </button>
          ))}
        </div>
      </div>

      <div className="comparator-body" data-testid="comparator-body">
        <VideoPanel file={leftFile} meta={leftMeta} videoRef={leftVideoRef} side="left" />
        <div className="comparator-divider" />
        <VideoPanel file={rightFile} meta={rightMeta} videoRef={rightVideoRef} side="right" />
      </div>

      <div className="comparator-scrubbar" data-testid="scrubbar">
        <button
          className="btn-ghost btn-sm comparator-scrub-playpause"
          onClick={() => {
            const lv = leftVideoRef.current;
            const rv = rightVideoRef.current;
            if (!lv || !rv) return;
            if (lv.paused) {
              lv.play().catch(() => {});
              rv.play().catch(() => {});
            } else {
              lv.pause();
              rv.pause();
            }
          }}
          data-testid="btn-playpause"
        >
          ▶/⏸
        </button>
        <input
          type="range"
          className="comparator-scrub-slider"
          min={0}
          max={duration || 100}
          step={0.1}
          value={scrubPos}
          onChange={onScrubChange}
          data-testid="scrub-slider"
        />
        <span className="comparator-scrub-time">
          {formatDurationSecs(scrubPos)} / {duration ? formatDurationSecs(duration) : "--:--"}
        </span>
      </div>
    </div>
  );
}
