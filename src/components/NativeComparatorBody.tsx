import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { NativeVideo, type NativeVideoHandle, type NativePlayerState } from "./NativeVideo";
import { formatDurationSecs } from "../utils";
import { useLang } from "../LangContext";

/**
 * Body alternatif du VideoComparator quand au moins un cote est `Unsupported`
 * et que le lecteur natif est disponible. Affiche deux NativeVideo cote-a-cote
 * + une barre de controles unique qui pilote les deux instances en sync via
 * `native_player_play_pair` / `pause_pair` / `seek_pair`.
 *
 * Le panneau gauche est le maitre audio (audio=true), la droite est mute (audio=false).
 */
export function NativeComparatorBody({
  leftPath,
  rightPath,
  leftMetaSlot,
  rightMetaSlot,
  leftKeepSlot,
  rightKeepSlot,
}: {
  leftPath: string;
  rightPath: string;
  leftMetaSlot: React.ReactNode;
  rightMetaSlot: React.ReactNode;
  leftKeepSlot: React.ReactNode;
  rightKeepSlot: React.ReactNode;
}) {
  const { t } = useLang();
  const leftRef = useRef<NativeVideoHandle>(null);
  const rightRef = useRef<NativeVideoHandle>(null);
  const [leftId, setLeftId] = useState<number | null>(null);
  const [rightId, setRightId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<NativePlayerState>({
    current_time: 0,
    duration: 0,
    paused: true,
    eof: false,
    loaded: false,
  });
  const [scrubbing, setScrubbing] = useState(false);

  // Charge le fichier dans chaque instance des qu'elle est prete et que le path change.
  useEffect(() => {
    if (leftId == null) return;
    leftRef.current?.load(leftPath).catch((e) => setError(String(e)));
  }, [leftId, leftPath]);
  useEffect(() => {
    if (rightId == null) return;
    rightRef.current?.load(rightPath).catch((e) => setError(String(e)));
  }, [rightId, rightPath]);

  // Polling : on lit l'etat du maitre toutes les 250 ms tant que le composant est monte.
  useEffect(() => {
    if (leftId == null) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const s = await leftRef.current!.getState();
        if (!cancelled && !scrubbing) setState(s);
      } catch {
        // ignore errors during polling - typically transient (player being destroyed)
      }
    };
    tick();
    const interval = setInterval(tick, 250);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [leftId, scrubbing]);

  const togglePlay = useCallback(async () => {
    if (leftId == null || rightId == null) return;
    try {
      if (state.paused || state.eof) {
        // Si on a atteint la fin, on rembobine avant de relancer.
        if (state.eof) {
          await invoke("native_player_seek_pair", {
            left: leftId,
            right: rightId,
            time: 0,
          });
        }
        await invoke("native_player_play_pair", { left: leftId, right: rightId });
      } else {
        await invoke("native_player_pause_pair", { left: leftId, right: rightId });
      }
    } catch (e) {
      setError(String(e));
    }
  }, [leftId, rightId, state.paused, state.eof]);

  const onScrubStart = useCallback(() => setScrubbing(true), []);
  const onScrubChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const t = Number(e.target.value);
      // Mise a jour visuelle immediate pendant le drag, on n'envoie au backend
      // qu'au mouseup pour eviter de noyer libmpv en seek().
      setState((s) => ({ ...s, current_time: t }));
    },
    []
  );
  const onScrubEnd = useCallback(
    async (e: React.MouseEvent<HTMLInputElement> | React.TouchEvent<HTMLInputElement>) => {
      if (leftId == null || rightId == null) return;
      const target = e.currentTarget as HTMLInputElement;
      const time = Number(target.value);
      try {
        await invoke("native_player_seek_pair", { left: leftId, right: rightId, time });
      } catch (err) {
        setError(String(err));
      } finally {
        setScrubbing(false);
      }
    },
    [leftId, rightId]
  );

  const handleLeftError = useCallback((msg: string) => {
    setError(msg);
  }, []);

  return (
    <div className="comparator-body comparator-body-native" data-testid="native-comparator-body">
      <div className="comparator-panel">
        <div className="comparator-image-area comparator-video-area">
          <NativeVideo
            ref={leftRef}
            audio={true}
            side="left"
            onReady={setLeftId}
            onError={handleLeftError}
          />
        </div>
        <div className="comparator-footer">
          {leftKeepSlot}
          {leftMetaSlot}
        </div>
      </div>
      <div className="comparator-divider" />
      <div className="comparator-panel">
        <div className="comparator-image-area comparator-video-area">
          <NativeVideo
            ref={rightRef}
            audio={false}
            side="right"
            onReady={setRightId}
          />
        </div>
        <div className="comparator-footer">
          {rightKeepSlot}
          {rightMetaSlot}
        </div>
      </div>

      {/* Barre de controles partagee : flotte au-dessus du divider, position fixed bottom */}
      <div className="native-controls" data-testid="native-controls">
        {error && (
          <div className="native-controls-error" role="alert">
            {error}
          </div>
        )}
        <button
          className="native-controls-button"
          onClick={togglePlay}
          disabled={leftId == null || rightId == null}
          aria-label={state.paused ? t.videoPlay : t.videoPause}
        >
          {state.paused || state.eof ? "▶" : "❚❚"}
        </button>
        <span className="native-controls-time">
          {formatDurationSecs(state.current_time)}
        </span>
        <input
          type="range"
          className="native-controls-scrubber"
          min={0}
          max={Math.max(0.1, state.duration)}
          step={0.1}
          value={state.current_time}
          onMouseDown={onScrubStart}
          onTouchStart={onScrubStart}
          onChange={onScrubChange}
          onMouseUp={onScrubEnd}
          onTouchEnd={onScrubEnd}
          disabled={!state.loaded}
        />
        <span className="native-controls-time">
          {formatDurationSecs(state.duration)}
        </span>
      </div>
    </div>
  );
}
