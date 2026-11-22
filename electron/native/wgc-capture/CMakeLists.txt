cmake_minimum_required(VERSION 3.20)
project(wgc-capture LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(wgc-capture
  src/main.cpp
  src/wgc_session.cpp
  src/mf_encoder.cpp
  src/monitor_utils.cpp
  src/wasapi_loopback.cpp
)

target_compile_options(wgc-capture PRIVATE /EHsc /W3 /utf-8)

target_link_libraries(wgc-capture PRIVATE
  windowsapp
  d3d11
  dxgi
  mfplat
  mfreadwrite
  mf
  mfuuid
  ole32
  shcore
)
