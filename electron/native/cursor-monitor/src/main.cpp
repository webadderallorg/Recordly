#include <windows.h>
#include <cstdio>
#include <iostream>
#include <string>
#include <thread>
#include <atomic>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include <oleauto.h>
#include <UIAutomation.h>

static std::atomic<bool> g_running{true};
static std::atomic<bool> g_captureKeys{false};
static HHOOK g_keyboardHook = nullptr;
static std::unordered_set<DWORD> g_downKeys;

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

static HWND focusedWin32Window() {
    HWND foreground = GetForegroundWindow();
    if (!foreground) {
        return nullptr;
    }

    DWORD threadId = GetWindowThreadProcessId(foreground, nullptr);
    GUITHREADINFO info = {};
    info.cbSize = sizeof(info);
    HWND focus = foreground;
    if (GetGUIThreadInfo(threadId, &info) && info.hwndFocus) {
        focus = info.hwndFocus;
    }
    return focus;
}

enum class FocusedFieldKind {
    NonSecure,
    Secure,
    Unknown
};

static FocusedFieldKind win32FocusedPasswordState() {
    HWND focus = focusedWin32Window();
    if (!focus) {
        return FocusedFieldKind::Unknown;
    }

    LONG_PTR style = GetWindowLongPtr(focus, GWL_STYLE);
    if (style & ES_PASSWORD) {
        return FocusedFieldKind::Secure;
    }

    DWORD_PTR passwordChar = 0;
    const LRESULT sent = SendMessageTimeoutW(
        focus,
        EM_GETPASSWORDCHAR,
        0,
        0,
        SMTO_ABORTIFHUNG | SMTO_BLOCK,
        50,
        &passwordChar
    );
    if (sent == 0) {
        return FocusedFieldKind::Secure;
    }
    if (passwordChar != 0) {
        return FocusedFieldKind::Secure;
    }

    wchar_t className[256] = {};
    if (GetClassNameW(focus, className, 256) > 0) {
        std::wstring cls(className);
        if (cls.find(L"Password") != std::wstring::npos) {
            return FocusedFieldKind::Secure;
        }
        return FocusedFieldKind::NonSecure;
    }
    return FocusedFieldKind::Unknown;
}

static FocusedFieldKind uiaFocusedPasswordState() {
    IUIAutomation* automation = nullptr;
    HRESULT created = CoCreateInstance(
        CLSID_CUIAutomation,
        nullptr,
        CLSCTX_INPROC_SERVER,
        IID_IUIAutomation,
        reinterpret_cast<void**>(&automation)
    );
    if (FAILED(created) || !automation) {
        return FocusedFieldKind::Unknown;
    }

    IUIAutomationElement* focused = nullptr;
    HRESULT focusResult = automation->GetFocusedElement(&focused);
    if (FAILED(focusResult) || !focused) {
        automation->Release();
        return FocusedFieldKind::Unknown;
    }

    BOOL password = FALSE;
    HRESULT passwordResult = focused->get_CurrentIsPassword(&password);
    focused->Release();
    automation->Release();
    if (FAILED(passwordResult)) {
        return FocusedFieldKind::Unknown;
    }
    return password ? FocusedFieldKind::Secure : FocusedFieldKind::NonSecure;
}

static FocusedFieldKind focusedPasswordState() {
    const FocusedFieldKind win32State = win32FocusedPasswordState();
    if (win32State == FocusedFieldKind::Secure) {
        return FocusedFieldKind::Secure;
    }

    const FocusedFieldKind uiaState = uiaFocusedPasswordState();
    if (uiaState == FocusedFieldKind::Secure) {
        return FocusedFieldKind::Secure;
    }
    if (win32State == FocusedFieldKind::NonSecure && uiaState == FocusedFieldKind::NonSecure) {
        return FocusedFieldKind::NonSecure;
    }
    return FocusedFieldKind::Unknown;
}

