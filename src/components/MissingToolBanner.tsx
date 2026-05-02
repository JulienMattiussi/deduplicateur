import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { useLang } from "../LangContext";
import { interp } from "../i18n";

export type MissingTool = "ffmpeg" | "fpcalc";

interface Props {
  tool: MissingTool;
  onAvailable: () => void;
}

interface CheckToolsResult {
  ffmpeg_available: boolean;
  fpcalc_available: boolean;
}

function detectOS(): "windows" | "mac" | "linux" {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("win")) return "windows";
  if (ua.includes("mac")) return "mac";
  return "linux";
}

const DOWNLOAD_URLS: Record<MissingTool, string> = {
  ffmpeg: "https://ffmpeg.org/download.html",
  fpcalc: "https://acoustid.org/chromaprint",
};

const LINUX_PKGS: Record<MissingTool, string> = {
  ffmpeg: "ffmpeg",
  fpcalc: "libchromaprint-tools",
};

const TYPE_LABELS: Record<MissingTool, { fr: string; en: string }> = {
  ffmpeg: { fr: "video", en: "video" },
  fpcalc: { fr: "audio", en: "audio" },
};

export function MissingToolBanner({ tool, onAvailable }: Props) {
  const { t } = useLang();
  const [checking, setChecking] = useState(false);
  const [found, setFound] = useState(false);

  const os = detectOS();
  const pkg = LINUX_PKGS[tool];
  const typeLabel = TYPE_LABELS[tool][t.dateLocale === "fr-FR" ? "fr" : "en"];

  async function handleCheckAgain() {
    setChecking(true);
    try {
      const result = await invoke<CheckToolsResult>("check_tools");
      const available = tool === "ffmpeg" ? result.ffmpeg_available : result.fpcalc_available;
      if (available) {
        setFound(true);
        onAvailable();
      }
    } catch {
      // ignore
    } finally {
      setChecking(false);
    }
  }

  async function handleDownload() {
    try {
      await shellOpen(DOWNLOAD_URLS[tool]);
    } catch {
      // ignore
    }
  }

  if (found) {
    return (
      <div className="missing-tool-banner missing-tool-banner--found">
        {interp(t.toolFound, { tool })}
      </div>
    );
  }

  return (
    <div className="missing-tool-banner">
      <div className="missing-tool-banner__header">
        <span className="missing-tool-banner__title">
          {interp(t.toolMissingTitle, { tool })}
        </span>
        <span className="missing-tool-banner__desc">
          {interp(t.toolMissingDesc, { type: typeLabel })}
        </span>
      </div>
      <div className="missing-tool-banner__instructions">
        {os === "windows" && (
          <span>{interp(t.toolInstallWindows, { tool })}</span>
        )}
        {os === "mac" && (
          <span>{interp(t.toolInstallMac, { tool })}</span>
        )}
        {os === "linux" && (
          <span>{interp(t.toolInstallLinux, { pkg, tool })}</span>
        )}
      </div>
      <div className="missing-tool-banner__actions">
        <button className="btn-ghost btn-sm" onClick={handleDownload}>
          {t.toolDownload}
        </button>
        <button className="btn-ghost btn-sm" onClick={handleCheckAgain} disabled={checking}>
          {t.toolCheckAgain}
        </button>
      </div>
    </div>
  );
}
