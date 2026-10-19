#!/usr/bin/env bash

# Exit immediately if a command exits with a non-zero status
set -e

# Tiling Shell GNOME Extension UUID
UUID="tilingshell@ferrarodomenico.com"
EXT_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ANSI color codes for pretty output
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
NC="\033[0m" # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

show_usage() {
    echo "Usage: $0 {install-rc|install-stable|status|uninstall}"
    echo
    echo "Commands:"
    echo "  install-rc [tag]   Switch to the latest release candidate tag (or a specific tag/branch if provided)"
    echo "  install-stable     Switch to the official stable version from extensions.gnome.org"
    echo "  status             Check currently installed extension version and state"
    echo "  uninstall          Remove the installed extension (with backup)"
}

check_dependencies() {
    for cmd in git npm gnome-shell unzip curl python3; do
        if ! command -v "$cmd" &> /dev/null; then
            log_error "Dependency '$cmd' is missing. Please install it first."
            exit 1
        fi
    done
}

backup_extension() {
    if [ -d "$EXT_DIR" ]; then
        BACKUP_PATH="${EXT_DIR}.bak-$(date +%Y%m%d%H%M%S)"
        log_info "Backing up current extension to $BACKUP_PATH"
        mv "$EXT_DIR" "$BACKUP_PATH"
    fi
}

reload_instructions() {
    echo
    log_info "=========================================================="
    log_info "Installation / update completed successfully!"
    log_info "To apply the changes, you must reload GNOME Shell:"
    log_info "  - If on X11: Press Alt+F2, type 'r', and press Enter."
    log_info "  - If on Wayland: Log out of your session and log back in."
    log_info "=========================================================="
}

install_rc() {
    check_dependencies
    cd "$REPO_DIR"

    # Make sure we have latest tags
    log_info "Fetching latest tags from GitHub..."
    git fetch --tags

    # Determine tag/branch to install
    TARGET_TAG="$1"
    if [ -z "$TARGET_TAG" ]; then
        # Find the latest tag containing "candidate"
        TARGET_TAG=$(git tag -l "*candidate*" | sort -V | tail -n1)
        if [ -z "$TARGET_TAG" ]; then
            log_error "No release candidate tags found. Please specify a tag or branch manually."
            exit 1
        fi
        log_info "Auto-detected latest release candidate tag: $TARGET_TAG"
    else
        log_info "Using user-specified tag/branch: $TARGET_TAG"
    fi

    log_info "Checking out $TARGET_TAG..."
    git checkout "$TARGET_TAG"

    log_info "Installing npm dependencies..."
    npm install

    log_info "Building the extension..."
    npm run build

    # Backup existing installation
    backup_extension

    log_info "Installing the release candidate extension..."
    npm run install:extension

    reload_instructions
}

install_stable() {
    check_dependencies

    log_info "Detecting GNOME Shell version..."
    GNOME_VER=$(gnome-shell --version | grep -o -E '[0-9]+' | head -n 1)
    log_info "GNOME Shell version: $GNOME_VER"

    log_info "Querying extensions.gnome.org API for stable download URL..."
    DOWNLOAD_URL=$(python3 -c '
import urllib.request, json, sys
try:
    url = f"https://extensions.gnome.org/extension-info/?uuid=tilingshell@ferrarodomenico.com&shell_version={sys.argv[1]}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req) as res:
        data = json.loads(res.read().decode())
        print("https://extensions.gnome.org" + data["download_url"])
except Exception as e:
    print(f"ERROR: {e}", file=sys.stderr)
    sys.exit(1)
' "$GNOME_VER")

    if [ -z "$DOWNLOAD_URL" ] || [[ ! "$DOWNLOAD_URL" =~ ^https:// ]]; then
        log_error "Failed to retrieve a valid download URL from the GNOME extensions API."
        exit 1
    fi

    log_info "Downloading stable zip from: $DOWNLOAD_URL"
    TMP_ZIP=$(mktemp /tmp/tilingshell-XXXXXX.zip)
    curl -sL "$DOWNLOAD_URL" -o "$TMP_ZIP"

    backup_extension

    log_info "Extracting stable version to $EXT_DIR..."
    mkdir -p "$EXT_DIR"
    unzip -q -o "$TMP_ZIP" -d "$EXT_DIR"
    rm -f "$TMP_ZIP"

    reload_instructions
}

show_status() {
    if [ -d "$EXT_DIR" ]; then
        log_info "Extension is installed at $EXT_DIR"
        echo "--------------------------------------------------"
        gnome-extensions info "$UUID" || true
        echo "--------------------------------------------------"
    else
        log_warn "Tiling Shell is not currently installed in $EXT_DIR"
    fi
}

uninstall_extension() {
    if [ -d "$EXT_DIR" ]; then
        backup_extension
        log_info "Tiling Shell has been uninstalled."
    else
        log_warn "Tiling Shell is not currently installed."
    fi
}

# Main command router
COMMAND="$1"
shift || true

case "$COMMAND" in
    install-rc)
        install_rc "$@"
        ;;
    install-stable)
        install_stable
        ;;
    status)
        show_status
        ;;
    uninstall)
        uninstall_extension
        ;;
    *)
        show_usage
        exit 1
        ;;
esac
