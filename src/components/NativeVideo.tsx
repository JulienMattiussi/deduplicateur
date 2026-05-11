import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * Etat polle du lecteur natif (libmpv).
 */
export type NativePlayerState = {
  current_time: number;
  duration: number;
  paused: boolean;
  eof: boolean;
  loaded: boolean;
};

/**
 * Methodes imperatives exposees au parent via ref. Symetriques a ce qu'un
 * `<video>` HTML5 expose (currentTime, play, pause, addEventListener), mais
 * via le backend Rust qui pilote libmpv.
 */
export type NativeVideoHandle = {
  load: (path: string) => Promise<void>;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  seek: (t: number) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  getState: () => Promise<NativePlayerState>;
  /** Id du player cote backend, null si pas encore cree ou si la creation a echoue. */
  getId: () => number | null;
};

type Geometry = { x: number; y: number; width: number; height: number };

type NativeVideoProps = {
  audio: boolean;
  side: "left" | "right";
  /** Cache la fenetre native quand un modal/dialog DOM s'ouvre par-dessus. */
  hidden?: boolean;
  /** Notifie le parent quand l'instance backend est creee (utile pour la sync de paire). */
  onReady?: (id: number) => void;
  /** Erreur de creation (ex. "wayland_unsupported", "feature_disabled"). */
  onError?: (message: string) => void;
};

function getGeometry(el: HTMLElement): Geometry {
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.left),
    y: Math.round(r.top),
    width: Math.max(1, Math.round(r.width)),
    height: Math.max(1, Math.round(r.height)),
  };
}

function geometryEquals(a: Geometry, b: Geometry): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * Composant React qui sert de placeholder DOM (div noir) pour une fenetre native
 * libmpv positionnee par-dessus. Le backend cree la fenetre Win32 / X11 a la creation,
 * suit les ResizeObserver / scroll pour la repositionner, et la detruit au unmount.
 *
 * Attention :
 * - La fenetre native est par-dessus le contenu DOM (z-order natif > webview).
 *   Quand un modal s'ouvre, passer `hidden=true` pour la cacher temporairement.
 * - Sur Wayland (sans X11), la creation echoue et `onError("wayland_unsupported")`
 *   est appele - l'UI doit retomber sur le placeholder.
 */
