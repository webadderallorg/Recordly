#include "dxgi_session.h"

#include <dwmapi.h>

#include <algorithm>
#include <chrono>
#include <iostream>

namespace {

bool intersectRectChecked(const RECT& lhs, const RECT& rhs, RECT& result) {
    return IntersectRect(&result, &lhs, &rhs) != FALSE;
}

int evenFloor(int value) {
    return value > 1 ? (value & ~1) : value;
}

RECT getExtendedWindowBounds(HWND hwnd) {
    RECT bounds{};
    if (SUCCEEDED(DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, &bounds, sizeof(bounds)))) {
        return bounds;
    }

    GetWindowRect(hwnd, &bounds);
    return bounds;
}

} // namespace

DxgiSession::DxgiSession() {}

DxgiSession::~DxgiSession() {
    stopCapture();
}

bool DxgiSession::findOutputForMonitor(HMONITOR monitor, ComPtr<IDXGIAdapter1>& adapter, ComPtr<IDXGIOutput1>& output) {
    ComPtr<IDXGIFactory1> factory;
    HRESULT hr = CreateDXGIFactory1(IID_PPV_ARGS(&factory));
    if (FAILED(hr)) {
        std::cerr << "ERROR: CreateDXGIFactory1 failed: 0x" << std::hex << hr << std::endl;
        return false;
    }

    for (UINT adapterIndex = 0;; ++adapterIndex) {
        ComPtr<IDXGIAdapter1> candidateAdapter;
        hr = factory->EnumAdapters1(adapterIndex, &candidateAdapter);
        if (hr == DXGI_ERROR_NOT_FOUND) {
            break;
        }
        if (FAILED(hr)) {
            continue;
        }

        for (UINT outputIndex = 0;; ++outputIndex) {
            ComPtr<IDXGIOutput> candidateOutput;
            hr = candidateAdapter->EnumOutputs(outputIndex, &candidateOutput);
            if (hr == DXGI_ERROR_NOT_FOUND) {
                break;
            }
            if (FAILED(hr)) {
                continue;
            }

            DXGI_OUTPUT_DESC desc{};
            if (FAILED(candidateOutput->GetDesc(&desc))) {
                continue;
            }

            if (!desc.AttachedToDesktop || desc.Monitor != monitor) {
                continue;
            }

            ComPtr<IDXGIOutput1> output1;
            hr = candidateOutput.As(&output1);
            if (FAILED(hr)) {
                continue;
            }

            adapter = candidateAdapter;
            output = output1;
            outputDesc_ = desc;
            return true;
        }
    }

    return false;
}

bool DxgiSession::createD3DDevice(IDXGIAdapter1* adapter) {
    UINT creationFlags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;
    D3D_FEATURE_LEVEL featureLevels[] = {
        D3D_FEATURE_LEVEL_11_1,
        D3D_FEATURE_LEVEL_11_0,
    };

    HRESULT hr = D3D11CreateDevice(
        adapter,
        D3D_DRIVER_TYPE_UNKNOWN,
        nullptr,
        creationFlags,
        featureLevels,
        ARRAYSIZE(featureLevels),
        D3D11_SDK_VERSION,
        &d3dDevice_,
        nullptr,
        &d3dContext_);

    if (FAILED(hr)) {
        std::cerr << "ERROR: D3D11CreateDevice failed: 0x" << std::hex << hr << std::endl;
        return false;
    }

    return true;
}

bool DxgiSession::createDuplication(IDXGIOutput1* output) {
    HRESULT hr = output->DuplicateOutput(d3dDevice_.Get(), &duplication_);
    if (FAILED(hr)) {
        std::cerr << "ERROR: DuplicateOutput failed: 0x" << std::hex << hr << std::endl;
        return false;
    }

    return true;
}

bool DxgiSession::createCaptureTexture() {
    if (captureWidth_ <= 0 || captureHeight_ <= 0) {
        return false;
    }

    D3D11_TEXTURE2D_DESC desc{};
    desc.Width = static_cast<UINT>(captureWidth_);
    desc.Height = static_cast<UINT>(captureHeight_);
    desc.MipLevels = 1;
    desc.ArraySize = 1;
    desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    desc.SampleDesc.Count = 1;
    desc.Usage = D3D11_USAGE_DEFAULT;

    HRESULT hr = d3dDevice_->CreateTexture2D(&desc, nullptr, &captureTexture_);
    if (FAILED(hr)) {
        std::cerr << "ERROR: CreateTexture2D failed: 0x" << std::hex << hr << std::endl;
        return false;
    }

    return true;
}

bool DxgiSession::initializeFullMonitorRect() {
    const int width = outputDesc_.DesktopCoordinates.right - outputDesc_.DesktopCoordinates.left;
    const int height = outputDesc_.DesktopCoordinates.bottom - outputDesc_.DesktopCoordinates.top;

    captureWidth_ = evenFloor(width);
    captureHeight_ = evenFloor(height);
    if (captureWidth_ <= 0 || captureHeight_ <= 0) {
        return false;
    }

    captureRect_.left = 0;
    captureRect_.top = 0;
    captureRect_.right = captureWidth_;
    captureRect_.bottom = captureHeight_;
    return true;
}

