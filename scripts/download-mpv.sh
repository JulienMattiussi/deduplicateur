#!/usr/bin/env bash
# Telecharge libmpv pour Windows et place le DLL + import lib dans src-tauri/binaries/.
# Sur Linux/macOS : ne fait rien (libmpv-dev / brew install mpv attendus).
#
# Sur Windows, libmpv2-sys (le binding C->Rust de libmpv) doit pouvoir trouver mpv.lib
# et les headers au moment du build. Le runtime a besoin de libmpv-2.dll a cote du .exe.
#
# Source officielle : https://github.com/zhongfly/mpv-winbuild/releases (mpv shared,
# rebuild reguliers). Ces builds incluent libmpv-2.dll et libs/mpv.lib.

set -euo pipefail

# Version mpv winbuild a recuperer. On fixe une release connue stable plutot que
# "latest" pour eviter qu'un changement de mpv casse un build sans preavis.
MPV_BUILD_TAG="2024-12-01"
MPV_BUILD_FILE="mpv-dev-x86_64-20241201-git-b81d8f9.7z"
MPV_BUILD_URL="https://github.com/zhongfly/mpv-winbuild/releases/download/${MPV_BUILD_TAG}/${MPV_BUILD_FILE}"

BINARIES_DIR="$(dirname "$0")/../src-tauri/binaries"
mkdir -p "$BINARIES_DIR"

OS="$(uname -s)"
case "$OS" in
  MINGW*|MSYS*|CYGWIN*|Windows*)
    echo "Telechargement libmpv Windows : ${MPV_BUILD_FILE}"
    TMPDIR="$(mktemp -d)"
    trap 'rm -rf "$TMPDIR"' EXIT
    curl -fsSL "$MPV_BUILD_URL" -o "${TMPDIR}/mpv-dev.7z"
    # 7z utilise le binaire systeme (Git Bash + Windows ont 7z.exe ou via choco install 7zip).
    if command -v 7z >/dev/null 2>&1; then
      7z x -y "-o${TMPDIR}" "${TMPDIR}/mpv-dev.7z" >/dev/null
    elif command -v 7za >/dev/null 2>&1; then
      7za x -y "-o${TMPDIR}" "${TMPDIR}/mpv-dev.7z" >/dev/null
    else
      echo "Erreur : 7z manquant. Installer via 'choco install 7zip' ou 'scoop install 7zip'." >&2
      exit 1
    fi
    # Le contenu de l'archive : libmpv-2.dll + libs/mpv.lib + include/mpv/*.h
    cp -f "${TMPDIR}/libmpv-2.dll" "$BINARIES_DIR/libmpv-2.dll"
    cp -f "${TMPDIR}/libs/mpv.lib" "$BINARIES_DIR/mpv.lib"
    cp -rf "${TMPDIR}/include" "$BINARIES_DIR/mpv-include"
    echo "OK : libmpv-2.dll + mpv.lib + headers extraits dans $BINARIES_DIR"
    echo "Pendant le cargo build, exporter LIBMPV_PATH=$(realpath "$BINARIES_DIR")"
    ;;
  Linux*|Darwin*)
    echo "Pas de telechargement requis sur $OS - installer libmpv via le gestionnaire de paquets :"
    echo "  Linux  : sudo apt-get install libmpv-dev (Debian/Ubuntu)"
    echo "  macOS  : brew install mpv"
    ;;
  *)
    echo "Systeme non supporte : $OS" >&2
    exit 1
    ;;
esac
