#!/bin/sh
set -eu

repo_url=https://github.com/webadderallorg/Recordly

if [ "$#" -gt 1 ]; then
  echo "Usage: sh -s -- [release-tag]" >&2
  exit 1
fi

if [ "$(uname -s)" != Linux ]; then
  echo "The Debian package is available only for Linux." >&2
  exit 1
fi

case "$(uname -m)" in
  x86_64|amd64) arch=amd64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac
artifact=Recordly-linux-$arch.deb

for command in curl sha256sum mktemp; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command not found: $command" >&2
    exit 1
  fi
done

if [ "$#" -eq 1 ]; then
  tag=$1
else
  release_url=$(curl -fsSL -o /dev/null -w '%{url_effective}' "$repo_url/releases/latest")
  case "$release_url" in
    "$repo_url"/releases/tag/*) tag=${release_url##*/} ;;
    *) echo "Could not resolve the latest release." >&2; exit 1 ;;
  esac
fi

case "$tag" in
  ''|*[!A-Za-z0-9._-]*) echo "Invalid release tag: $tag" >&2; exit 1 ;;
esac

if [ -e "$artifact" ]; then
  echo "$artifact already exists in the current directory; move it before downloading." >&2
  exit 1
fi

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT HUP INT TERM
base_url=$repo_url/releases/download/$tag
curl -fsSL "$base_url/$artifact" -o "$tmp_dir/$artifact"
curl -fsSL "$base_url/SHA256SUMS.txt" -o "$tmp_dir/SHA256SUMS.txt"

if ! (cd "$tmp_dir" && awk -v name="$artifact" '
  $2 == name && length($1) == 64 && $1 !~ /[^0-9a-fA-F]/ { print; count++ }
  END { if (count != 1) exit 1 }
' SHA256SUMS.txt > package.sha256 && sha256sum -c package.sha256); then
  echo "Package checksum verification failed." >&2
  exit 1
fi

mv "$tmp_dir/$artifact" "./$artifact"
echo "Downloaded and verified $artifact from $tag."
echo "Install with: sudo apt install ./$artifact"
