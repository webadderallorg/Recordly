#include <windows.h>
#include <dwmapi.h>
#include <cstdint>
#include <cstdio>
#include <iostream>
#include <string>
#include <thread>
#include <atomic>
#include <unordered_map>
#include <unordered_set>

static std::atomic<bool> g_running{true};

static void stdinListener() {
    std::string line;
    while (std::getline(std::cin, line)) {
        if (line == "stop") {
            g_running.store(false);
            return;
        }
    }
    g_running.store(false);
}

static bool windowBounds(HWND window, RECT& rect) {
    if (!IsWindowVisible(window) || IsIconic(window)) return false;
    if (DwmGetWindowAttribute(window, DWMWA_EXTENDED_FRAME_BOUNDS, &rect, sizeof(rect)) != S_OK &&
        !GetWindowRect(window, &rect)) return false;
    return rect.right > rect.left && rect.bottom > rect.top;
}

static void printBounds(const RECT& rect) {
    std::cout << "\"x\":" << rect.left << ",\"y\":" << rect.top
              << ",\"width\":" << rect.right - rect.left
              << ",\"height\":" << rect.bottom - rect.top;
}

int main(int argc, char* argv[]) {
    std::setvbuf(stdout, nullptr, _IONBF, 0);

    if (argc > 1) {
        SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        const std::string command = argv[1];
        if (command == "--window-bounds" && argc == 3) {
            try {
                size_t consumed = 0;
                const auto handle = std::stoull(argv[2], &consumed);
                if (consumed != std::string(argv[2]).size() || handle == 0) return 1;
                RECT rect{};
                if (!windowBounds(reinterpret_cast<HWND>(static_cast<uintptr_t>(handle)), rect)) {
                    std::cout << "null\n";
                } else {
                    std::cout << '{'; printBounds(rect); std::cout << "}\n";
                }
                return 0;
            } catch (...) { return 1; }
        }
        if (command == "--list-windows" && argc == 2) {
            std::unordered_set<HWND> seen;
            bool first = true;
            std::cout << '[';
            for (HWND window = GetTopWindow(nullptr); window && seen.insert(window).second;
                 window = GetWindow(window, GW_HWNDNEXT)) {
                RECT rect{};
                if (!windowBounds(window, rect)) continue;
                DWORD ownerPid = 0;
                GetWindowThreadProcessId(window, &ownerPid);
                if (!first) std::cout << ',';
                first = false;
                std::cout << "{\"id\":" << reinterpret_cast<uintptr_t>(window)
                          << ",\"ownerPid\":" << ownerPid << ',';
                printBounds(rect); std::cout << '}';
            }
            std::cout << "]\n";
            return 0;
        }
        return 1;
    }

    std::unordered_map<HCURSOR, std::string> cursorMap;
    cursorMap[LoadCursor(NULL, IDC_ARROW)]    = "arrow";
    cursorMap[LoadCursor(NULL, IDC_IBEAM)]    = "text";
    cursorMap[LoadCursor(NULL, IDC_HAND)]     = "pointer";
    cursorMap[LoadCursor(NULL, IDC_CROSS)]    = "crosshair";
    cursorMap[LoadCursor(NULL, IDC_NO)]       = "not-allowed";
    cursorMap[LoadCursor(NULL, IDC_SIZEWE)]   = "resize-ew";
    cursorMap[LoadCursor(NULL, IDC_SIZENS)]   = "resize-ns";
    cursorMap[LoadCursor(NULL, IDC_SIZEALL)]  = "open-hand";
    cursorMap[LoadCursor(NULL, IDC_WAIT)]     = "arrow";
    cursorMap[LoadCursor(NULL, IDC_APPSTARTING)] = "arrow";

    std::thread listener(stdinListener);
    listener.detach();

    std::string lastType;

    while (g_running.load()) {
        CURSORINFO ci = {};
        ci.cbSize = sizeof(ci);

        if (GetCursorInfo(&ci) && (ci.flags & CURSOR_SHOWING)) {
            auto it = cursorMap.find(ci.hCursor);
            std::string type = (it != cursorMap.end()) ? it->second : "arrow";

            if (type != lastType) {
                lastType = type;
                std::cout << "STATE:" << type << std::endl;
            }
        }

        Sleep(50);
    }

    return 0;
}
