//! Couche d'abstraction plateforme pour creer une fenetre native fille de la fenetre
//! Tauri principale, qui accueillera le rendu libmpv via la propriete `wid`.
//!
//! Expose `NativeWindow` avec une API uniforme :
//! - `create(parent_handle, rect)` : cree une fenetre fille a la geometrie donnee
//! - `id()` : retourne le handle natif (HWND ou XID) sous forme `u64` pour libmpv
//! - `set_geometry(rect)` : repositionne / redimensionne
//! - `set_visible(bool)` : show / hide
//! - `Drop` : destruction propre
//!
//! Plateformes :
//! - Windows : Win32 `CreateWindowExW` + `SetWindowPos` + `DestroyWindow`
//! - Linux X11 : x11rb `create_window` + `configure_window` + `destroy_window`
//! - Linux Wayland / macOS : `create()` retourne une erreur, l'UI doit retomber
//!   sur le placeholder.

use super::Rect;

#[derive(Debug, Clone, Copy)]
pub enum ParentHandle {
    Win32(u64),
    Xlib(u64),
    Xcb(u64),
    Unsupported,
}

impl ParentHandle {
    /// Resout le handle natif d'une `tauri::Window` via raw-window-handle.
    pub fn from_tauri(window: &tauri::Window) -> Self {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};
        let Ok(handle) = window.window_handle() else {
            return ParentHandle::Unsupported;
        };
        match handle.as_raw() {
            RawWindowHandle::Win32(h) => ParentHandle::Win32(h.hwnd.get() as u64),
            // h.window est `c_ulong` : u64 sur Linux 64 bits, u32 sur Windows. On caste
            // explicitement pour eviter une erreur de compile cross-platform.
            RawWindowHandle::Xlib(h) => ParentHandle::Xlib(h.window as u64),
            RawWindowHandle::Xcb(h) => ParentHandle::Xcb(h.window.get() as u64),
            _ => ParentHandle::Unsupported,
        }
    }
}

