//! Registre central des `NativePlayer`. Stocke les instances dans une `Mutex<HashMap>`
//! indexes par un `u64` stable assigne a la creation, et expose des operations
//! "atomiques" sur paires (pour la sync maitre/esclave du comparateur).
//!
//! La factory X11 est creee a la demande (premiere creation) sur Linux : ainsi sur
//! Windows on ne paye pas la connexion X11, et sur Linux Wayland on echoue tot avec
//! un message clair "wayland_unsupported" plutot qu'une erreur cryptique.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use super::platform::{is_wayland_session, ParentHandle};
#[cfg(target_os = "linux")]
use super::platform::NativeWindowFactory;
#[cfg(not(any(target_os = "windows", target_os = "linux")))]
use super::platform::NativeWindow;
use super::player::NativePlayer;
use super::{PlayerState, Rect};

pub struct NativePlayerRegistry {
    next_id: AtomicU64,
    players: Mutex<HashMap<u64, Arc<Mutex<NativePlayer>>>>,
    #[cfg(target_os = "linux")]
    x11_factory: Mutex<Option<NativeWindowFactory>>,
}

impl NativePlayerRegistry {
    pub fn new() -> Self {
        Self {
            next_id: AtomicU64::new(1),
            players: Mutex::new(HashMap::new()),
            #[cfg(target_os = "linux")]
            x11_factory: Mutex::new(None),
        }
    }

    /// Cree un nouveau player et retourne son id. Le frontend garde l'id pour piloter
    /// le player ensuite. `audio=false` permet de muter le player esclave dans le
    /// comparateur cote-a-cote.
    pub fn create(
        &self,
        parent: ParentHandle,
        rect: Rect,
        audio: bool,
    ) -> Result<u64, String> {
        // Wayland : pas d'embedding X11 cross-process, et pas (encore) de support
        // libmpv natif pour la composition Wayland depuis Tauri. On retourne tot.
        if is_wayland_session() {
            return Err("native_player: wayland_unsupported".into());
        }
        let player = self.create_player(parent, rect, audio)?;
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        self.players
            .lock()
            .map_err(|_| "native_player: registry poisonné".to_string())?
            .insert(id, Arc::new(Mutex::new(player)));
        Ok(id)
    }

    #[cfg(target_os = "windows")]
    fn create_player(
        &self,
        parent: ParentHandle,
        rect: Rect,
        audio: bool,
    ) -> Result<NativePlayer, String> {
        NativePlayer::create(parent, rect, audio)
    }

    #[cfg(target_os = "linux")]
    fn create_player(
        &self,
        parent: ParentHandle,
        rect: Rect,
        audio: bool,
    ) -> Result<NativePlayer, String> {
        let mut factory_guard = self
            .x11_factory
            .lock()
            .map_err(|_| "native_player: x11_factory mutex poisonné".to_string())?;
        if factory_guard.is_none() {
            *factory_guard = Some(NativeWindowFactory::new()?);
        }
        let factory = factory_guard.as_ref().unwrap();
        NativePlayer::create(factory, parent, rect, audio)
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    fn create_player(
        &self,
        _parent: ParentHandle,
        _rect: Rect,
        _audio: bool,
    ) -> Result<NativePlayer, String> {
        let _ = NativeWindow::create(_parent, _rect)?;
        Err("native_player: plateforme non supportee".into())
    }

    pub fn destroy(&self, id: u64) {
        if let Ok(mut map) = self.players.lock() {
            map.remove(&id);
        }
    }

    pub fn with<F, R>(&self, id: u64, f: F) -> Result<R, String>
    where
        F: FnOnce(&NativePlayer) -> Result<R, String>,
    {
        let arc = {
            let map = self.players.lock().map_err(|_| "native_player: registry poisonné".to_string())?;
            map.get(&id).cloned().ok_or_else(|| format!("native_player: id {} introuvable", id))?
        };
        let guard = arc.lock().map_err(|_| "native_player: player mutex poisonné".to_string())?;
        f(&guard)
    }

    /// Operation atomique sur deux players (gauche/droite du comparateur). Acquiert
    /// les deux mutex dans un ordre fixe (id ascendant) pour eviter tout deadlock.
    /// Cas particulier : si `left == right`, on n'acquiert qu'un seul Mutex et on
    /// passe la meme reference deux fois au callback (sinon deadlock immediat).
    pub fn with_pair<F, R>(&self, left: u64, right: u64, f: F) -> Result<R, String>
    where
        F: FnOnce(&NativePlayer, &NativePlayer) -> Result<R, String>,
    {
        if left == right {
            return self.with(left, |p| f(p, p));
        }
        let (a, b) = {
            let map = self.players.lock().map_err(|_| "native_player: registry poisonné".to_string())?;
            let a = map.get(&left).cloned().ok_or_else(|| format!("native_player: id {} introuvable", left))?;
            let b = map.get(&right).cloned().ok_or_else(|| format!("native_player: id {} introuvable", right))?;
            (a, b)
        };
        // Lock ordering : id ascendant. Evite un deadlock si un autre thread fait l'inverse.
        let (lo_arc, hi_arc, swapped) = if left < right {
            (a, b, false)
        } else {
            (b, a, true)
        };
        let lo = lo_arc.lock().map_err(|_| "native_player: player mutex poisonné".to_string())?;
        let hi = hi_arc.lock().map_err(|_| "native_player: player mutex poisonné".to_string())?;
        if swapped {
            f(&hi, &lo)
        } else {
            f(&lo, &hi)
        }
    }

    pub fn state(&self, id: u64) -> Result<PlayerState, String> {
        self.with(id, |p| Ok(p.state()))
    }
}

impl Default for NativePlayerRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_genere_des_ids_strictement_croissants() {
        // Ne cree pas de vrais players (ne marche pas en CI sans display) ; verifie
        // juste l'allocation d'id via fetch_add.
        let registry = NativePlayerRegistry::new();
        let a = registry.next_id.fetch_add(1, Ordering::Relaxed);
        let b = registry.next_id.fetch_add(1, Ordering::Relaxed);
        assert!(b > a);
    }

    #[test]
    fn registry_destroy_id_inexistant_ne_panic_pas() {
        let registry = NativePlayerRegistry::new();
        registry.destroy(99999); // ne doit pas paniquer
    }

}
