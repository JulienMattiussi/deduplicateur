import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DuplicateFile } from "./types";
import { formatDurationSecs } from "./utils";
import { useLang } from "./LangContext";
import type { ComparatorProps } from "./comparatorShared";
import { useComparatorNav, ComparatorShell, MetaBlockBase, KeepButton, toMediaUrl } from "./comparatorShared";

function AudioMetaBlock({ file }: { file: DuplicateFile }) {
  const { t } = useLang();
  const duration = file.audio_metadata?.duration_secs;
  return (
    <MetaBlockBase file={file}>
      {duration != null && (
        <div className="comparator-meta-row">
          <span className="comparator-meta-label">{t.colDuration}</span>
          <span className="comparator-meta-value">{formatDurationSecs(duration)}</span>
        </div>
      )}
    </MetaBlockBase>
  );
}

function AudioPanel({
  file,
  audioRef,
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
  audioRef: React.RefObject<HTMLAudioElement>;
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
      <div className="comparator-image-area comparator-audio-area">
        <div className="comparator-audio-icon">🎵</div>
        <audio
          ref={audioRef}
          src={src}
          className="comparator-audio"
          controls={master}
          onPlay={master ? onPlay : undefined}
          onPause={master ? onPause : undefined}
          onSeeked={master ? onSeeked : undefined}
          data-testid={`audio-${side}`}
        />
      </div>
      <div className="comparator-footer">
        <KeepButton kept={kept} onKeep={onKeep} />
        <AudioMetaBlock file={file} />
      </div>
    </div>
  );
}

export function AudioComparator({
  groups,
  startIdx,
  selected,
  onSelectPaths,
  onClose,
}: ComparatorProps) {
  const { t } = useLang();
  const nav = useComparatorNav({ groups, startIdx, selected, onSelectPaths, onClose });
  const [mediaPort, setMediaPort] = useState<number | null>(null);
  const leftAudioRef = useRef<HTMLAudioElement>(null);
  const rightAudioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    invoke<number>("get_media_server_port").then(setMediaPort).catch(() => {});
  }, []);

  if (!nav.hasValidGroup) return null;

  const { leftFile, rightFile, keepFile, isKept } = nav;

  const leftSrc = mediaPort ? toMediaUrl(leftFile.path, mediaPort) : undefined;
  const rightSrc = mediaPort ? toMediaUrl(rightFile.path, mediaPort) : undefined;

  function syncPlay() {
    const ra = rightAudioRef.current;
    const la = leftAudioRef.current;
    if (ra && la) { ra.currentTime = la.currentTime; ra.play().catch(() => {}); }
  }

  function syncPause() {
    rightAudioRef.current?.pause();
  }

  function syncSeek() {
    const la = leftAudioRef.current;
    const ra = rightAudioRef.current;
    if (la && ra) ra.currentTime = la.currentTime;
  }

  return (
    <ComparatorShell
      nav={nav}
      groups={groups}
      title={t.audioComparator}
      onClose={onClose}
    >
      <div className="comparator-body" data-testid="comparator-body">
        <AudioPanel
          file={leftFile} audioRef={leftAudioRef}
          kept={isKept(leftFile)} side="left" src={leftSrc} master
          onPlay={syncPlay} onPause={syncPause} onSeeked={syncSeek}
          onKeep={() => keepFile(leftFile.path)}
        />
        <div className="comparator-divider" />
        <AudioPanel
          file={rightFile} audioRef={rightAudioRef}
          kept={isKept(rightFile)} side="right" src={rightSrc} master={false}
          onKeep={() => keepFile(rightFile.path)}
        />
      </div>
    </ComparatorShell>
  );
}