static std::string keyNameFromVk(DWORD vk) {
    switch (vk) {
        case VK_RETURN: return "Enter";
        case VK_ESCAPE: return "Escape";
        case VK_TAB: return "Tab";
        case VK_BACK: return "Backspace";
        case VK_DELETE: return "Delete";
        case VK_SPACE: return "Space";
        case VK_UP: return "ArrowUp";
        case VK_DOWN: return "ArrowDown";
        case VK_LEFT: return "ArrowLeft";
        case VK_RIGHT: return "ArrowRight";
        case VK_HOME: return "Home";
        case VK_END: return "End";
        case VK_PRIOR: return "PageUp";
        case VK_NEXT: return "PageDown";
        case VK_INSERT: return "Insert";
        case VK_SHIFT:
        case VK_LSHIFT:
        case VK_RSHIFT: return "Shift";
        case VK_CONTROL:
        case VK_LCONTROL:
        case VK_RCONTROL: return "Control";
        case VK_MENU:
        case VK_LMENU:
        case VK_RMENU: return "Alt";
        case VK_LWIN:
        case VK_RWIN: return "Meta";
        default:
            break;
    }
    if (vk >= VK_F1 && vk <= VK_F24) {
        return "F" + std::to_string(vk - VK_F1 + 1);
    }
    if (vk >= 0x30 && vk <= 0x39) {
        return std::string(1, static_cast<char>(vk));
    }
    if (vk >= 0x41 && vk <= 0x5A) {
        return std::string(1, static_cast<char>(vk));
    }
    return "Key" + std::to_string(vk);
}

static LRESULT CALLBACK keyboardProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode == HC_ACTION && g_captureKeys.load()) {
        const auto* info = reinterpret_cast<KBDLLHOOKSTRUCT*>(lParam);
        if (info) {
            if (wParam == WM_KEYUP || wParam == WM_SYSKEYUP) {
                g_downKeys.erase(info->vkCode);
            } else if (wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN) {
                const bool repeat = !g_downKeys.insert(info->vkCode).second;
                if (!repeat && focusedPasswordState() == FocusedFieldKind::NonSecure) {
                    std::vector<std::string> modifiers;
                    if (GetAsyncKeyState(VK_CONTROL) & 0x8000) modifiers.emplace_back("ctrl");
                    if (GetAsyncKeyState(VK_MENU) & 0x8000) modifiers.emplace_back("alt");
                    if (GetAsyncKeyState(VK_SHIFT) & 0x8000) modifiers.emplace_back("shift");
                    if ((GetAsyncKeyState(VK_LWIN) & 0x8000) || (GetAsyncKeyState(VK_RWIN) & 0x8000)) {
                        modifiers.emplace_back("meta");
                    }
                    std::string suffix;
                    if (!modifiers.empty()) {
                        suffix = ":";
                        for (size_t i = 0; i < modifiers.size(); ++i) {
                            if (i > 0) suffix += ",";
                            suffix += modifiers[i];
                        }
                    }
                    std::cout << "KEY:down:" << keyNameFromVk(info->vkCode) << suffix << std::endl;
                }
            }
        }
    }
    return CallNextHookEx(g_keyboardHook, nCode, wParam, lParam);
}

int main(int argc, char** argv) {
    std::setvbuf(stdout, nullptr, _IONBF, 0);
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);

    for (int i = 1; i < argc; ++i) {
        if (std::string(argv[i]) == "--capture-keys") {
            g_captureKeys.store(true);
        }
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

    if (g_captureKeys.load()) {
        g_keyboardHook = SetWindowsHookExW(WH_KEYBOARD_LL, keyboardProc, GetModuleHandleW(nullptr), 0);
        if (!g_keyboardHook) {
            std::cerr << "Keyboard hook unavailable; keystroke overlay capture disabled" << std::endl;
        }
    }

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

        MSG msg;
        while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }

        Sleep(50);
    }

    if (g_keyboardHook) {
        UnhookWindowsHookEx(g_keyboardHook);
        g_keyboardHook = nullptr;
    }
    CoUninitialize();
    return 0;
}
