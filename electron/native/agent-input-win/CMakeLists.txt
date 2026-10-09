cmake_minimum_required(VERSION 3.20)
project(recordly-agent-input LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

add_executable(recordly-agent-input src/main.cpp)

target_compile_definitions(recordly-agent-input PRIVATE NOMINMAX _WIN32_WINNT=0x0A00)

if(MSVC)
  target_compile_options(recordly-agent-input PRIVATE /EHsc /W4 /utf-8)
else()
  target_link_options(recordly-agent-input PRIVATE -static)
endif()

target_link_libraries(recordly-agent-input PRIVATE
  user32
  ole32
  oleaut32
  oleacc
  uuid
  dwmapi
  version
  winmm
  advapi32
)
