//! Commandes Tauri pour piloter le `NativePlayerRegistry` depuis le frontend.
//!
//! Lifecycle cote frontend :
//! 1. `native_player_create({ x, y, width, height }, audio: bool)` → renvoie un `u64`
//!    identifiant le player.
//! 2. `native_player_load(id, path)` charge le fichier (mpv embarque ffmpeg, donc tout
//!    ce que ffmpeg decode marche : MPEG-4 ASP, WMV3, AC3 audio, etc.).
//! 3. `native_player_play_pair(left, right)` / `pause_pair` / `seek_pair(t)` pour
//!    operer atomiquement sur les deux players du comparateur cote-a-cote.
//! 4. `native_player_set_geometry(id, geometry)` a chaque ResizeObserver / scroll.
//! 5. `native_player_set_visible(id, visible)` pour cacher derriere un modal DOM.
//! 6. `native_player_get_state(id)` polle l'etat (current_time, duration, paused, eof).
//! 7. `native_player_destroy(id)` au unmount du composant React.
//!
//! ## Thread affinity (Windows)
//!
//! Les fenetres Win32 ont une thread affinity : seul le thread qui a fait `CreateWindowExW`
//! peut appeler `SetWindowPos` / `ShowWindow` / `DestroyWindow` sans risque de deadlock,
//! parce que ces appels utilisent `SendMessage` synchrone vers les windows en z-order.
//! Si le thread proprietaire ne pompe pas les messages Win32, deadlock.
//!
//! Les commandes Tauri tournent sur des workers tokio, pas le thread principal qui pompe
//! la file Win32. Donc toutes les ops qui touchent la fenetre native (create, destroy,
//! set_geometry, set_visible) sont dispatchees vers le thread principal via
//! `Window::run_on_main_thread`, avec un `tokio::sync::oneshot::channel` pour recuperer
//! le resultat.
//!
//! Les ops mpv pures (load, play, pause, seek, get_state) n'ont pas ce probleme : libmpv
//! gere sa propre synchronisation interne et accepte les commandes depuis n'importe quel
//! thread. Elles restent simples.

use std::sync::Arc;

use crate::native_player::{NativePlayerRegistry, PlayerState, Rect};
#[cfg(feature = "native-player")]
use crate::native_player::platform::ParentHandle;

/// Convertit un Rect en pixels CSS vers un Rect en pixels physiques via le scale factor
/// de la fenetre Tauri. Necessaire car Win32/X11 raisonnent en pixels physiques tandis
/// que le frontend envoie ce qu'il connait (CSS, post-zoom).
#[cfg(feature = "native-player")]
fn to_physical(rect: Rect, scale: f64) -> Rect {
    Rect {
        x: (rect.x as f64 * scale).round() as i32,
        y: (rect.y as f64 * scale).round() as i32,
        width: (rect.width as f64 * scale).round().max(1.0) as u32,
        height: (rect.height as f64 * scale).round().max(1.0) as u32,
    }
}

/// Dispatche un closure sur le thread principal Tauri et attend son resultat via
/// un `tokio::sync::oneshot::channel`. Le closure doit etre `Send + 'static`, et son
/// resultat aussi.
#[cfg(feature = "native-player")]
async fn run_main<F, T>(window: &tauri::Window, f: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    let (tx, rx) = tokio::sync::oneshot::channel();
    window
        .run_on_main_thread(move || {
            let _ = tx.send(f());
        })
        .map_err(|e| format!("native_player: run_on_main_thread failed: {:?}", e))?;
    rx.await
        .map_err(|e| format!("native_player: main thread closure dropped: {:?}", e))?
}

#[tauri::command]
pub async fn native_player_create(
    window: tauri::Window,
    registry: tauri::State<'_, Arc<NativePlayerRegistry>>,
    geometry: Rect,
    audio: bool,
) -> Result<u64, String> {
    #[cfg(feature = "native-player")]
    {
        let parent = ParentHandle::from_tauri(&window);
        if matches!(parent, ParentHandle::Unsupported) {
            return Err("native_player: handle de fenetre non supporte (probablement Wayland sans Xwayland accessible)".into());
        }
        let scale = window.scale_factor().unwrap_or(1.0);
        let physical = to_physical(geometry, scale);
        let registry = Arc::clone(registry.inner());
        // CreateWindowExW + libmpv setup : tout doit etre sur le thread principal pour
        // que la fenetre soit "possedee" par le thread qui pompe les messages Win32.
        run_main(&window, move || registry.create(parent, physical, audio)).await
    }
    #[cfg(not(feature = "native-player"))]
    {
        let _ = (window, registry, geometry, audio);
        Err("native_player: feature_disabled (recompiler avec --features native-player)".into())
    }
}

#[tauri::command]
pub async fn native_player_destroy(
    window: tauri::Window,
    registry: tauri::State<'_, Arc<NativePlayerRegistry>>,
    id: u64,
) -> Result<(), String> {
    #[cfg(feature = "native-player")]
    {
        let registry = Arc::clone(registry.inner());
        // Drop de NativePlayer = mpv_terminate + DestroyWindow. Doit etre sur le thread
        // proprietaire de la fenetre (= thread principal).
        run_main(&window, move || {
            registry.destroy(id);
            Ok(())
        })
        .await
    }
    #[cfg(not(feature = "native-player"))]
    {
        let _ = (window, registry, id);
        Ok(())
    }
}

