cmake_minimum_required(VERSION 3.20)
project(cursor-monitor LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(cursor-monitor src/main.cpp)

target_link_libraries(cursor-monitor PRIVATE user32 ole32 oleaut32 UIAutomationCore)
