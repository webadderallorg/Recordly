# Maintainer: firtoz <aur at firtoz dot com>
# Upstream: https://github.com/webadderall/Recordly

pkgname=recordly-bin
pkgver=1.0.9
pkgrel=1
pkgdesc="Open-source screen recorder and editor with auto-zoom, cursor effects, and polished video export"
arch=(x86_64)
url="https://github.com/webadderall/Recordly"
license=(MIT)
depends=(fuse2)
source=(
  "https://github.com/webadderall/Recordly/releases/download/v${pkgver}/Recordly-linux-x64.AppImage"
  "recordly.desktop"
)
sha256sums=(
  SKIP
  SKIP
)
options=(!strip)

package() {
  install -d "$pkgdir/opt/recordly"
  install -Dm755 "$srcdir/Recordly-linux-x64.AppImage" "$pkgdir/opt/recordly/Recordly.AppImage"

  install -d "$pkgdir/usr/bin"
  cat > "$pkgdir/usr/bin/recordly" << 'EOF'
#!/bin/sh
exec /opt/recordly/Recordly.AppImage "$@"
EOF
  chmod 755 "$pkgdir/usr/bin/recordly"

  install -Dm644 "$srcdir/recordly.desktop" "$pkgdir/usr/share/applications/dev.recordly.app.desktop"

  # Extract icons from AppImage so Icon=dev.recordly.app in the .desktop resolves
  cd "$srcdir"
  chmod +x Recordly-linux-x64.AppImage
  ./Recordly-linux-x64.AppImage --appimage-extract
  for size in 16 24 32 48 64 128 256 512 1024; do
    src="squashfs-root/usr/share/icons/hicolor/${size}x${size}/apps/recordly.png"
    if [ -f "$src" ]; then
      install -Dm644 "$src" "$pkgdir/usr/share/icons/hicolor/${size}x${size}/apps/dev.recordly.app.png"
    fi
  done
  rm -rf squashfs-root
}