export const NativeVideo = forwardRef<NativeVideoHandle, NativeVideoProps>(
  function NativeVideo({ audio, side, hidden, onReady, onError }, ref) {
    const placeholderRef = useRef<HTMLDivElement>(null);
    const idRef = useRef<number | null>(null);
    const lastGeometryRef = useRef<Geometry | null>(null);
    const [createError, setCreateError] = useState<string | null>(null);

    // Creation du player + cleanup au unmount.
    useEffect(() => {
      const el = placeholderRef.current;
      if (!el) return;
      let cancelled = false;
      let createdId: number | null = null;
      const geom = getGeometry(el);
      lastGeometryRef.current = geom;

      invoke<number>("native_player_create", { geometry: geom, audio })
        .then((id) => {
          if (cancelled) {
            // Le composant a ete demonte avant la fin de la creation.
            invoke("native_player_destroy", { id }).catch(() => {});
            return;
          }
          createdId = id;
          idRef.current = id;
          onReady?.(id);
          // NOTE : un forced set_geometry juste apres onReady causait un freeze sur
          // Windows (cf. platform.rs). Le ResizeObserver fera le travail des qu'un
          // changement de layout est detecte.
        })
        .catch((e) => {
          const msg = String(e);
          setCreateError(msg);
          onError?.(msg);
        });

      return () => {
        cancelled = true;
        const id = createdId ?? idRef.current;
        if (id != null) {
          invoke("native_player_destroy", { id }).catch(() => {});
        }
        idRef.current = null;
      };
    }, [audio, onError, onReady]);

    // Suivi geometrie : ResizeObserver sur le placeholder + listener scroll global.
    // A chaque changement, on envoie le nouveau rect au backend pour repositionner
    // la fenetre native.
    useEffect(() => {
      const el = placeholderRef.current;
      if (!el) return;

      const update = () => {
        const id = idRef.current;
        if (id == null) return;
        const g = getGeometry(el);
        if (lastGeometryRef.current && geometryEquals(g, lastGeometryRef.current)) {
          return;
        }
        lastGeometryRef.current = g;
        invoke("native_player_set_geometry", { id, geometry: g }).catch(() => {});
      };

      const ro = new ResizeObserver(update);
      ro.observe(el);
      // scroll : la WebView Tauri a typiquement un seul scroll au niveau body, mais
      // pour etre safe on ecoute scroll en capture sur window.
      window.addEventListener("scroll", update, true);
      window.addEventListener("resize", update);

      // Premier sync au cas ou le ResizeObserver ne fire pas immediatement.
      update();

      return () => {
        ro.disconnect();
        window.removeEventListener("scroll", update, true);
        window.removeEventListener("resize", update);
      };
    }, []);

    // IntersectionObserver : cache la fenetre native quand le placeholder sort
    // du viewport (ex. scroll qui passe la zone) - sinon la fenetre reste visible
    // par-dessus du contenu non lie.
    useEffect(() => {
      const el = placeholderRef.current;
      if (!el) return;

      const io = new IntersectionObserver(
        (entries) => {
          const id = idRef.current;
          if (id == null) return;
          const visible = entries[0]?.isIntersecting ?? false;
          invoke("native_player_set_visible", { id, visible }).catch(() => {});
        },
        { threshold: 0.05 }
      );
      io.observe(el);
      return () => io.disconnect();
    }, []);

    // Toggle de visibilite externe (modal ouvert par-dessus) : superpose au
    // IntersectionObserver. Un appel set_visible(false) ici override l'observer.
    useEffect(() => {
      const id = idRef.current;
      if (id == null) return;
      if (hidden) {
        invoke("native_player_set_visible", { id, visible: false }).catch(() => {});
      } else {
        invoke("native_player_set_visible", { id, visible: true }).catch(() => {});
      }
    }, [hidden]);

    // API imperative pour le parent (VideoComparator).
    useImperativeHandle(
      ref,
      (): NativeVideoHandle => ({
        load: async (path: string) => {
          const id = idRef.current;
          if (id == null) throw new Error("native_player: pas encore initialise");
          await invoke("native_player_load", { id, path });
        },
        play: async () => {
          const id = idRef.current;
          if (id == null) return;
          await invoke("native_player_play_pair", { left: id, right: id });
        },
        pause: async () => {
          const id = idRef.current;
          if (id == null) return;
          await invoke("native_player_pause_pair", { left: id, right: id });
        },
        seek: async (t: number) => {
          const id = idRef.current;
          if (id == null) return;
          await invoke("native_player_seek_pair", { left: id, right: id, time: t });
        },
        setVolume: async (volume: number) => {
          const id = idRef.current;
          if (id == null) return;
          await invoke("native_player_set_volume", { id, volume });
        },
        getState: async () => {
          const id = idRef.current;
          if (id == null) {
            return {
              current_time: 0,
              duration: 0,
              paused: true,
              eof: false,
              loaded: false,
            };
          }
          return await invoke<NativePlayerState>("native_player_get_state", { id });
        },
        getId: () => idRef.current,
      }),
      []
    );

    return (
      <div
        ref={placeholderRef}
        className="native-video-placeholder"
        data-testid={`native-video-${side}`}
        data-error={createError ?? undefined}
        // Background noir : si la fenetre native met du temps a se positionner,
        // on voit du noir au lieu du contenu de la WebView qui transparait.
        style={{
          width: "100%",
          height: "100%",
          background: "black",
          minHeight: 100,
        }}
      />
    );
  }
);

/**
 * Verifie a l'init que le lecteur natif est disponible sur la machine courante.
 * Cache le resultat dans une variable module pour eviter de re-interroger Rust
 * a chaque rendu.
 */
let availabilityCache: boolean | null = null;
export async function isNativePlayerAvailable(): Promise<boolean> {
  if (availabilityCache !== null) return availabilityCache;
  try {
    availabilityCache = await invoke<boolean>("native_player_available");
  } catch {
    availabilityCache = false;
  }
  return availabilityCache;
}
