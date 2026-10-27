#!/bin/sh
set -eu

if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
  echo "Usage: sh scripts/smoke-installed-deb.sh path/to/package.deb" >&2
  exit 1
fi

package_path=$(realpath "$1")
sudo apt-get install -y "$package_path"
test "$(dpkg-query -W -f='${Status}' recordly)" = 'install ok installed'
test -x /usr/bin/recordly

smoke_dir=$(mktemp -d)
trap 'rm -rf "$smoke_dir"' EXIT HUP INT TERM
mkdir -p "$smoke_dir/home" "$smoke_dir/config" "$smoke_dir/cache"
export HOME="$smoke_dir/home"
export XDG_CONFIG_HOME="$smoke_dir/config"
export XDG_CACHE_HOME="$smoke_dir/cache"
export XDG_SESSION_TYPE=x11
export RECORDLY_DISABLE_AUTO_UPDATES=1
export SMOKE_LOG="$smoke_dir/recordly.log"

if timeout --kill-after=5s 90s xvfb-run -a -e /dev/stderr sh -c '
  /usr/bin/recordly --disable-gpu > "$SMOKE_LOG" 2>&1 &
  app_pid=$!
  trap '\''kill "$app_pid" 2>/dev/null || :; wait "$app_pid" 2>/dev/null || :'\'' EXIT HUP INT TERM
  while kill -0 "$app_pid" 2>/dev/null; do
    if grep -Fq "HUD Window: renderer-ready" "$SMOKE_LOG"; then
      sleep 2
      kill -0 "$app_pid" 2>/dev/null || exit 1
      exit 0
    fi
    sleep 1
  done
  exit 1
'; then
  cat "$SMOKE_LOG"
  echo "Installed Recordly launched and its HUD renderer became ready."
else
  status=$?
  test ! -f "$SMOKE_LOG" || cat "$SMOKE_LOG" >&2
  echo "Installed Recordly did not reach HUD renderer readiness (status $status)." >&2
  exit 1
fi