bool DxgiSession::updateWindowCaptureRect() {
    if (!captureWindow_ || !windowHandle_) {
        return false;
    }

    RECT windowRect = getExtendedWindowBounds(windowHandle_);
    RECT monitorRect = outputDesc_.DesktopCoordinates;
    RECT clippedRect{};
    if (!intersectRectChecked(windowRect, monitorRect, clippedRect)) {
        return false;
    }

    int left = clippedRect.left - monitorRect.left;
    int top = clippedRect.top - monitorRect.top;
    const int monitorWidth = monitorRect.right - monitorRect.left;
    const int monitorHeight = monitorRect.bottom - monitorRect.top;

    left = std::clamp(left, 0, std::max(0, monitorWidth - captureWidth_));
    top = std::clamp(top, 0, std::max(0, monitorHeight - captureHeight_));

    captureRect_.left = left;
    captureRect_.top = top;
    captureRect_.right = left + captureWidth_;
    captureRect_.bottom = top + captureHeight_;
    return true;
}

bool DxgiSession::initializeWindowRect(HWND hwnd) {
    windowHandle_ = hwnd;
    captureWindow_ = true;

    RECT windowRect = getExtendedWindowBounds(hwnd);
    RECT monitorRect = outputDesc_.DesktopCoordinates;
    RECT clippedRect{};
    if (!intersectRectChecked(windowRect, monitorRect, clippedRect)) {
        return false;
    }

    captureWidth_ = evenFloor(clippedRect.right - clippedRect.left);
    captureHeight_ = evenFloor(clippedRect.bottom - clippedRect.top);
    if (captureWidth_ <= 0 || captureHeight_ <= 0) {
        return false;
    }

    return updateWindowCaptureRect();
}

bool DxgiSession::initializeForMonitor(HMONITOR monitor, int fps) {
    fps_ = fps;
    frameIntervalHns_ = 10000000LL / fps_;

    ComPtr<IDXGIAdapter1> adapter;
    ComPtr<IDXGIOutput1> output;
    if (!findOutputForMonitor(monitor, adapter, output)) {
        std::cerr << "ERROR: Failed to find DXGI output for monitor" << std::endl;
        return false;
    }

    if (!createD3DDevice(adapter.Get())) {
        return false;
    }

    if (!createDuplication(output.Get())) {
        return false;
    }

    return true;
}

bool DxgiSession::initialize(HMONITOR monitor, int fps) {
    captureWindow_ = false;
    windowHandle_ = nullptr;

    if (!initializeForMonitor(monitor, fps)) {
        return false;
    }

    return initializeFullMonitorRect() && createCaptureTexture();
}

bool DxgiSession::initialize(HWND hwnd, int fps) {
    HMONITOR monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
    if (!monitor) {
        std::cerr << "ERROR: MonitorFromWindow failed" << std::endl;
        return false;
    }

    if (!initializeForMonitor(monitor, fps)) {
        return false;
    }

    return initializeWindowRect(hwnd) && createCaptureTexture();
}

void DxgiSession::setFrameCallback(FrameCallback callback) {
    frameCallback_ = std::move(callback);
}

bool DxgiSession::startCapture() {
    if (!duplication_ || !captureTexture_) {
        return false;
    }

    capturing_ = true;
    lastFrameTimeHns_ = 0;
    captureThread_ = std::thread(&DxgiSession::captureLoop, this);
    return true;
}

void DxgiSession::stopCapture() {
    capturing_ = false;

    if (captureThread_.joinable()) {
        captureThread_.join();
    }

    duplication_.Reset();
    captureTexture_.Reset();
}

int64_t DxgiSession::nowHns() const {
    return std::chrono::duration_cast<std::chrono::duration<int64_t, std::ratio<1, 10000000>>>(
        std::chrono::steady_clock::now().time_since_epoch()).count();
}

void DxgiSession::captureLoop() {
    while (capturing_) {
        DXGI_OUTDUPL_FRAME_INFO frameInfo{};
        ComPtr<IDXGIResource> desktopResource;
        HRESULT hr = duplication_->AcquireNextFrame(100, &frameInfo, &desktopResource);

        if (hr == DXGI_ERROR_WAIT_TIMEOUT) {
            continue;
        }

        if (FAILED(hr)) {
            if (hr != DXGI_ERROR_ACCESS_LOST) {
                std::cerr << "ERROR: AcquireNextFrame failed: 0x" << std::hex << hr << std::endl;
            }
            break;
        }

        ComPtr<ID3D11Texture2D> sourceTexture;
        hr = desktopResource.As(&sourceTexture);
        if (SUCCEEDED(hr) && sourceTexture) {
            if (!captureWindow_ || updateWindowCaptureRect()) {
                const int64_t timestampHns = nowHns();
                if (lastFrameTimeHns_ == 0 || (timestampHns - lastFrameTimeHns_) >= (frameIntervalHns_ * 7 / 10)) {
                    D3D11_BOX sourceBox{};
                    sourceBox.left = static_cast<UINT>(captureRect_.left);
                    sourceBox.top = static_cast<UINT>(captureRect_.top);
                    sourceBox.front = 0;
                    sourceBox.right = static_cast<UINT>(captureRect_.right);
                    sourceBox.bottom = static_cast<UINT>(captureRect_.bottom);
                    sourceBox.back = 1;

                    d3dContext_->CopySubresourceRegion(
                        captureTexture_.Get(),
                        0,
                        0,
                        0,
                        0,
                        sourceTexture.Get(),
                        0,
                        &sourceBox);

                    if (frameCallback_) {
                        lastFrameTimeHns_ = timestampHns;
                        frameCallback_(captureTexture_.Get(), timestampHns);
                    }
                }
            }
        }

        duplication_->ReleaseFrame();
    }
}