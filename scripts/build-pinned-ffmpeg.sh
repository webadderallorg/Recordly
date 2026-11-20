#!/usr/bin/env bash
# Run in a private working directory containing the verified source trees.
set -euo pipefail
target=$1
jobs=$2
prefix="$PWD/prefix"
ffmpeg_ldflags="-L$prefix/lib"
export PKG_CONFIG_PATH="$prefix/lib/pkgconfig"
export PKG_CONFIG_LIBDIR="$PKG_CONFIG_PATH"

case "$target" in
  win32-x64)
    export PATH=/ucrt64/bin:/usr/bin
    x264_target=(--host=x86_64-w64-mingw32)
    vpx_target=x86_64-win64-gcc
    executable_suffix=.exe
    ffmpeg_target=(--target-os=mingw32 --enable-w32threads --enable-mediafoundation --enable-d3d11va --enable-dxva2)
    ffmpeg_ldflags+=" -static"
    ;;
  linux-x64)
    x264_target=(--host=x86_64-linux-gnu --enable-pic)
    vpx_target=x86_64-linux-gcc
    executable_suffix=
    ffmpeg_target=(--target-os=linux --enable-pthreads)
    ;;
  *)
    echo "Unsupported FFmpeg build target: $target" >&2
    exit 1
    ;;
esac

for tool in gcc g++ make nasm pkg-config objdump diff perl; do
  command -v "$tool" >/dev/null || { echo "Missing FFmpeg build tool: $tool" >&2; exit 1; }
done

export LC_ALL=C
set -x
(
  cd x264
  ./configure --prefix="$prefix" --enable-static --disable-shared --disable-cli "${x264_target[@]}"
  make -j "$jobs"
  make install
)
(
  cd libvpx
  ./configure --prefix="$prefix" --target="$vpx_target" --enable-static --disable-shared \
    --disable-examples --disable-tools --disable-unit-tests --disable-docs --disable-debug
  make -j "$jobs"
  make install
)
(
  cd zlib
  if [[ "$target" == win32-x64 ]]; then
    make -j "$jobs" -f win32/Makefile.gcc libz.a
    cp libz.a "$prefix/lib/"
    cp zlib.h zconf.h "$prefix/include/"
  else
    ./configure --static --prefix="$prefix"
    make -j "$jobs"
    make install
  fi
)
(
  cd ffmpeg
  ./configure --prefix="$prefix" --arch=x86_64 "${ffmpeg_target[@]}" \
    --pkg-config-flags=--static --disable-autodetect --disable-nonfree --enable-gpl \
    --enable-version3 --enable-static --disable-shared --enable-libx264 --enable-libvpx --enable-zlib \
    --extra-cflags="-I$prefix/include" --extra-ldflags="$ffmpeg_ldflags" \
    --disable-ffplay --disable-doc --disable-debug
  make -j "$jobs" "ffmpeg$executable_suffix" "ffprobe$executable_suffix"
)
