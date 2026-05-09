import React from "react";
import { interp, pluralInterp, type Translations } from "../i18n";
import type { ScanProgress, ScanPhase } from "../types";
import { ProgressETA } from "./ProgressETA";

const PHASE_ORDER: ScanPhase[] = ["reading", "exact", "images", "videos", "audio", "archives", "archives_phash", "archives_audio"];

interface Props {
  progress: ScanProgress | null;
  detectionMode: "files" | "images" | "videos" | "audio";
  scanArchives: boolean;
  historyRef: React.MutableRefObject<{ time: number; current: number }[]>;
  scanStartRef: React.MutableRefObject<number>;
  t: Translations;
}

export function ScanProgressView({ progress, detectionMode, scanArchives, historyRef, scanStartRef, t }: Props) {
  const phase = progress?.phase;

  const phaseNames: Record<ScanPhase, string> = {
    reading: t.phaseReading,
    exact: t.phaseExact,
    images: t.phaseImages,
    videos: t.phaseVideos,
    audio: t.phaseAudio,
    archives: t.phaseArchives,
    archives_phash: t.phaseArchivesPhash,
    archives_audio: t.phaseArchivesAudio,
  };

  const baseRelevant: ScanPhase[] =
    detectionMode === "files" ? ["reading", "exact"] :
    detectionMode === "images" ? ["reading", "exact", "images"] :
    detectionMode === "videos" ? ["reading", "exact", "videos"] :
    ["reading", "exact", "audio"];
  let relevantPhases: ScanPhase[] = scanArchives ? [...baseRelevant, "archives"] : baseRelevant;
  // Phase 2 d'archive (extraction + pHash) ne tourne qu'en mode Image avec scan_archives
  if (scanArchives && detectionMode === "images") {
    relevantPhases = [...relevantPhases, "archives_phash"];
  }
  // Phase 3 d'archive (extraction + fpcalc) ne tourne qu'en mode Audio avec scan_archives
  if (scanArchives && detectionMode === "audio") {
    relevantPhases = [...relevantPhases, "archives_audio"];
  }

  const currentPhaseIdx = phase ? PHASE_ORDER.indexOf(phase) : -1;

  const lastPhase: ScanPhase = relevantPhases[relevantPhases.length - 1];
  const isLastPhase = phase === lastPhase;

  const isReading = !phase || phase === "reading";
  const showBar = !isReading && progress && progress.total > 0;
  const pct = showBar ? Math.min(100, Math.round((progress.current / progress.total) * 100)) : 0;

  const fileType: string = phase === "exact" ? t.typeFiles
    : phase === "images" ? t.typeImages
    : phase === "videos" ? t.typeVideos
    : phase === "audio" ? t.typeAudio
    : phase === "archives" ? t.typeArchives
    : phase === "archives_phash" ? t.typeArchivesPhash
    : phase === "archives_audio" ? t.typeArchivesAudio
    : "";

  const heartbeat = progress?.current ?? 0;

  return (
    <div className="progress-container">
      <div className="progress-steps">
        {relevantPhases.map(p => {
          const idx = PHASE_ORDER.indexOf(p);
          const status = idx < currentPhaseIdx ? "done" : idx === currentPhaseIdx ? "active" : "pending";
          return (
            <div key={p} className={`progress-step progress-step--${status}`}>
              <span className="progress-step-dot">{status === "done" ? "✓" : status === "active" ? "●" : "○"}</span>
              <span className="progress-step-label">{phaseNames[p]}</span>
            </div>
          );
        })}
      </div>
      {!isReading && progress?.phase_current != null && (progress.phase_total ?? 0) > 0 && (
        <p className="progress-label">
          {interp(t.scanProgress, { n: progress.phase_current, m: progress.phase_total!, type: fileType })}
        </p>
      )}
      {(progress?.groups_found ?? 0) > 0 && (
        <p className="progress-groups-found">
          {pluralInterp(t.groupsFoundSoFar, progress!.groups_found!)}
        </p>
      )}
      {isReading ? (
        <div className="spinner" />
      ) : showBar ? (
        <>
          <div className="progress-track">
            <div className="progress-bar" style={{ width: `${pct}%` }} />
          </div>
          <p className="progress-pct">{pct} %</p>
          {progress.file && <p className="progress-filename">{progress.file}</p>}
        </>
      ) : null}
      {heartbeat > 0 && (
        <p className="progress-heartbeat">
          {interp(t.heartbeatCounter, { n: heartbeat.toLocaleString() })}
        </p>
      )}
      <ProgressETA
        historyRef={historyRef}
        scanStartRef={scanStartRef}
        isLastPhase={isLastPhase}
        progress={{ current: progress?.current ?? 0, total: progress?.total ?? 0 }}
        phaseCurrent={progress?.phase_current ?? 0}
        phaseTotal={progress?.phase_total ?? 0}
        t={t}
      />
    </div>
  );
}
