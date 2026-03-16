import { useEffect, useRef, useState } from "react";
import { BsRecordCircle } from "react-icons/bs";
import { FaRegStopCircle } from "react-icons/fa";
import { FaFolderOpen } from "react-icons/fa6";
import { FiMinus, FiX } from "react-icons/fi";
import { MdMic, MdMicOff, MdMonitor, MdVideocam, MdVideocamOff, MdVideoFile, MdVolumeOff, MdVolumeUp } from "react-icons/md";
import { useCameraDevices } from "../../hooks/useCameraDevices";
import { RxDragHandleDots2 } from "react-icons/rx";
import { useAudioLevelMeter } from "../../hooks/useAudioLevelMeter";
import { useMicrophoneDevices } from "../../hooks/useMicrophoneDevices";
import { useScreenRecorder } from "../../hooks/useScreenRecorder";
import { Button } from "../ui/button";
import { AudioLevelMeter } from "../ui/audio-level-meter";
import { ContentClamp } from "../ui/content-clamp";
import styles from "./LaunchWindow.module.css";

export function LaunchWindow() {
  const {
    recording,
    toggleRecording,
    microphoneEnabled,
    setMicrophoneEnabled,
    microphoneDeviceId,
    setMicrophoneDeviceId,
    systemAudioEnabled,
    setSystemAudioEnabled,
    cameraEnabled,
    setCameraEnabled,
    cameraDeviceId,
    setCameraDeviceId,
  } = useScreenRecorder();
  const [recordingStart, setRecordingStart] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const showMicControls = microphoneEnabled && !recording;
  const showCameraControls = cameraEnabled && !recording;
  const { devices, selectedDeviceId, setSelectedDeviceId } = useMicrophoneDevices(microphoneEnabled);
  const {
    devices: cameraDevices,
    selectedDeviceId: selectedCameraDeviceId,
    setSelectedDeviceId: setSelectedCameraDeviceId,
  } = useCameraDevices(cameraEnabled);
  const { level } = useAudioLevelMeter({
    enabled: showMicControls,
    deviceId: microphoneDeviceId,
  });
  const cameraPreviewRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (selectedDeviceId && selectedDeviceId !== "default") {
      setMicrophoneDeviceId(selectedDeviceId);
    }
  }, [selectedDeviceId, setMicrophoneDeviceId]);

  useEffect(() => {
    if (selectedCameraDeviceId && selectedCameraDeviceId !== "default") {
      setCameraDeviceId(selectedCameraDeviceId);
    }
  }, [selectedCameraDeviceId, setCameraDeviceId]);

  useEffect(() => {
    if (!showCameraControls) {
      if (cameraPreviewRef.current) {
        cameraPreviewRef.current.srcObject = null;
      }
      return;
    }

    let mounted = true;
    let previewStream: MediaStream | null = null;

    const loadPreview = async () => {
      try {
        previewStream = await navigator.mediaDevices.getUserMedia({
          video: cameraDeviceId
            ? {
                deviceId: { exact: cameraDeviceId },
                width: { ideal: 640, max: 640 },
                height: { ideal: 360, max: 360 },
                frameRate: { ideal: 30, max: 30 },
              }
            : {
                width: { ideal: 640, max: 640 },
                height: { ideal: 360, max: 360 },
                frameRate: { ideal: 30, max: 30 },
              },
          audio: false,
        });

        if (!mounted || !cameraPreviewRef.current) {
          previewStream?.getTracks().forEach((track) => track.stop());
          return;
        }

        cameraPreviewRef.current.srcObject = previewStream;
        await cameraPreviewRef.current.play().catch(() => {});
      } catch (error) {
        console.error("Failed to load facecam preview:", error);
      }
    };

    void loadPreview();

    return () => {
      mounted = false;
      if (cameraPreviewRef.current) {
        cameraPreviewRef.current.srcObject = null;
      }
      previewStream?.getTracks().forEach((track) => track.stop());
    };
  }, [cameraDeviceId, showCameraControls]);

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (recording) {
      if (!recordingStart) setRecordingStart(Date.now());
      timer = setInterval(() => {
        if (recordingStart) {
          setElapsed(Math.floor((Date.now() - recordingStart) / 1000));
        }
      }, 1000);
    } else {
      setRecordingStart(null);
      setElapsed(0);
      if (timer) clearInterval(timer);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [recording, recordingStart]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const [selectedSource, setSelectedSource] = useState("Screen");
  const [hasSelectedSource, setHasSelectedSource] = useState(false);
  const [recordingsDirectory, setRecordingsDirectory] = useState<string | null>(null);

  useEffect(() => {
    const checkSelectedSource = async () => {
      if (window.electronAPI) {
        const source = await window.electronAPI.getSelectedSource();
        if (source) {
          setSelectedSource(source.name);
          setHasSelectedSource(true);
        } else {
          setSelectedSource("Screen");
          setHasSelectedSource(false);
        }
      }
    };

    void checkSelectedSource();
    const interval = setInterval(checkSelectedSource, 500);
    return () => clearInterval(interval);
  }, []);

  const openSourceSelector = () => {
    window.electronAPI?.openSourceSelector();
  };

  const openVideoFile = async () => {
    const result = await window.electronAPI.openVideoFilePicker();
    if (result.canceled) {
      return;
    }

    if (result.success && result.path) {
      await window.electronAPI.setCurrentVideoPath(result.path);
      await window.electronAPI.switchToEditor();
    }
  };

  const openProjectFile = async () => {
    const result = await window.electronAPI.loadProjectFile();
    if (result.canceled || !result.success) {
      return;
    }
    await window.electronAPI.switchToEditor();
  };

  const sendHudOverlayHide = () => {
    window.electronAPI?.hudOverlayHide?.();
  };

  const sendHudOverlayClose = () => {
    window.electronAPI?.hudOverlayClose?.();
  };

  const chooseRecordingsDirectory = async () => {
    const result = await window.electronAPI.chooseRecordingsDirectory();
    if (result.canceled) {
      return;
    }
    if (result.success && result.path) {
      setRecordingsDirectory(result.path);
    }
  };

  useEffect(() => {
    const loadRecordingsDirectory = async () => {
      const result = await window.electronAPI.getRecordingsDirectory();
      if (result.success) {
        setRecordingsDirectory(result.path);
      }
    };

    void loadRecordingsDirectory();
  }, []);

  const recordingsDirectoryName = recordingsDirectory
    ? recordingsDirectory.split(/[\\/]/).filter(Boolean).pop() || recordingsDirectory
    : "recordings";
  const dividerClass = "mx-1 h-5 w-px shrink-0 bg-white/35";

  const toggleMicrophone = () => {
    if (!recording) {
      setMicrophoneEnabled(!microphoneEnabled);
    }
  };

  const toggleCamera = () => {
    if (!recording) {
      setCameraEnabled(!cameraEnabled);
    }
  };

  return (
    <div className="w-full h-full flex items-end justify-center bg-transparent overflow-hidden">
      <div className={`flex flex-col items-center gap-2 mx-auto ${styles.electronDrag}`}>
        {showCameraControls && (
          <div
            className={`flex items-center gap-3 rounded-[22px] border border-white/15 bg-[rgba(18,18,26,0.92)] px-3 py-2 shadow-xl backdrop-blur-xl ${styles.electronNoDrag}`}
          >
            <div className="h-14 w-24 overflow-hidden rounded-2xl border border-white/10 bg-black/30">
              <video
                ref={cameraPreviewRef}
                className="h-full w-full object-cover"
                muted
                playsInline
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="text-[10px] font-medium tracking-[0.18em] uppercase text-white/50">Facecam</div>
              <select
                value={cameraDeviceId || selectedCameraDeviceId}
                onChange={(event) => {
                  setSelectedCameraDeviceId(event.target.value);
                  setCameraDeviceId(event.target.value);
                }}
                className={`max-w-[230px] rounded-full border border-white/15 bg-[#131722] px-3 py-1 text-xs text-slate-100 outline-none ${styles.micSelect}`}
              >
                {cameraDevices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {showMicControls && (
          <div
            className={`flex items-center gap-2 rounded-full border border-white/15 bg-[rgba(18,18,26,0.92)] px-3 py-2 shadow-xl backdrop-blur-xl ${styles.electronNoDrag}`}
          >
            <select
              value={microphoneDeviceId || selectedDeviceId}
              onChange={(event) => {
                setSelectedDeviceId(event.target.value);
                setMicrophoneDeviceId(event.target.value);
              }}
              className={`max-w-[230px] rounded-full border border-white/15 bg-[#131722] px-3 py-1 text-xs text-slate-100 outline-none ${styles.micSelect}`}
            >
              {devices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </option>
              ))}
            </select>
            <AudioLevelMeter level={level} className="w-24" />
          </div>
        )}

        <div
          className={`w-full mx-auto flex items-center gap-1.5 px-3 py-2 ${styles.electronDrag} ${styles.hudBar}`}
          style={{
            borderRadius: 9999,
            background: "linear-gradient(135deg, rgba(28,28,36,0.97) 0%, rgba(18,18,26,0.96) 100%)",
            backdropFilter: "blur(16px) saturate(140%)",
            WebkitBackdropFilter: "blur(16px) saturate(140%)",
            border: "1px solid rgba(80,80,120,0.25)",
            minHeight: 48,
          }}
        >
          <div className={`flex items-center px-1 ${styles.electronDrag}`}>
            <RxDragHandleDots2 size={16} className="text-white/35" />
          </div>

          <Button
            variant="link"
            size="sm"
            className={`gap-1 text-white/80 bg-transparent hover:bg-transparent px-0 text-xs ${styles.electronNoDrag}`}
            onClick={openSourceSelector}
            disabled={recording}
            title={selectedSource}
          >
            <MdMonitor size={14} className="text-white/80" />
            <ContentClamp truncateLength={6}>{selectedSource}</ContentClamp>
          </Button>

          <div className={dividerClass} />

          <div className={`flex items-center gap-1 ${styles.electronNoDrag}`}>
            <Button
              variant="link"
              size="icon"
              onClick={() => !recording && setSystemAudioEnabled(!systemAudioEnabled)}
              disabled={recording}
              title={systemAudioEnabled ? "Disable system audio" : "Enable system audio"}
              className="text-white/80 hover:bg-transparent"
            >
              {systemAudioEnabled ? <MdVolumeUp size={16} className="text-[#2563EB]" /> : <MdVolumeOff size={16} className="text-white/35" />}
            </Button>
            <Button
              variant="link"
              size="icon"
              onClick={toggleMicrophone}
              disabled={recording}
              title={microphoneEnabled ? "Disable microphone" : "Enable microphone"}
              className="text-white/80 hover:bg-transparent"
            >
              {microphoneEnabled ? <MdMic size={16} className="text-[#2563EB]" /> : <MdMicOff size={16} className="text-white/35" />}
            </Button>
            <Button
              variant="link"
              size="icon"
              onClick={toggleCamera}
              disabled={recording}
              title={cameraEnabled ? "Disable facecam" : "Enable facecam"}
              className="text-white/80 hover:bg-transparent"
            >
              {cameraEnabled ? <MdVideocam size={16} className="text-[#2563EB]" /> : <MdVideocamOff size={16} className="text-white/35" />}
            </Button>
          </div>

          <div className={dividerClass} />

          <Button
            variant="link"
            size="sm"
            onClick={hasSelectedSource ? toggleRecording : openSourceSelector}
            disabled={!hasSelectedSource && !recording}
            className={`gap-1 text-white bg-transparent hover:bg-transparent px-0 text-xs ${styles.electronNoDrag}`}
          >
            {recording ? (
              <>
                <FaRegStopCircle size={14} className="text-red-400" />
                <span className="text-red-400 font-medium tabular-nums">{formatTime(elapsed)}</span>
              </>
            ) : (
              <>
                <BsRecordCircle size={14} className={hasSelectedSource ? "text-white/85" : "text-white/35"} />
                <span className={hasSelectedSource ? "text-white/80" : "text-white/35"}>Record</span>
              </>
            )}
          </Button>

          <Button
            variant="link"
            size="sm"
            onClick={chooseRecordingsDirectory}
            disabled={recording}
            title={recordingsDirectory ? `Recording folder: ${recordingsDirectory}` : "Choose recordings folder"}
            className={`text-white/75 hover:bg-transparent px-1 text-[11px] underline decoration-white/45 underline-offset-2 ${styles.electronNoDrag}`}
          >
            <ContentClamp truncateLength={18}>{`Path: /${recordingsDirectoryName}/`}</ContentClamp>
          </Button>

          <div className="ml-auto flex items-center gap-0.5">
            <div className={dividerClass} />
            <Button
              variant="link"
              size="icon"
              onClick={openVideoFile}
              disabled={recording}
              title="Open video file"
              className={`text-white/70 hover:bg-transparent ${styles.electronNoDrag}`}
            >
              <MdVideoFile size={15} />
            </Button>
            <Button
              variant="link"
              size="icon"
              onClick={openProjectFile}
              disabled={recording}
              title="Open project"
              className={`text-white/70 hover:bg-transparent ${styles.electronNoDrag}`}
            >
              <FaFolderOpen size={14} />
            </Button>
            <div className={dividerClass} />
            <Button
              variant="link"
              size="icon"
              onClick={sendHudOverlayHide}
              title="Hide HUD"
              className={`text-white/70 hover:bg-transparent ${styles.electronNoDrag}`}
            >
              <FiMinus size={16} />
            </Button>
            <Button
              variant="link"
              size="icon"
              onClick={sendHudOverlayClose}
              title="Close App"
              className={`text-white/70 hover:bg-transparent ${styles.electronNoDrag}`}
            >
              <FiX size={16} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
