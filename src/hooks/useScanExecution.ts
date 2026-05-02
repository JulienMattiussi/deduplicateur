import { useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ScanSummary } from "../types";

export interface ScanInvokeArgs {
  [key: string]: unknown;
  path: string;
  recursive: boolean;
  excluded: string[];
  byFolder: boolean;
  findSimilar: boolean;
  simThreshold: number;
  findSimilarVideos: boolean;
  videoSimThreshold: number;
  findSimilarAudio: boolean;
  audioSimThreshold: number;
  audioCacheEnabled: boolean;
  audioDurationTolerance: number;
}

export function useScanExecution(
  onComplete: (summary: ScanSummary) => Promise<void>,
  setError: (e: string | null) => void,
) {
  const [scanning, setScanning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; total_files?: number; file?: string } | null>(null);
  const progressHistoryRef = useRef<{ time: number; current: number }[]>([]);

  async function scan(args: ScanInvokeArgs) {
    setScanning(true);
    setProgress(null);
    progressHistoryRef.current = [];

    const unlisten = await listen<{ current: number; total: number; total_files?: number; file?: string }>(
      "scan:progress",
      (event) => {
        const p = event.payload;
        progressHistoryRef.current.push({ time: Date.now(), current: p.current });
        setProgress(p);
      }
    );

    try {
      const s = await invoke<ScanSummary>("scan_folder", args);
      await onComplete(s);
    } catch (e) {
      setError(String(e));
    } finally {
      unlisten();
      setScanning(false);
      setCancelling(false);
      setProgress(null);
    }
  }

  async function cancelScan() {
    setCancelling(true);
    await invoke("cancel_scan");
  }

  return { scanning, cancelling, progress, progressHistoryRef, scan, cancelScan };
}
