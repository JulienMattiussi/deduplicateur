#!/usr/bin/env bash
# Télécharge ffmpeg et ffprobe (builds statiques LGPL BtbN/FFmpeg-Builds)
# et les place dans src-tauri/binaries/ffmpeg-{triple} et ffprobe-{triple}
# Usage : bash scripts/download-ffmpeg.sh
#
# Note macOS : les builds BtbN n'existent pas pour macOS.
# Sur macOS, installer ffmpeg via Homebrew (brew install ffmpeg) et
# copier manuellement ffmpeg/ffprobe dans src-tauri/binaries/.

set -euo pipefail

BINARIES_DIR="$(dirname "$0")/../src-tauri/binaries"
mkdir -p "$BINARIES_DIR"

TARGET_TRIPLE="$(rustc -Vv 2>/dev/null | grep '^host:' | awk '{print $2}')"
if [ -z "$TARGET_TRIPLE" ]; then
  echo "Erreur : rustc introuvable. Installer Rust d'abord." >&2
  exit 1
fi

echo "Target triple : $TARGET_TRIPLE"

OS="$(uname -s)"
case "$OS" in
  Linux*)
    ARCH="$(uname -m)"
    case "$ARCH" in
      x86_64)  FFMPEG_BUILD="ffmpeg-master-latest-linux64-lgpl" ;;
      aarch64) FFMPEG_BUILD="ffmpeg-master-latest-linuxarm64-lgpl" ;;
      *) echo "Architecture Linux non supportée : $ARCH" >&2; exit 1 ;;
    esac
    ARCHIVE="${FFMPEG_BUILD}.tar.xz"
    URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/${ARCHIVE}"
    EXT=""
    ;;
  MINGW*|MSYS*|CYGWIN*|Windows*)
    FFMPEG_BUILD="ffmpeg-master-latest-win64-lgpl"
    ARCHIVE="${FFMPEG_BUILD}.zip"
    URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/${ARCHIVE}"
    EXT=".exe"
    ;;
  Darwin*)
    echo "macOS : BtbN ne fournit pas de builds pour macOS." >&2
    echo "Installer via : brew install ffmpeg" >&2
    echo "Puis copier :" >&2
    echo "  cp \$(which ffmpeg)  ${BINARIES_DIR}/ffmpeg-${TARGET_TRIPLE}" >&2
    echo "  cp \$(which ffprobe) ${BINARIES_DIR}/ffprobe-${TARGET_TRIPLE}" >&2
    exit 1
    ;;
  *)
    echo "Système non supporté : $OS" >&2
    exit 1
    ;;
esac

DEST_FFMPEG="${BINARIES_DIR}/ffmpeg-${TARGET_TRIPLE}${EXT}"
DEST_FFPROBE="${BINARIES_DIR}/ffprobe-${TARGET_TRIPLE}${EXT}"

echo "Téléchargement de $URL ..."
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

curl -fsSL "$URL" -o "$TMP_DIR/$ARCHIVE"

echo "Extraction ..."
if [[ "$ARCHIVE" == *.zip ]]; then
  unzip -q "$TMP_DIR/$ARCHIVE" -d "$TMP_DIR"
  BUILD_DIR="$TMP_DIR/${FFMPEG_BUILD}"
  cp "${BUILD_DIR}/bin/ffmpeg.exe" "$DEST_FFMPEG"
  cp "${BUILD_DIR}/bin/ffprobe.exe" "$DEST_FFPROBE"
else
  tar -xf "$TMP_DIR/$ARCHIVE" -C "$TMP_DIR"
  BUILD_DIR="$TMP_DIR/${FFMPEG_BUILD}"
  cp "${BUILD_DIR}/bin/ffmpeg" "$DEST_FFMPEG"
  cp "${BUILD_DIR}/bin/ffprobe" "$DEST_FFPROBE"
fi

chmod +x "$DEST_FFMPEG" "$DEST_FFPROBE"

echo "ffmpeg  installé dans : $DEST_FFMPEG"
echo "ffprobe installé dans : $DEST_FFPROBE"
