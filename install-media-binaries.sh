#!/usr/bin/env bash
#
# Installs the Linux yt-dlp + ffmpeg binaries this app needs.
# Run this ONCE on the server (e.g. Hostinger via SSH), from the project root:
#
#     bash install-media-binaries.sh
#
set -e

BIN_DIR="$(cd "$(dirname "$0")" && pwd)/storage/app/bin"
mkdir -p "$BIN_DIR"
cd "$BIN_DIR"

echo "==> Installing into: $BIN_DIR"

# ---- yt-dlp (standalone Linux build, bundles its own Python) ----
echo "==> Downloading yt-dlp..."
curl -L --fail -o yt-dlp \
    https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux
chmod +x yt-dlp

# ---- youtube-dl (ytdl-org) — preferred engine for YouTube links ----
# The NIGHTLY build is required: the last stable release (2021.12.17) can no
# longer parse YouTube pages ("The page needs to be reloaded" error).
# Requires a system python3 on the server; skipped gracefully if the
# download fails so the app still works with yt-dlp alone.
echo "==> Downloading youtube-dl (nightly)..."
if curl -L --fail -o youtube-dl \
    https://github.com/ytdl-org/ytdl-nightly/releases/latest/download/youtube-dl; then
    chmod +x youtube-dl
else
    echo "WARNING: youtube-dl download failed; YouTube links will use yt-dlp only."
    rm -f youtube-dl
fi

# ---- ffmpeg + ffprobe (static Linux build, needed for MP3 + MP4 merge) ----
echo "==> Downloading ffmpeg (static build)..."
curl -L --fail -o ffmpeg.tar.xz \
    https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz
tar xf ffmpeg.tar.xz
FF_DIR="$(find . -maxdepth 1 -type d -name 'ffmpeg-*-amd64-static' | head -n1)"
mv "$FF_DIR/ffmpeg" ./ffmpeg
mv "$FF_DIR/ffprobe" ./ffprobe
chmod +x ffmpeg ffprobe
rm -rf "$FF_DIR" ffmpeg.tar.xz

# ---- espeak-ng check (needed by the /voice-over page for text-to-speech) ----
# On Windows dev machines the built-in SAPI voices are used instead, so this
# only matters on the Linux server. Shared hosts without apt can drop an
# espeak-ng binary into storage/app/bin and it will be picked up automatically.
if command -v espeak-ng >/dev/null 2>&1 || command -v espeak >/dev/null 2>&1; then
    echo "==> espeak-ng found — the /voice-over page will work."
else
    echo "WARNING: espeak-ng not found. The /voice-over (text-to-speech) page"
    echo "         will not work until you install it, e.g.: apt install espeak-ng"
fi

# ---- writable temp dir the PyInstaller build unpacks into ----
mkdir -p "$(cd "$BIN_DIR/../" && pwd)/tmp"

echo ""
echo "==> Done. Verifying:"
./yt-dlp --version && echo "yt-dlp OK"
[ -f youtube-dl ] && ./youtube-dl --version && echo "youtube-dl OK"
./ffmpeg -version | head -n1 && echo "ffmpeg OK"
echo ""
echo "Files in $BIN_DIR:"
ls -la "$BIN_DIR"
