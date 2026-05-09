cmake_minimum_required(VERSION 3.20)
project(gpu-export-probe LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(gpu-export-probe
  src/main.cpp
)

set(NVIDIA_VIDEO_SDK_SAMPLES_DIR "${CMAKE_CURRENT_LIST_DIR}/../../../.tmp/video-sdk-samples/Samples")
set(NVIDIA_NVENC_SDK_DIR "${NVIDIA_VIDEO_SDK_SAMPLES_DIR}/NvCodec")
if(EXISTS "${NVIDIA_NVENC_SDK_DIR}/NvEncoder/NvEncoderD3D11.cpp")
  target_sources(gpu-export-probe PRIVATE
    "${NVIDIA_NVENC_SDK_DIR}/NvEncoder/NvEncoder.cpp"
    "${NVIDIA_NVENC_SDK_DIR}/NvEncoder/NvEncoderD3D11.cpp"
  )
  target_include_directories(gpu-export-probe PRIVATE
    "${NVIDIA_VIDEO_SDK_SAMPLES_DIR}"
    "${NVIDIA_NVENC_SDK_DIR}"
  )
  target_compile_definitions(gpu-export-probe PRIVATE RECORDLY_GPU_EXPORT_ENABLE_NVENC_SDK=1)
endif()

target_compile_options(gpu-export-probe PRIVATE /EHsc /W4 /utf-8)

target_link_libraries(gpu-export-probe PRIVATE
  d3d11
  d3dcompiler
  dxgi
  mfplat
  mfreadwrite
  mf
  mfuuid
  ole32
  windowscodecs
)
