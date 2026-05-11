import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DuplicateFile, VideoMetadata, PreparedVideo } from "./types";
import { formatDurationSecs } from "./utils";
import { useLang } from "./LangContext";
import type { ComparatorProps } from "./comparatorShared";
import { useComparatorNav, ComparatorShell, MetaBlockBase, KeepButton, toMediaUrl } from "./comparatorShared";
import { isNativePlayerAvailable } from "./components/NativeVideo";
import { NativeComparatorBody } from "./components/NativeComparatorBody";
import type { AudioTrack } from "./types";

function channelsLabel(channels?: number | null, layout?: string | null): string {
  if (layout) return ` ${layout}`;
  if (channels === 1) return " mono";
  if (channels === 2) return " stereo";
  if (channels && channels > 2) return ` ${channels}ch`;
  return "";
}

function formatTrack(track: AudioTrack): string {
  // Titre humain prioritaire (souvent "French AC3 5.1" deja formatte par le muxer).
  if (track.title && track.title.trim().length > 0) {
    return track.title;
  }
  const lang = track.language ? ` [${track.language}]` : "";
  return `${track.codec}${channelsLabel(track.channels, track.channel_layout)}${lang}`;
}

/** Fallback retrocompat pour les sessions sauvees avant audio_tracks. */
function formatAudioFallback(meta: VideoMetadata, noneLabel: string): string {
  if (!meta.audio_codec) return noneLabel;
  return `${meta.audio_codec}${channelsLabel(meta.audio_channels)}`;
}

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
          <div className="comparator-meta-row">
            <span className="comparator-meta-label">
              {t.videoMetaAudio}
              {meta.audio_tracks && meta.audio_tracks.length > 1 ? ` (${meta.audio_tracks.length})` : ""}
            </span>
            {meta.audio_tracks && meta.audio_tracks.length > 0 ? (
              <span className="comparator-meta-value comparator-meta-audio-list">
                {meta.audio_tracks.map((track, i) => (
                  <span
                    key={track.index ?? i}
                    className={`audio-track${track.default ? " audio-track--default" : ""}`}
                    title={`#${track.index} - ${track.codec}${channelsLabel(track.channels, track.channel_layout)}${track.language ? ` [${track.language}]` : ""}${track.default ? " (défaut)" : ""}`}
                  >
                    {formatTrack(track)}
                  </span>
                ))}
              </span>
            ) : (
              <span
                className="comparator-meta-value"
                style={!meta.audio_codec ? { opacity: 0.6, fontStyle: "italic" } : undefined}
              >
                {formatAudioFallback(meta, t.videoMetaAudioNone)}
              </span>
            )}
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
  preparing,
  unsupported,
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
  preparing: boolean;
  unsupported: boolean;
  onPlay?: () => void;
  onPause?: () => void;
  onSeeked?: () => void;
  onKeep: () => void;
}) {
  const { t } = useLang();
  return (
    <div className="comparator-panel">
      <div className="comparator-image-area comparator-video-area">
        {unsupported ? (
          <div className="comparator-video-unsupported" data-testid={`video-unsupported-${side}`}>
            <div className="comparator-video-unsupported-title">{t.videoUnsupported}</div>
            <div className="comparator-video-unsupported-hint">{t.videoUnsupportedHint}</div>
          </div>
        ) : (
          <>
            {(preparing || !src) && (
              <span className="comparator-video-loading">
                {preparing ? t.videoPreparing : "…"}
              </span>
            )}
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
          </>
        )}
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
  const [leftPrep, setLeftPrep] = useState<PreparedVideo | null>(null);
  const [rightPrep, setRightPrep] = useState<PreparedVideo | null>(null);
  const [nativeAvailable, setNativeAvailable] = useState(false);
  const leftVideoRef = useRef<HTMLVideoElement>(null);
  const rightVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    invoke<number>("get_media_server_port").then(setMediaPort).catch(() => {});
    isNativePlayerAvailable().then(setNativeAvailable).catch(() => setNativeAvailable(false));
  }, []);

  useEffect(() => {
    if (!nav.hasValidGroup) return;
    const lf = nav.group.files[nav.effectiveLeftIdx];
    // Affichage immediat depuis la session (sans champs audio si cache pre-feature),
    // puis refetch ffprobe pour avoir les vraies infos audio.
    setLeftMeta(lf.video_metadata ?? null);
    invoke<VideoMetadata>("get_video_metadata", { path: lf.path })
      .then(setLeftMeta).catch(() => {});
  }, [nav.groupIdx, nav.effectiveLeftIdx]);

  useEffect(() => {
    if (!nav.hasValidGroup) return;
    const rf = nav.group.files[nav.effectiveRightIdx];
    setRightMeta(rf.video_metadata ?? null);
    invoke<VideoMetadata>("get_video_metadata", { path: rf.path })
      .then(setRightMeta).catch(() => {});
  }, [nav.groupIdx, nav.effectiveRightIdx]);

  // Preparation pour la lecture : direct, remux ffmpeg, ou unsupported.
  useEffect(() => {
    if (!nav.hasValidGroup) return;
    const lf = nav.group.files[nav.effectiveLeftIdx];
    setLeftPrep(null);
    let cancelled = false;
    invoke<PreparedVideo>("prepare_video_for_playback", { path: lf.path })
      .then((p) => { if (!cancelled) setLeftPrep(p); })
      .catch(() => { if (!cancelled) setLeftPrep({ kind: "Unsupported" }); });
    return () => { cancelled = true; };
  }, [nav.groupIdx, nav.effectiveLeftIdx]);

  useEffect(() => {
    if (!nav.hasValidGroup) return;
    const rf = nav.group.files[nav.effectiveRightIdx];
    setRightPrep(null);
    let cancelled = false;
    invoke<PreparedVideo>("prepare_video_for_playback", { path: rf.path })
      .then((p) => { if (!cancelled) setRightPrep(p); })
      .catch(() => { if (!cancelled) setRightPrep({ kind: "Unsupported" }); });
    return () => { cancelled = true; };
  }, [nav.groupIdx, nav.effectiveRightIdx]);

  if (!nav.hasValidGroup) return null;

  const { leftFile, rightFile, keepFile, isKept } = nav;

  const leftUnsupported = leftPrep?.kind === "Unsupported";
  const rightUnsupported = rightPrep?.kind === "Unsupported";
  const leftPreparing = leftPrep === null;
  const rightPreparing = rightPrep === null;
  const leftPath = leftPrep && leftPrep.kind !== "Unsupported" ? leftPrep.path : null;
  const rightPath = rightPrep && rightPrep.kind !== "Unsupported" ? rightPrep.path : null;
  const leftSrc = mediaPort && leftPath ? toMediaUrl(leftPath, mediaPort) : undefined;
  const rightSrc = mediaPort && rightPath ? toMediaUrl(rightPath, mediaPort) : undefined;

  // Bascule en lecteur natif libmpv si l'un des deux cotes n'est pas lisible par
  // le `<video>` HTML5 ET que la machine supporte le natif. Les deux cotes passent
  // alors en natif pour conserver une sync coherente (un master/slave pur libmpv).
  const useNative = nativeAvailable && !leftPreparing && !rightPreparing && (leftUnsupported || rightUnsupported);

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

  if (useNative) {
    return (
      <ComparatorShell
        nav={nav}
        groups={groups}
        title={t.videoComparator}
        onClose={onClose}
      >
        <NativeComparatorBody
          leftPath={leftFile.path}
          rightPath={rightFile.path}
          leftMetaSlot={<VideoMetaBlock file={leftFile} meta={leftMeta} />}
          rightMetaSlot={<VideoMetaBlock file={rightFile} meta={rightMeta} />}
          leftKeepSlot={<KeepButton kept={isKept(leftFile)} onKeep={() => keepFile(leftFile.path)} />}
          rightKeepSlot={<KeepButton kept={isKept(rightFile)} onKeep={() => keepFile(rightFile.path)} />}
        />
      </ComparatorShell>
    );
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
          preparing={leftPreparing} unsupported={leftUnsupported}
          onPlay={syncPlay} onPause={syncPause} onSeeked={syncSeek}
          onKeep={() => keepFile(leftFile.path)}
        />
        <div className="comparator-divider" />
        <VideoPanel
          file={rightFile} meta={rightMeta} videoRef={rightVideoRef}
          kept={isKept(rightFile)} side="right" src={rightSrc} master={false}
          preparing={rightPreparing} unsupported={rightUnsupported}
          onKeep={() => keepFile(rightFile.path)}
        />
      </div>
    </ComparatorShell>
  );
}
