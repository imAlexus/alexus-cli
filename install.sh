#!/usr/bin/env sh
set -eu

REPOSITORY="imAlexus/alexus-cli"
MINIMUM_NODE_MAJOR=22
REQUESTED_VERSION="${1:-latest}"

step() {
  printf '\n==> %s\n' "$1"
}

for command in curl node npm; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'Error: %s is not installed or is not in PATH.\n' "$command" >&2
    exit 1
  fi
done

NODE_VERSION="$(node --version | sed 's/^v//')"
NODE_MAJOR="${NODE_VERSION%%.*}"
if [ "$NODE_MAJOR" -lt "$MINIMUM_NODE_MAJOR" ]; then
  printf 'Error: Node.js %s is not supported. Install Node.js 22 or newer.\n' "$NODE_VERSION" >&2
  exit 1
fi

if [ "$REQUESTED_VERSION" = "latest" ]; then
  step "Fetching the latest Alexus release"
  TAG="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'User-Agent: Alexus-Installer' "https://api.github.com/repos/$REPOSITORY/releases/latest" | sed -n 's/.*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
else
  case "$REQUESTED_VERSION" in
    v*) TAG="$REQUESTED_VERSION" ;;
    *) TAG="v$REQUESTED_VERSION" ;;
  esac
fi

if [ -z "${TAG:-}" ]; then
  printf 'Error: unable to determine which release to install.\n' >&2
  exit 1
fi

VERSION="${TAG#v}"
PACKAGE="alexus-cli-$VERSION.tgz"
BASE_URL="https://github.com/$REPOSITORY/releases/download/$TAG"
TEMP_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t alexus-install)"
trap 'rm -rf "$TEMP_DIR"' EXIT INT TERM

step "Downloading Alexus $VERSION"
curl -fsSL "$BASE_URL/$PACKAGE" -o "$TEMP_DIR/$PACKAGE"
curl -fsSL "$BASE_URL/$PACKAGE.sha256" -o "$TEMP_DIR/$PACKAGE.sha256"

step "Verifying the SHA-256 checksum"
EXPECTED="$(sed -n '1s/[[:space:]].*//p' "$TEMP_DIR/$PACKAGE.sha256")"
if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL="$(sha256sum "$TEMP_DIR/$PACKAGE" | sed 's/[[:space:]].*//')"
elif command -v shasum >/dev/null 2>&1; then
  ACTUAL="$(shasum -a 256 "$TEMP_DIR/$PACKAGE" | sed 's/[[:space:]].*//')"
else
  printf 'Error: sha256sum or shasum is required to verify the download.\n' >&2
  exit 1
fi
if [ "$EXPECTED" != "$ACTUAL" ]; then
  printf 'Error: invalid SHA-256 checksum. Download aborted.\n' >&2
  exit 1
fi

PREFIX="$(npm prefix --global)"
if [ -d "$PREFIX" ] && [ -w "$PREFIX" ]; then
  step "Installing globally through npm"
  npm install --global "$TEMP_DIR/$PACKAGE" --omit=dev
else
  PREFIX="${HOME:?}/.local"
  step "Installing for the current user in $PREFIX"
  npm install --global --prefix "$PREFIX" "$TEMP_DIR/$PACKAGE" --omit=dev
fi

COMMAND="$PREFIX/bin/alexus"
if [ ! -x "$COMMAND" ]; then
  printf 'Installation completed, but alexus was not found in %s/bin.\n' "$PREFIX" >&2
  printf 'Add %s/bin to PATH and try again.\n' "$PREFIX" >&2
  exit 1
fi

INSTALLED_VERSION="$($COMMAND --version)"
case ":$PATH:" in
  *":$PREFIX/bin:"*) ;;
  *)
    PROFILE="${HOME:?}/.profile"
    case "${SHELL:-}" in
      */zsh) PROFILE="$HOME/.zshrc" ;;
      */bash) PROFILE="$HOME/.bashrc" ;;
    esac
    PATH_LINE="export PATH=\"$PREFIX/bin:\$PATH\""
    if [ ! -f "$PROFILE" ] || ! grep -F "$PREFIX/bin" "$PROFILE" >/dev/null 2>&1; then
      printf '\n%s\n' "$PATH_LINE" >> "$PROFILE"
    fi
    printf 'Added %s/bin to %s. Open a new terminal to refresh PATH.\n' "$PREFIX" "$PROFILE"
    ;;
esac
printf '\nAlexus CLI %s installed successfully.\n' "$INSTALLED_VERSION"
printf 'Configure OPENROUTER_API_KEY, then run: alexus init\n'
