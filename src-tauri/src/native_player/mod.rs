//! Lecteur video natif libmpv pour les codecs/conteneurs que la WebView ne sait pas lire
//! (MPEG-4 ASP/Xvid/DivX dans .avi, WMV3 dans .wmv, audio AC3/WMA/Vorbis/Speex...).
//!
//! Architecture :
//! - Une fenetre native fille de la fenetre Tauri principale est creee a la demande
//!   (HWND child sur Windows, sous-fenetre X11 sur Linux), positionnee par-dessus
//!   l'emplacement DOM du `<video>` placeholder.
//! - libmpv est instanciee avec `wid=<handle>` pointant sur cette fenetre.
//! - Le frontend dialogue avec un registre via les commandes `native_player_*`.
//! - Sync maitre/esclave (gauche/droite du comparateur) est faite cote Rust via les
//!   commandes `play_pair` / `pause_pair` / `seek_pair` qui agissent atomiquement
//!   sur les deux instances.
//!
//! Plateformes :
//! - Windows : OK (HWND child via Win32 + libmpv `wid`).
//! - Linux X11 : OK (sous-fenetre X11 via x11rb + libmpv `wid`).
//! - Linux Wayland : non supporte pour le moment (pas d'API d'embedding cross-process
//!   en Wayland). Le `create` retourne une erreur "wayland_unsupported", l'UI doit
//!   retomber sur le placeholder + bouton lecteur systeme.
//! - macOS : non supporte (pas implemente, suivi futur).
//!
//! Feature flag : tout le code est gate sur `feature = "native-player"`. Les commandes
//! Tauri restent enregistrees mais retournent une erreur "feature_disabled" quand la
//! feature est off, ce qui permet de builder le projet sans libmpv installe (review
//! de code, environnement minimal).

use serde::{Deserialize, Serialize};

#[cfg(feature = "native-player")]
pub(crate) mod platform;

#[cfg(feature = "native-player")]
mod player;

#[cfg(feature = "native-player")]
mod registry;

#[cfg(feature = "native-player")]
pub use registry::NativePlayerRegistry;

/// Geometrie d'une fenetre native, en pixels CSS du frontend.
/// Le backend convertit en pixels physiques via `tauri::Window::scale_factor()` avant
/// les appels Win32 / X11.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Snapshot de l'etat d'un player, polle ou pousse vers le frontend.
#[derive(Debug, Clone, Default, Serialize)]
pub struct PlayerState {
    pub current_time: f64,
    pub duration: f64,
    pub paused: bool,
    pub eof: bool,
    pub loaded: bool,
}

/// Stub de registre quand la feature est off : permet de declarer une `tauri::State`
/// uniforme dans `lib.rs::run` quel que soit le mode de build.
#[cfg(not(feature = "native-player"))]
#[derive(Default)]
pub struct NativePlayerRegistry;

#[cfg(not(feature = "native-player"))]
impl NativePlayerRegistry {
    pub fn new() -> Self {
        Self
    }
}
