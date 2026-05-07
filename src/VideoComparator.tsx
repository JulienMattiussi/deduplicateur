import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DuplicateFile, VideoMetadata } from "./types";
import { formatDurationSecs } from "./utils";
import { useLang } from "./LangContext";
import type { ComparatorProps } from "./comparatorShared";
import { useComparatorNav, ComparatorShell, MetaBlockBase, KeepButton, toMediaUrl } from "./comparatorShared";

function VideoMetaBlock({ file, meta }: { file: DuplicateFile; meta: VideoMetadata | null }) {
  const { t } = useLang();
  return (
    <MetaBlockBase file={file}>
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
    </MetaBlockBase>
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
        <KeepButton kept={kept} onKeep={onKeep} />
        <VideoMetaBlock file={file} meta={meta} />
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
}: ComparatorProps) {
  const { t } = useLang();
  const nav = useComparatorNav({ groups, startIdx, selected, onSelectPaths, onClose });
  const [mediaPort, setMediaPort] = useState<number | null>(null);
  const [leftMeta, setLeftMeta] = useState<VideoMetadata | null>(null);
  const [rightMeta, setRightMeta] = useState<VideoMetadata | null>(null);
  const leftVideoRef = useRef<HTMLVideoElement>(null);
  const rightVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    invoke<number>("get_media_server_port").then(setMediaPort).catch(() => {});
  }, []);

  useEffect(() => {
    if (!nav.hasValidGroup) return;
    setLeftMeta(null);
    const lf = nav.group.files[nav.effectiveLeftIdx];
    if (lf.video_metadata) {
      setLeftMeta(lf.video_metadata);
    } else {
      invoke<VideoMetadata>("get_video_metadata", { path: lf.path })
        .then(setLeftMeta).catch(() => {});
    }
  }, [nav.groupIdx, nav.effectiveLeftIdx]);

  useEffect(() => {
    if (!nav.hasValidGroup) return;
    setRightMeta(null);
    const rf = nav.group.files[nav.effectiveRightIdx];
    if (rf.video_metadata) {
      setRightMeta(rf.video_metadata);
    } else {
      invoke<VideoMetadata>("get_video_metadata", { path: rf.path })
        .then(setRightMeta).catch(() => {});
    }
  }, [nav.groupIdx, nav.effectiveRightIdx]);

  if (!nav.hasValidGroup) return null;

  const { leftFile, rightFile, keepFile, isKept } = nav;

  const leftSrc = mediaPort ? toMediaUrl(leftFile.path, mediaPort) : undefined;
  const rightSrc = mediaPort ? toMediaUrl(rightFile.path, mediaPort) : undefined;

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
    <ComparatorShell
      nav={nav}
      groups={groups}
      title={t.videoComparator}
      onClose={onClose}
    >
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
    </ComparatorShell>
  );
}
