cmake_minimum_required(VERSION 3.20)
project(cursor-monitor LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(cursor-monitor src/main.cpp)

set_property(TARGET cursor-monitor PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

target_link_libraries(cursor-monitor PRIVATE user32 dwmapi)