#[cfg(target_os = "windows")]
mod imp {
    use super::*;
    use std::sync::OnceLock;
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, RegisterClassExW, SetWindowPos, ShowWindow,
        HWND_TOP, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOREDRAW, SWP_NOSIZE, SWP_NOZORDER, SW_HIDE,
        SW_SHOWNOACTIVATE, WNDCLASSEXW, WS_CHILD, WS_CLIPCHILDREN, WS_CLIPSIBLINGS,
        WS_EX_NOPARENTNOTIFY, WS_VISIBLE,
    };

    static CLASS_REGISTERED: OnceLock<()> = OnceLock::new();
    const CLASS_NAME: PCWSTR = w!("DeduplicateurNativePlayer");

    unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, w: WPARAM, l: LPARAM) -> LRESULT {
        DefWindowProcW(hwnd, msg, w, l)
    }

    fn ensure_class_registered() -> Result<(), String> {
        // OnceLock garantit que l'enregistrement n'est fait qu'une fois ; les enregistrements
        // multiples avec le meme nom retournent un succes idempotent mais autant l'eviter.
        if CLASS_REGISTERED.get().is_some() {
            return Ok(());
        }
        unsafe {
            let cls = WNDCLASSEXW {
                cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                lpfnWndProc: Some(wndproc),
                hInstance: HINSTANCE::default(),
                lpszClassName: CLASS_NAME,
                ..Default::default()
            };
            // RegisterClassExW retourne 0 en cas d'echec sauf "already registered" (ERROR_CLASS_ALREADY_EXISTS).
            // On accepte les deux scenarios.
            let atom = RegisterClassExW(&cls);
            if atom == 0 {
                let err = windows::Win32::Foundation::GetLastError();
                if err.0 != 1410 /* ERROR_CLASS_ALREADY_EXISTS */ {
                    return Err(format!("RegisterClassExW failed: {:?}", err));
                }
            }
        }
        let _ = CLASS_REGISTERED.set(());
        Ok(())
    }

    pub struct NativeWindow {
        hwnd: HWND,
    }

    impl NativeWindow {
        pub fn create(parent: ParentHandle, rect: Rect) -> Result<Self, String> {
            let parent_hwnd = match parent {
                ParentHandle::Win32(h) => HWND(h as *mut _),
                _ => return Err("native_player: parent non-Win32 sur Windows".into()),
            };
            ensure_class_registered()?;
            // windows 0.59 : CreateWindowExW retourne Result<HWND, Error> et accepte
            // Option<HWND>/Option<HMENU>/Option<HINSTANCE> pour parent/menu/instance.
            let hwnd = unsafe {
                CreateWindowExW(
                    WS_EX_NOPARENTNOTIFY,
                    CLASS_NAME,
                    PCWSTR::null(),
                    WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN | WS_CLIPSIBLINGS,
                    rect.x,
                    rect.y,
                    rect.width as i32,
                    rect.height as i32,
                    Some(parent_hwnd),
                    None,
                    None,
                    None,
                )
            }
            .map_err(|e| format!("CreateWindowExW failed: {:?}", e))?;
            if hwnd.0.is_null() {
                let err = unsafe { windows::Win32::Foundation::GetLastError() };
                return Err(format!("CreateWindowExW returned null: {:?}", err));
            }
            // Force la fenetre en haut du z-order des siblings (au-dessus de la
            // WebView2 qui utilise du compositing DComposition). Safe car cet appel se
            // fait sur le thread principal (les commandes Tauri dispatchent vers
            // run_on_main_thread, cf. commands/native_player.rs).
            unsafe {
                let _ = SetWindowPos(
                    hwnd,
                    Some(HWND_TOP),
                    0, 0, 0, 0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                );
            }
            Ok(Self { hwnd })
        }

        pub fn id(&self) -> u64 {
            self.hwnd.0 as u64
        }

        pub fn set_geometry(&self, rect: Rect) -> Result<(), String> {
            unsafe {
                // SWP_NOZORDER : on ne touche pas au z-order ; SWP_NOACTIVATE : pas
                // de focus arraché ; SWP_NOREDRAW : on laisse mpv invalider sa surface.
                // windows 0.59 : hwndinsertafter prend Option<HWND>, on passe Some(HWND_TOP).
                SetWindowPos(
                    self.hwnd,
                    Some(HWND_TOP),
                    rect.x,
                    rect.y,
                    rect.width as i32,
                    rect.height as i32,
                    SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOREDRAW,
                )
                .map_err(|e| format!("SetWindowPos failed: {:?}", e))
            }
        }

        pub fn set_visible(&self, visible: bool) -> Result<(), String> {
            unsafe {
                let _ = ShowWindow(self.hwnd, if visible { SW_SHOWNOACTIVATE } else { SW_HIDE });
            }
            Ok(())
        }
    }

    impl Drop for NativeWindow {
        fn drop(&mut self) {
            // DestroyWindow doit etre appele depuis le thread qui a cree la fenetre.
            // En pratique on cree la fenetre depuis la commande Tauri (thread principal
            // GTK / message loop Win32) et on la detruit egalement depuis ce thread via
            // un drop sur le main_thread (cf. NativePlayerRegistry).
            unsafe {
                let _ = DestroyWindow(self.hwnd);
            }
        }
    }

    // Win32 HWND est un pointeur, pas Send/Sync par defaut. On l'enveloppe dans un Mutex
    // cote registre, et toutes les operations passent par le thread principal Tauri via
    // run_on_main_thread, donc il est safe de marquer Send+Sync explicitement.
    unsafe impl Send for NativeWindow {}
    unsafe impl Sync for NativeWindow {}
}

#[cfg(target_os = "linux")]
mod imp {
    use super::*;
    use x11rb::connection::Connection;
    use x11rb::protocol::xproto::{
        ConfigureWindowAux, ConnectionExt, CreateWindowAux, EventMask, WindowClass,
    };
    use x11rb::rust_connection::RustConnection;

    /// Connexion X11 partagee par tous les NativeWindow. On ouvre une seule connexion
    /// au demarrage du registre et on l'utilise pour creer / configurer / detruire.
    pub struct X11Conn {
        conn: RustConnection,
        screen_num: usize,
    }

    impl X11Conn {
        pub fn new() -> Result<Self, String> {
            // x11rb::connect lit DISPLAY depuis l'env. En mode Wayland (Xwayland present),
            // ca peut tomber sur un display X11 transitoire qui n'a pas la meme racine
            // que la WebView - dans ce cas la creation echouera plus loin avec un BadWindow,
            // ce qui est le bon signal a remonter au frontend.
            let (conn, screen_num) = x11rb::connect(None)
                .map_err(|e| format!("x11rb::connect failed: {:?}", e))?;
            Ok(Self { conn, screen_num })
        }
    }

    pub struct NativeWindow {
        conn: std::sync::Arc<X11Conn>,
        wid: u32,
    }

