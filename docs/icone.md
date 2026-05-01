# Icone de l'application

## Fichiers d'icone

```
src-tauri/icons/
  32x32.png          # Icone 32x32 RGBA (barre de titre, petits contextes)
  128x128.png        # Icone 128x128 RGBA (taskbar, apercu)
  128x128@2x.png     # Icone 256x256 RGBA (ecrans Retina)
  icon.png           # Icone 512x512 RGBA (source haute resolution)
  icon.ico           # Icone Windows 16x16 (embarquee dans le .exe)
```

Toutes les images doivent etre en mode RGBA (pas RGB, pas indexed). Generer avec Pillow :
```python
from PIL import Image
src = Image.open("source.jpeg").convert("RGBA")
src.resize((128, 128), Image.LANCZOS).save("src-tauri/icons/128x128.png")
```

Le fichier `icon.icns` (macOS) n'est PAS inclus et ne doit PAS etre reference dans
`tauri.conf.json` - s'il est absent, la build echoue avec une erreur de build script.

## Icone dans le binaire (fonctionne partout)

`lib.rs` embarque `128x128.png` a la compilation et l'injecte via le hook `setup` :
```rust
.setup(|app| {
    if let Some(window) = app.get_webview_window("main") {
        let icon_bytes = include_bytes!("../icons/128x128.png");
        if let Ok(icon) = tauri::image::Image::from_bytes(icon_bytes) {
            let _ = window.set_icon(icon);
        }
    }
    Ok(())
})
```

Require la feature `image-png` dans `Cargo.toml` :
```toml
tauri = { version = "2", features = ["image-png"] }
```

## Comportement selon la plateforme

| Plateforme | Barre de titre | Barre des taches | Source |
|------------|---------------|------------------|--------|
| Windows    | `icon.ico` embarque dans le .exe | idem | Tauri bundle |
| Linux packaged (.deb) | `set_icon` | fichier `.desktop` installe par Tauri | Tauri bundle |
| Linux dev mode (GNOME) | pas affiche (CSD sans icone) | non affiche sans setup manuel | voir ci-dessous |
| Linux dev mode (KDE/XFCE/X11) | `set_icon` | `_NET_WM_ICON` via `set_icon` | `setup` hook |

## Setup icone en dev mode Linux (GNOME/Wayland)

GNOME Shell ignore `_NET_WM_ICON` et utilise le fichier `.desktop` pour associer
une fenetre a son icone. En mode dev, aucun `.desktop` n'est installe.

A faire une seule fois apres avoir clone le repo :

```bash
# 1. Installer l'icone dans le theme
mkdir -p ~/.local/share/icons/hicolor/128x128/apps
cp src-tauri/icons/128x128.png \
   ~/.local/share/icons/hicolor/128x128/apps/com.yavadeus.deduplicateur.png

# 2. Creer le fichier .desktop pointant vers le binaire de dev
cat > ~/.local/share/applications/deduplicateur-dev.desktop << 'EOF'
[Desktop Entry]
Name=Deduplicateur (dev)
Exec=/chemin/vers/deduplicateur/src-tauri/target/debug/deduplicateur
Icon=com.yavadeus.deduplicateur
Type=Application
StartupWMClass=deduplicateur
EOF

# 3. Mettre a jour la base de donnees
update-desktop-database ~/.local/share/applications
```

`StartupWMClass` doit correspondre exactement au WM_CLASS du binaire.
Pour le verifier : `xprop WM_CLASS` puis cliquer sur la fenetre de l'app.