#[tauri::command]
pub async fn native_player_load(
    registry: tauri::State<'_, Arc<NativePlayerRegistry>>,
    id: u64,
    path: String,
) -> Result<(), String> {
    #[cfg(feature = "native-player")]
    {
        // Pas de Win32 ici, juste mpv.command("loadfile") qui est thread-safe.
        registry.with(id, |p| p.load(&path))
    }
    #[cfg(not(feature = "native-player"))]
    {
        let _ = (registry, id, path);
        Err("native_player: feature_disabled".into())
    }
}

#[tauri::command]
pub async fn native_player_play_pair(
    registry: tauri::State<'_, Arc<NativePlayerRegistry>>,
    left: u64,
    right: u64,
) -> Result<(), String> {
    #[cfg(feature = "native-player")]
    {
        registry.with_pair(left, right, |a, b| {
            a.play()?;
            b.play()?;
            Ok(())
        })
    }
    #[cfg(not(feature = "native-player"))]
    {
        let _ = (registry, left, right);
        Err("native_player: feature_disabled".into())
    }
}

#[tauri::command]
pub async fn native_player_pause_pair(
    registry: tauri::State<'_, Arc<NativePlayerRegistry>>,
    left: u64,
    right: u64,
) -> Result<(), String> {
    #[cfg(feature = "native-player")]
    {
        registry.with_pair(left, right, |a, b| {
            a.pause()?;
            b.pause()?;
            Ok(())
        })
    }
    #[cfg(not(feature = "native-player"))]
    {
        let _ = (registry, left, right);
        Err("native_player: feature_disabled".into())
    }
}

#[tauri::command]
pub async fn native_player_seek_pair(
    registry: tauri::State<'_, Arc<NativePlayerRegistry>>,
    left: u64,
    right: u64,
    time: f64,
) -> Result<(), String> {
    #[cfg(feature = "native-player")]
    {
        registry.with_pair(left, right, |a, b| {
            a.seek(time)?;
            b.seek(time)?;
            Ok(())
        })
    }
    #[cfg(not(feature = "native-player"))]
    {
        let _ = (registry, left, right, time);
        Err("native_player: feature_disabled".into())
    }
}

#[tauri::command]
pub async fn native_player_set_geometry(
    window: tauri::Window,
    registry: tauri::State<'_, Arc<NativePlayerRegistry>>,
    id: u64,
    geometry: Rect,
) -> Result<(), String> {
    #[cfg(feature = "native-player")]
    {
        let scale = window.scale_factor().unwrap_or(1.0);
        let physical = to_physical(geometry, scale);
        let registry = Arc::clone(registry.inner());
        // SetWindowPos doit etre sur le thread proprietaire de la fenetre.
        run_main(&window, move || registry.with(id, |p| p.set_geometry(physical))).await
    }
    #[cfg(not(feature = "native-player"))]
    {
        let _ = (window, registry, id, geometry);
        Err("native_player: feature_disabled".into())
    }
}

#[tauri::command]
pub async fn native_player_set_visible(
    window: tauri::Window,
    registry: tauri::State<'_, Arc<NativePlayerRegistry>>,
    id: u64,
    visible: bool,
) -> Result<(), String> {
    #[cfg(feature = "native-player")]
    {
        let registry = Arc::clone(registry.inner());
        // ShowWindow doit etre sur le thread proprietaire de la fenetre.
        run_main(&window, move || registry.with(id, |p| p.set_visible(visible))).await
    }
    #[cfg(not(feature = "native-player"))]
    {
        let _ = (window, registry, id, visible);
        Err("native_player: feature_disabled".into())
    }
}

#[tauri::command]
pub async fn native_player_set_volume(
    registry: tauri::State<'_, Arc<NativePlayerRegistry>>,
    id: u64,
    volume: f64,
) -> Result<(), String> {
    #[cfg(feature = "native-player")]
    {
        // mpv set_property("volume") est thread-safe, pas besoin de main-thread.
        registry.with(id, |p| p.set_volume(volume))
    }
    #[cfg(not(feature = "native-player"))]
    {
        let _ = (registry, id, volume);
        Err("native_player: feature_disabled".into())
    }
}

#[tauri::command]
pub async fn native_player_get_state(
    registry: tauri::State<'_, Arc<NativePlayerRegistry>>,
    id: u64,
) -> Result<PlayerState, String> {
    #[cfg(feature = "native-player")]
    {
        // Lecture de properties mpv, thread-safe via libmpv interne.
        registry.state(id)
    }
    #[cfg(not(feature = "native-player"))]
    {
        let _ = (registry, id);
        Err("native_player: feature_disabled".into())
    }
}

/// Indique au frontend si le lecteur natif est disponible sur cette machine. Permet a
/// l'UI de basculer en avance vers le placeholder + bouton "ouvrir dans le lecteur
/// systeme" sans tenter `create` qui echouerait pour rien.
#[tauri::command]
pub async fn native_player_available() -> bool {
    #[cfg(feature = "native-player")]
    {
        !crate::native_player::platform::is_wayland_session()
    }
    #[cfg(not(feature = "native-player"))]
    {
        false
    }
}
