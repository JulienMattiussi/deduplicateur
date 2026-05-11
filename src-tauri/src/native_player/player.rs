//! Wrapper Rust autour d'une instance libmpv2 + de sa fenetre native fille.
//!
//! Lifecycle :
//! - `NativePlayer::create(parent_handle, rect, audio)` cree la fenetre native, configure
//!   les options mpv (wid, hwdec, pause, keep-open...) puis instancie `Mpv`.
//! - Les operations `load` / `play` / `pause` / `seek` / `set_geometry` / `set_visible`
//!   sont thread-safe (libmpv accepte les commandes depuis n'importe quel thread).
//! - `Drop` termine l'instance mpv puis detruit la fenetre native.

use super::platform::{NativeWindow, ParentHandle};
#[cfg(target_os = "linux")]
use super::platform::NativeWindowFactory;
use super::{PlayerState, Rect};

use libmpv2::Mpv;

/// Convertit n'importe quelle erreur libmpv2 en String pour traverser les commandes Tauri.
fn err<E: std::fmt::Debug>(e: E) -> String {
    format!("native_player libmpv error: {:?}", e)
}

pub struct NativePlayer {
    mpv: Mpv,
    window: NativeWindow,
}

impl NativePlayer {
    /// Cree un player avec sa propre fenetre native fille de `parent`. La feneetre est
    /// posee aux coordonnees `rect` et restera visible jusqu'a `set_visible(false)` ou Drop.
    /// `audio` permet de couper l'audio (cas du player esclave dans le comparateur, ou les
    /// deux pistes audio ne doivent pas se cumuler).
    #[cfg(target_os = "windows")]
    pub fn create(parent: ParentHandle, rect: Rect, audio: bool) -> Result<Self, String> {
        let window = NativeWindow::create(parent, rect)?;
        let mpv = build_mpv(window.id(), audio)?;
        Ok(Self { mpv, window })
    }

    /// Variante Linux : prend en plus le `factory` X11 partage par toutes les instances
    /// (une seule connexion X11 ouverte pour le process).
    #[cfg(target_os = "linux")]
    pub fn create(
        factory: &NativeWindowFactory,
        parent: ParentHandle,
        rect: Rect,
        audio: bool,
    ) -> Result<Self, String> {
        let window = factory.create(parent, rect)?;
        let mpv = build_mpv(window.id(), audio)?;
        Ok(Self { mpv, window })
    }

    pub fn load(&self, path: &str) -> Result<(), String> {
        self.mpv.command("loadfile", &[path]).map_err(err)
    }

    pub fn play(&self) -> Result<(), String> {
        self.mpv.set_property("pause", false).map_err(err)
    }

    pub fn pause(&self) -> Result<(), String> {
        self.mpv.set_property("pause", true).map_err(err)
    }

    pub fn seek(&self, t: f64) -> Result<(), String> {
        // `time-pos` accepte un f64 absolu, equivalent a `command("seek", &[t, "absolute"])`
        // mais sans argument string a parser. Plus rapide pour la sync droite/gauche.
        self.mpv.set_property("time-pos", t).map_err(err)
    }

    pub fn set_geometry(&self, rect: Rect) -> Result<(), String> {
        self.window.set_geometry(rect)
    }

    pub fn set_visible(&self, visible: bool) -> Result<(), String> {
        self.window.set_visible(visible)
    }

    /// Volume sur l'echelle mpv : 0..100 = normal, jusqu'a 130 pour boost (capped par
    /// libmpv apres). Pas de gestion fine de clipping ici - cote frontend slider 0..100.
    pub fn set_volume(&self, volume: f64) -> Result<(), String> {
        self.mpv
            .set_property("volume", volume.clamp(0.0, 130.0))
            .map_err(err)
    }

    /// Snapshot de l'etat courant. Cache les erreurs en valeurs par defaut pour ne
    /// pas faire echouer les polls cote frontend.
    pub fn state(&self) -> PlayerState {
        PlayerState {
            current_time: self.mpv.get_property::<f64>("time-pos").unwrap_or(0.0),
            duration: self.mpv.get_property::<f64>("duration").unwrap_or(0.0),
            paused: self.mpv.get_property::<bool>("pause").unwrap_or(true),
            eof: self.mpv.get_property::<bool>("eof-reached").unwrap_or(false),
            loaded: self.mpv.get_property::<i64>("playlist-pos").unwrap_or(-1) >= 0,
        }
    }
}

// Note : pas de `impl Drop for NativePlayer`. Le drop par defaut de la struct invoque
// les Drop des champs dans l'ordre de declaration : `mpv` (libmpv2::Mpv::drop appelle
// mpv_terminate_destroy) puis `window` (NativeWindow::drop appelle DestroyWindow).
// C'est exactement l'ordre voulu, et libmpv lache la fenetre proprement avant qu'on
// la detruise.

/// Configure les options communes a toutes les instances libmpv : wid, hwdec, pause initiale,
/// pas d'OSD, keep-open pour eviter la fermeture de la fenetre en fin de fichier, etc.
fn build_mpv(wid: u64, audio: bool) -> Result<Mpv, String> {
    let wid_i64 = wid as i64;
    let mpv = Mpv::with_initializer(|init| {
        // Embed dans la fenetre native fille.
        init.set_property("wid", wid_i64)?;
        // Decodage hardware si dispo (DXVA2/D3D11VA sur Windows, VAAPI sur Linux).
        // "auto-safe" : on demande le HW mais mpv retombe en software si la GPU est
        // trop ancienne ou ne supporte pas le codec. Pas de dur lock-in.
        init.set_property("hwdec", "auto-safe")?;
        // Pas d'on-screen controller mpv : on a notre propre UI dans le comparateur.
        init.set_property("osc", "no")?;
        // Pas de raccourcis clavier pris par mpv (sinon les fleches navigueraient
        // entre groupes via React ET seek-eraient via mpv en meme temps).
        init.set_property("input-default-bindings", "no")?;
        init.set_property("input-vo-keyboard", "no")?;
        // Demarre en pause : le frontend appelle play() apres avoir charge le fichier.
        init.set_property("pause", true)?;
        // En fin de fichier, mpv reste sur la derniere frame au lieu de fermer la
        // fenetre native (qu'on reutilise pour le prochain load).
        init.set_property("keep-open", "yes")?;
        // Pas de listing de playlist en sortie de console.
        init.set_property("idle", "yes")?;
        // Audio : muet pour le player esclave (cf. NativePlayer::create avec audio=false).
        if !audio {
            init.set_property("mute", true)?;
        }
        Ok(())
    })
    .map_err(err)?;
    Ok(mpv)
}

// libmpv accepte les commandes depuis n'importe quel thread (mpv_handle est conçu pour ça).
// La fenetre native est Send+Sync via une impl unsafe (HWND/XID sont des integers stockes,
// et on serialise tous les acces via un Mutex au niveau du registre).
unsafe impl Send for NativePlayer {}
unsafe impl Sync for NativePlayer {}
