cmake_minimum_required(VERSION 3.20)
project(windows-capture LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(windows-capture
  src/main.cpp
  src/dxgi_session.cpp
  src/mf_encoder.cpp
  src/monitor_utils.cpp
  src/wasapi_loopback.cpp
)

target_compile_options(windows-capture PRIVATE /EHsc /W3 /utf-8)

target_link_libraries(windows-capture PRIVATE
  d3d11
  dxgi
  dwmapi
  mfplat
  mfreadwrite
  mf
  mfuuid
  ole32
  shcore
)
