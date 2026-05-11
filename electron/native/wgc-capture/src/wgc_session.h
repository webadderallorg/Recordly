#pragma once

#include <windows.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <wrl/client.h>

#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>

#include <functional>
#include <atomic>
#include <string>

using Microsoft::WRL::ComPtr;

class WgcSession {
public:
    using FrameCallback = std::function<void(ID3D11Texture2D*, int64_t timestampHns)>;

    WgcSession();
    ~WgcSession();

    bool initialize(HMONITOR monitor, int fps);
    bool initialize(HWND hwnd, int fps);
    void setFrameCallback(FrameCallback callback);
    bool startCapture();
    void stopCapture();
    bool hasFatalError() const { return fatalError_.load(); }

    int captureWidth() const { return captureWidth_; }
    int captureHeight() const { return captureHeight_; }
    ID3D11Device* device() const { return d3dDevice_.Get(); }
    ID3D11DeviceContext* context() const { return d3dContext_.Get(); }

private:
    ComPtr<ID3D11Device> d3dDevice_;
    ComPtr<ID3D11DeviceContext> d3dContext_;
    winrt::Windows::Graphics::DirectX::Direct3D11::IDirect3DDevice winrtDevice_{nullptr};
    winrt::Windows::Graphics::Capture::GraphicsCaptureItem captureItem_{nullptr};
    winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool framePool_{nullptr};
    winrt::Windows::Graphics::Capture::GraphicsCaptureSession session_{nullptr};
    winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool::FrameArrived_revoker frameArrivedRevoker_;

    FrameCallback frameCallback_;
    std::atomic<bool> capturing_{false};
    std::atomic<bool> fatalError_{false};
    int fps_ = 60;
    int captureWidth_ = 0;
    int captureHeight_ = 0;
    int framePoolWidth_ = 0;
    int framePoolHeight_ = 0;
    int64_t frameIntervalHns_ = 0;
    int64_t lastFrameTimeHns_ = 0;

    bool createD3DDevice();
    winrt::Windows::Graphics::DirectX::Direct3D11::IDirect3DDevice createWinRTDevice();
    winrt::Windows::Graphics::Capture::GraphicsCaptureItem createCaptureItemForMonitor(HMONITOR monitor);
    winrt::Windows::Graphics::Capture::GraphicsCaptureItem createCaptureItemForWindow(HWND hwnd);
    bool initializeWithItem(int fps);
    bool recreateFramePoolIfNeeded(
        winrt::Windows::Graphics::SizeInt32 const& contentSize);
    void onFrameArrived(
        winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool const& sender,
        winrt::Windows::Foundation::IInspectable const& args);
};
