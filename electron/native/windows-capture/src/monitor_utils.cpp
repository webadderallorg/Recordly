#include "monitor_utils.h"
#include <ShellScalingApi.h>

static BOOL CALLBACK enumMonitorCallback(HMONITOR hMonitor, HDC, LPRECT, LPARAM lParam) {
    auto* monitors = reinterpret_cast<std::vector<MonitorInfo>*>(lParam);

    MONITORINFOEXW mi = {};
    mi.cbSize = sizeof(mi);
    if (GetMonitorInfoW(hMonitor, &mi)) {
        MonitorInfo info;
        info.handle = hMonitor;
        info.x = mi.rcMonitor.left;
        info.y = mi.rcMonitor.top;
        info.width = mi.rcMonitor.right - mi.rcMonitor.left;
        info.height = mi.rcMonitor.bottom - mi.rcMonitor.top;
        info.deviceName = mi.szDevice;
        monitors->push_back(info);
    }

    return TRUE;
}

std::vector<MonitorInfo> enumerateMonitors() {
    std::vector<MonitorInfo> monitors;
    EnumDisplayMonitors(nullptr, nullptr, enumMonitorCallback, reinterpret_cast<LPARAM>(&monitors));
    return monitors;
}

// Electron uses the HMONITOR handle value cast to a number as the display ID.
HMONITOR findMonitorByDisplayId(int displayId) {
    auto monitors = enumerateMonitors();

    for (const auto& m : monitors) {
        if (static_cast<int>(reinterpret_cast<intptr_t>(m.handle)) == displayId) {
            return m.handle;
        }
    }

    if (!monitors.empty()) {
        return monitors[0].handle;
    }

    return MonitorFromPoint({0, 0}, MONITOR_DEFAULTTOPRIMARY);
}

MonitorInfo getMonitorInfo(HMONITOR monitor) {
    MonitorInfo info;
    info.handle = monitor;

    MONITORINFOEXW mi = {};
    mi.cbSize = sizeof(mi);
    if (GetMonitorInfoW(monitor, &mi)) {
        info.x = mi.rcMonitor.left;
        info.y = mi.rcMonitor.top;
        info.width = mi.rcMonitor.right - mi.rcMonitor.left;
        info.height = mi.rcMonitor.bottom - mi.rcMonitor.top;
        info.deviceName = mi.szDevice;
    }

    return info;
}
