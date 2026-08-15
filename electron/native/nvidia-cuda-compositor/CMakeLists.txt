cmake_minimum_required(VERSION 3.24)

# Target the common NVENC-capable architectures with native SASS plus PTX
# fallback. The legacy default (compute_75 only) cannot run on Blackwell
# (sm_120) GPUs. Override with -DCMAKE_CUDA_ARCHITECTURES for exotic targets.
# Must be set before project() so CUDA language init does not pin it to the
# toolkit default.
if(NOT DEFINED CMAKE_CUDA_ARCHITECTURES)
  set(CMAKE_CUDA_ARCHITECTURES "75;86;89;90;120")
endif()

project(recordly_nvidia_cuda_compositor LANGUAGES CXX CUDA)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CUDA_STANDARD 17)
set(CMAKE_CUDA_STANDARD_REQUIRED ON)

set(RECORDLY_NVENC_HEADERS_DIR
  "${CMAKE_CURRENT_LIST_DIR}/../../../.tmp/nv-codec-headers/include/ffnvcodec"
  CACHE PATH
  "Path to the nv-codec-headers include dir (nvEncodeAPI.h 12+/13+ for Blackwell)"
)
set(RECORDLY_NVIDIA_VIDEO_CODEC_SDK_ROOT
  "${CMAKE_CURRENT_LIST_DIR}/../../../.tmp/video-sdk-samples"
  CACHE PATH
  "Path to the NVIDIA Video Codec SDK samples checkout"
)
set(NVIDIA_SAMPLES_DIR "${RECORDLY_NVIDIA_VIDEO_CODEC_SDK_ROOT}/Samples")
set(NVCODEC_DIR "${NVIDIA_SAMPLES_DIR}/NvCodec")

if(NOT EXISTS "${NVCODEC_DIR}")
  message(FATAL_ERROR "NVIDIA Video Codec SDK NvCodec directory not found: ${NVCODEC_DIR}. Set RECORDLY_NVIDIA_VIDEO_CODEC_SDK_ROOT.")
endif()

add_executable(recordly-nvidia-cuda-compositor
  src/main.cu
  "${NVCODEC_DIR}/NvDecoder/NvDecoder.cpp"
  "${NVCODEC_DIR}/NvEncoder/NvEncoder.cpp"
  "${NVCODEC_DIR}/NvEncoder/NvEncoderCuda.cpp"
)

target_include_directories(recordly-nvidia-cuda-compositor PRIVATE
  "${RECORDLY_NVENC_HEADERS_DIR}"
  "${NVIDIA_SAMPLES_DIR}"
  "${NVCODEC_DIR}"
  "${NVCODEC_DIR}/NvEncoder"
  "${NVCODEC_DIR}/NvDecoder"
  "${NVCODEC_DIR}/../Utils"
)

target_compile_definitions(recordly-nvidia-cuda-compositor PRIVATE
  NOMINMAX
  WIN32_LEAN_AND_MEAN
)

find_package(CUDAToolkit REQUIRED)
target_link_libraries(recordly-nvidia-cuda-compositor PRIVATE
  CUDA::cuda_driver
  "${NVCODEC_DIR}/Lib/x64/nvcuvid.lib"
)

set_target_properties(recordly-nvidia-cuda-compositor PROPERTIES
  CUDA_SEPARABLE_COMPILATION OFF
)
