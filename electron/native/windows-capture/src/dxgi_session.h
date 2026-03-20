#pragma once

#include <windows.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <wrl/client.h>

#include <functional>
#include <atomic>
#include <thread>

using Microsoft::WRL::ComPtr;

class DxgiSession {
public:
    using FrameCallback = std::function<void(ID3D11Texture2D*, int64_t timestampHns)>;

    DxgiSession();
    ~DxgiSession();

    bool initialize(HMONITOR monitor, int fps);
    bool initialize(HWND hwnd, int fps);
    void setFrameCallback(FrameCallback callback);
    bool startCapture();
    void stopCapture();

    int captureWidth() const { return captureWidth_; }
    int captureHeight() const { return captureHeight_; }
    ID3D11Device* device() const { return d3dDevice_.Get(); }
    ID3D11DeviceContext* context() const { return d3dContext_.Get(); }

private:
    ComPtr<ID3D11Device> d3dDevice_;
    ComPtr<ID3D11DeviceContext> d3dContext_;
    ComPtr<IDXGIOutputDuplication> duplication_;
    ComPtr<ID3D11Texture2D> captureTexture_;

    FrameCallback frameCallback_;
    std::atomic<bool> capturing_{false};
    std::thread captureThread_;

    DXGI_OUTPUT_DESC outputDesc_{};
    RECT captureRect_{};
    HWND windowHandle_ = nullptr;
    bool captureWindow_ = false;
    int fps_ = 60;
    int captureWidth_ = 0;
    int captureHeight_ = 0;
    int64_t frameIntervalHns_ = 0;
    int64_t lastFrameTimeHns_ = 0;

    bool initializeForMonitor(HMONITOR monitor, int fps);
    bool findOutputForMonitor(HMONITOR monitor, ComPtr<IDXGIAdapter1>& adapter, ComPtr<IDXGIOutput1>& output);
    bool createD3DDevice(IDXGIAdapter1* adapter);
    bool createDuplication(IDXGIOutput1* output);
    bool createCaptureTexture();
    bool initializeFullMonitorRect();
    bool initializeWindowRect(HWND hwnd);
    bool updateWindowCaptureRect();
    void captureLoop();
    int64_t nowHns() const;
};