    impl NativeWindow {
        pub fn create_with(
            conn: std::sync::Arc<X11Conn>,
            parent: ParentHandle,
            rect: Rect,
        ) -> Result<Self, String> {
            let parent_xid = match parent {
                ParentHandle::Xlib(h) => h as u32,
                ParentHandle::Xcb(h) => h as u32,
                _ => return Err("native_player: parent non-X11 sur Linux".into()),
            };
            let wid = conn
                .conn
                .generate_id()
                .map_err(|e| format!("x11 generate_id failed: {:?}", e))?;
            let screen = &conn.conn.setup().roots[conn.screen_num];
            let aux = CreateWindowAux::new()
                .background_pixel(screen.black_pixel)
                .event_mask(EventMask::EXPOSURE);
            conn.conn
                .create_window(
                    x11rb::COPY_FROM_PARENT as u8,
                    wid,
                    parent_xid,
                    rect.x as i16,
                    rect.y as i16,
                    rect.width as u16,
                    rect.height as u16,
                    0,
                    WindowClass::INPUT_OUTPUT,
                    x11rb::COPY_FROM_PARENT,
                    &aux,
                )
                .map_err(|e| format!("x11 create_window failed: {:?}", e))?;
            conn.conn
                .map_window(wid)
                .map_err(|e| format!("x11 map_window failed: {:?}", e))?;
            conn.conn
                .flush()
                .map_err(|e| format!("x11 flush failed: {:?}", e))?;
            Ok(Self { conn, wid })
        }

        pub fn id(&self) -> u64 {
            self.wid as u64
        }

        pub fn set_geometry(&self, rect: Rect) -> Result<(), String> {
            let aux = ConfigureWindowAux::new()
                .x(rect.x)
                .y(rect.y)
                .width(rect.width)
                .height(rect.height);
            self.conn
                .conn
                .configure_window(self.wid, &aux)
                .map_err(|e| format!("x11 configure_window failed: {:?}", e))?;
            self.conn
                .conn
                .flush()
                .map_err(|e| format!("x11 flush failed: {:?}", e))?;
            Ok(())
        }

        pub fn set_visible(&self, visible: bool) -> Result<(), String> {
            if visible {
                self.conn
                    .conn
                    .map_window(self.wid)
                    .map_err(|e| format!("x11 map_window failed: {:?}", e))?;
            } else {
                self.conn
                    .conn
                    .unmap_window(self.wid)
                    .map_err(|e| format!("x11 unmap_window failed: {:?}", e))?;
            }
            self.conn
                .conn
                .flush()
                .map_err(|e| format!("x11 flush failed: {:?}", e))?;
            Ok(())
        }
    }

    impl Drop for NativeWindow {
        fn drop(&mut self) {
            let _ = self.conn.conn.destroy_window(self.wid);
            let _ = self.conn.conn.flush();
        }
    }

    pub struct NativeWindowFactory {
        conn: std::sync::Arc<X11Conn>,
    }

    impl NativeWindowFactory {
        pub fn new() -> Result<Self, String> {
            Ok(Self {
                conn: std::sync::Arc::new(X11Conn::new()?),
            })
        }

        pub fn create(&self, parent: ParentHandle, rect: Rect) -> Result<NativeWindow, String> {
            NativeWindow::create_with(self.conn.clone(), parent, rect)
        }
    }
}

#[cfg(target_os = "windows")]
pub use imp::NativeWindow;

#[cfg(target_os = "linux")]
pub use imp::{NativeWindow, NativeWindowFactory};

/// Plateformes non supportees (macOS pour l'instant). Wayland est detecte runtime
/// dans `NativeWindow::create` via l'echec de connexion X11.
#[cfg(not(any(target_os = "windows", target_os = "linux")))]
pub mod imp {
    use super::*;

    pub struct NativeWindow;

    impl NativeWindow {
        pub fn create(_parent: ParentHandle, _rect: Rect) -> Result<Self, String> {
            Err("native_player: plateforme non supportee".into())
        }
        pub fn id(&self) -> u64 {
            0
        }
        pub fn set_geometry(&self, _rect: Rect) -> Result<(), String> {
            Ok(())
        }
        pub fn set_visible(&self, _visible: bool) -> Result<(), String> {
            Ok(())
        }
    }
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
pub use imp::NativeWindow;

/// Detecte si on tourne sous Wayland (variable d'env) - utilise pour choisir entre
/// Xlib/Xcb et un retour d'erreur explicite cote `create`.
#[cfg(target_os = "linux")]
pub fn is_wayland_session() -> bool {
    std::env::var("WAYLAND_DISPLAY").is_ok()
        || std::env::var("XDG_SESSION_TYPE")
            .map(|v| v.eq_ignore_ascii_case("wayland"))
            .unwrap_or(false)
}

#[cfg(not(target_os = "linux"))]
pub fn is_wayland_session() -> bool {
    false
}
