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

# ---- writable temp dir the PyInstaller build unpacks into ----
mkdir -p "$(cd "$BIN_DIR/../" && pwd)/tmp"

echo ""
echo "==> Done. Verifying:"
./yt-dlp --version && echo "yt-dlp OK"
./ffmpeg -version | head -n1 && echo "ffmpeg OK"
echo ""
echo "Files in $BIN_DIR:"
ls -la "$BIN_DIR"
