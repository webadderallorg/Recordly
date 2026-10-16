#include <windows.h>
#include <cstdio>
#include <iostream>
#include <string>
#include <thread>
#include <atomic>
#include <unordered_map>

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

namespace {

struct MouseButtonWatch {
    int virtualKey;
    int reportedButton;  // 1 = left, 2 = right, 3 = middle
    bool wasDown;
};

// Polling GetAsyncKeyState instead of installing a WH_MOUSE_LL hook: a low-level
// hook lives inside the hooking process and Windows silently unhooks it whenever
// the callback misses LowLevelHooksTimeout, which is exactly what happens while
// the recorder's main process is busy encoding. This helper is a separate
// process doing a cheap state read, so it cannot be unhooked.
bool isButtonDown(int virtualKey) {
    return (GetAsyncKeyState(virtualKey) & 0x8000) != 0;
}

void reportMouseButtonEdges(MouseButtonWatch buttons[], size_t count) {
    for (size_t i = 0; i < count; ++i) {
        MouseButtonWatch& button = buttons[i];
        const bool isDown = isButtonDown(button.virtualKey);

        if (isDown == button.wasDown) {
            continue;
        }

        button.wasDown = isDown;
        if (isDown) {
            std::cout << "INTERACTION:mousedown:" << button.reportedButton << std::endl;
        } else {
            std::cout << "INTERACTION:mouseup" << std::endl;
        }
    }
}

}  // namespace

int main() {
    std::setvbuf(stdout, nullptr, _IONBF, 0);

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

    MouseButtonWatch buttons[] = {
        {VK_LBUTTON, 1, false},
        {VK_RBUTTON, 2, false},
        {VK_MBUTTON, 3, false},
    };
    const size_t buttonCount = sizeof(buttons) / sizeof(buttons[0]);

    // Buttons are sampled every 8ms so short clicks are not missed; the cursor
    // shape only needs the original ~50ms cadence.
    const int buttonPollMs = 8;
    const int cursorPollEvery = 50 / buttonPollMs;
    int tick = 0;

    while (g_running.load()) {
        reportMouseButtonEdges(buttons, buttonCount);

        if (tick == 0) {
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
        }

        tick = (tick + 1) % cursorPollEvery;
        Sleep(buttonPollMs);
    }

    return 0;
}
