#!/usr/bin/env bash
# Télécharge fpcalc v1.5.1 depuis les releases GitHub acoustid/chromaprint
# et place le binaire dans src-tauri/binaries/fpcalc-{triple}
# Usage : bash scripts/download-fpcalc.sh

set -euo pipefail

VERSION="1.5.1"
BINARIES_DIR="$(dirname "$0")/../src-tauri/binaries"
mkdir -p "$BINARIES_DIR"

# Détecter le target triple Rust
TARGET_TRIPLE="$(rustc -Vv 2>/dev/null | grep '^host:' | awk '{print $2}')"
if [ -z "$TARGET_TRIPLE" ]; then
  echo "Erreur : rustc introuvable. Installer Rust d'abord." >&2
  exit 1
fi

echo "Target triple : $TARGET_TRIPLE"

# Déterminer la plateforme et l'archive à télécharger
OS="$(uname -s)"
case "$OS" in
  Linux*)
    ARCHIVE="chromaprint-fpcalc-${VERSION}-linux-x86_64.tar.gz"
    FPCALC_IN_ARCHIVE="chromaprint-fpcalc-${VERSION}-linux-x86_64/fpcalc"
    EXT=""
    ;;
  Darwin*)
    ARCHIVE="chromaprint-fpcalc-${VERSION}-macos-x86_64.tar.gz"
    FPCALC_IN_ARCHIVE="chromaprint-fpcalc-${VERSION}-macos-x86_64/fpcalc"
    EXT=""
    ;;
  MINGW*|MSYS*|CYGWIN*|Windows*)
    ARCHIVE="chromaprint-fpcalc-${VERSION}-windows-x86_64.zip"
    FPCALC_IN_ARCHIVE="chromaprint-fpcalc-${VERSION}-windows-x86_64/fpcalc.exe"
    EXT=".exe"
    ;;
  *)
    echo "Système non supporté : $OS" >&2
    exit 1
    ;;
esac

DEST="${BINARIES_DIR}/fpcalc-${TARGET_TRIPLE}${EXT}"
URL="https://github.com/acoustid/chromaprint/releases/download/v${VERSION}/${ARCHIVE}"

echo "Téléchargement de $URL ..."
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

curl -fsSL "$URL" -o "$TMP_DIR/$ARCHIVE"

echo "Extraction ..."
if [[ "$ARCHIVE" == *.zip ]]; then
  unzip -q "$TMP_DIR/$ARCHIVE" "$FPCALC_IN_ARCHIVE" -d "$TMP_DIR"
else
  tar -xzf "$TMP_DIR/$ARCHIVE" -C "$TMP_DIR" "$FPCALC_IN_ARCHIVE"
fi

cp "$TMP_DIR/$FPCALC_IN_ARCHIVE" "$DEST"
chmod +x "$DEST"

echo "fpcalc installé dans : $DEST"
