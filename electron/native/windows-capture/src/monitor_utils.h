#pragma once

#include <windows.h>
#include <string>
#include <vector>

struct MonitorInfo {
    HMONITOR handle;
    int x;
    int y;
    int width;
    int height;
    std::wstring deviceName;
};

std::vector<MonitorInfo> enumerateMonitors();
HMONITOR findMonitorByDisplayId(int displayId);
MonitorInfo getMonitorInfo(HMONITOR monitor);
