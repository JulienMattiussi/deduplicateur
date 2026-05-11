#!/usr/bin/env bash
# Telecharge libmpv pour Windows et place le DLL + import lib dans src-tauri/binaries/.
# Sur Linux/macOS : ne fait rien (libmpv-dev / brew install mpv attendus).
#
# Sur Windows, libmpv2-sys (le binding C->Rust de libmpv) doit pouvoir trouver mpv.lib
# et les headers au moment du build. Le runtime a besoin de libmpv-2.dll a cote du .exe.
#
# Source : https://github.com/zhongfly/mpv-winbuild/releases (mpv shared, rebuilds
# quotidiens). Le repo ne garde que ~30 dernieres builds donc on resout a chaque
# fois la derniere release "lgpl" (LGPL = redistribuable sans contraintes copyleft
# fortes, suffisant pour notre cas d'usage : decode video/audio).

set -euo pipefail

REPO="zhongfly/mpv-winbuild"
ASSET_PREFIX="mpv-dev-lgpl-x86_64-"
ASSET_EXCLUDE="-v3-"   # variante x86_64-v3 = optimisations CPU recents, on prend le build standard

BINARIES_DIR="$(dirname "$0")/../src-tauri/binaries"
mkdir -p "$BINARIES_DIR"

OS="$(uname -s)"
case "$OS" in
  MINGW*|MSYS*|CYGWIN*|Windows*)
    echo "Resolution de la derniere release ${REPO} (${ASSET_PREFIX}*)..."
    # GITHUB_TOKEN passe par un fichier d'en-tete pour eviter de le voir leak dans
    # `set -x` ou les logs CI.
    HEADER_ARGS=(-fsSL)
    if [ -n "${GITHUB_TOKEN:-}" ]; then
      HEADER_ARGS+=(-H "Authorization: token ${GITHUB_TOKEN}")
    fi
    # python3 sur Linux/macOS et les actions runners, python sur Git Bash Windows. On detecte.
    if command -v python3 >/dev/null 2>&1; then
      PY=python3
    elif command -v python >/dev/null 2>&1; then
      PY=python
    else
      echo "Erreur : python3 ou python manquant (necessaire pour parser JSON)." >&2
      exit 1
    fi
    # Cherche la 1ere release qui contient un asset mpv-dev-lgpl-x86_64-*.7z (sans variante v3).
    DOWNLOAD_URL=$(curl "${HEADER_ARGS[@]}" "https://api.github.com/repos/${REPO}/releases?per_page=10" | $PY -c "
import sys, json
data = json.load(sys.stdin)
for release in data:
    for asset in release.get('assets', []):
        name = asset['name']
        if name.startswith('${ASSET_PREFIX}') and '${ASSET_EXCLUDE}' not in name and name.endswith('.7z'):
            print(asset['browser_download_url'])
            sys.exit(0)
sys.exit(1)
")
    if [ -z "$DOWNLOAD_URL" ]; then
      echo "Erreur : aucune asset ${ASSET_PREFIX}*.7z trouvee dans les releases ${REPO}" >&2
      exit 1
    fi
    ARCHIVE_NAME="$(basename "$DOWNLOAD_URL")"
    echo "Telechargement : ${ARCHIVE_NAME}"
    TMPDIR="$(mktemp -d)"
    trap 'rm -rf "$TMPDIR"' EXIT
    curl -fsSL "$DOWNLOAD_URL" -o "${TMPDIR}/mpv-dev.7z"

    # 7z disponible sur les runners Windows GitHub Actions (pre-installe).
    if command -v 7z >/dev/null 2>&1; then
      7z x -y "-o${TMPDIR}/extract" "${TMPDIR}/mpv-dev.7z" >/dev/null
    elif command -v 7za >/dev/null 2>&1; then
      7za x -y "-o${TMPDIR}/extract" "${TMPDIR}/mpv-dev.7z" >/dev/null
    else
      echo "Erreur : 7z manquant. Installer via 'choco install 7zip' ou 'scoop install 7zip'." >&2
      exit 1
    fi

    # Structure typique d'une release mpv-dev (zhongfly/mpv-winbuild) :
    #   libmpv-2.dll       (DLL runtime)
    #   libmpv.dll.a       (import lib format MinGW = COFF archive)
    #   include/mpv/*.h    (headers)
    # Le linker MSVC veut "mpv.lib" mais accepte le .dll.a (format COFF compatible).
    # On le copie sous le nom mpv.lib pour que libmpv2-sys (qui emet -lmpv) le trouve.
    cp -f "${TMPDIR}/extract/libmpv-2.dll" "$BINARIES_DIR/libmpv-2.dll"

    LIB_FOUND=""
    # Priorite : mpv.lib (MSVC natif si jamais une release l'inclut), puis fallback
    # libmpv.dll.a renomme.
    if [ -f "${TMPDIR}/extract/mpv.lib" ]; then
      cp -f "${TMPDIR}/extract/mpv.lib" "$BINARIES_DIR/mpv.lib"
      LIB_FOUND="mpv.lib (natif MSVC)"
    elif [ -f "${TMPDIR}/extract/libmpv.dll.a" ]; then
      cp -f "${TMPDIR}/extract/libmpv.dll.a" "$BINARIES_DIR/mpv.lib"
      LIB_FOUND="libmpv.dll.a renomme en mpv.lib (MinGW COFF, accepte par link.exe recent)"
    elif [ -f "${TMPDIR}/extract/libmpv-2.dll.a" ]; then
      cp -f "${TMPDIR}/extract/libmpv-2.dll.a" "$BINARIES_DIR/mpv.lib"
      LIB_FOUND="libmpv-2.dll.a renomme en mpv.lib"
    fi
    if [ -z "$LIB_FOUND" ]; then
      echo "Erreur : aucune import lib (mpv.lib, libmpv.dll.a, libmpv-2.dll.a) trouvee dans l'archive." >&2
      ls -la "${TMPDIR}/extract/" >&2
      exit 1
    fi
    echo "Import lib : ${LIB_FOUND}"

    # Headers : sous include/mpv/. libmpv2-sys cherche via pkg-config ou via LIBMPV_PATH
    # qui doit pointer sur un dossier contenant include/mpv/*.h et l'import lib.
    if [ -d "${TMPDIR}/extract/include" ]; then
      rm -rf "$BINARIES_DIR/mpv-include"
      cp -rf "${TMPDIR}/extract/include" "$BINARIES_DIR/mpv-include"
      echo "Headers : copies dans $BINARIES_DIR/mpv-include"
    else
      echo "Avertissement : dossier include/ absent dans l'archive." >&2
    fi

    echo "OK : ${BINARIES_DIR}/libmpv-2.dll extrait."
    # realpath n'existe pas toujours en Git Bash Windows ; readlink -f peut etre absent.
    # On utilise cd && pwd qui est universellement disponible.
    ABS_BINARIES_DIR="$(cd "$BINARIES_DIR" && pwd)"
    echo "Pour cargo build : exporter LIBMPV_PATH=${ABS_BINARIES_DIR}"
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
