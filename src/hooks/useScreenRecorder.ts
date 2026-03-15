import { useState, useRef, useEffect, useCallback } from "react";
import { fixWebmDuration } from "@fix-webm-duration/fix";

const TARGET_FRAME_RATE = 60;
const TARGET_WIDTH = 3840;
const TARGET_HEIGHT = 2160;
const FOUR_K_PIXELS = TARGET_WIDTH * TARGET_HEIGHT;
const QHD_WIDTH = 2560;
const QHD_HEIGHT = 1440;
const QHD_PIXELS = QHD_WIDTH * QHD_HEIGHT;
const BITRATE_4K = 45_000_000;
const BITRATE_QHD = 28_000_000;
const BITRATE_BASE = 18_000_000;
const HIGH_FRAME_RATE_THRESHOLD = 60;
const HIGH_FRAME_RATE_BOOST = 1.7;
const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;
const CODEC_ALIGNMENT = 2;
const RECORDER_TIMESLICE_MS = 1000;
const BITS_PER_MEGABIT = 1_000_000;
const MIN_FRAME_RATE = 30;
const CHROME_MEDIA_SOURCE = "desktop";
const RECORDING_FILE_PREFIX = "recording-";
const VIDEO_FILE_EXTENSION = ".webm";
const AUDIO_BITRATE_VOICE = 128_000;
const AUDIO_BITRATE_SYSTEM = 192_000;
const MIC_GAIN_BOOST = 1.4;

type UseScreenRecorderReturn = {
  recording: boolean;
  toggleRecording: () => void;
  preparePermissions: (options?: { startup?: boolean }) => Promise<boolean>;
  isMacOS: boolean;
  microphoneEnabled: boolean;
  setMicrophoneEnabled: (enabled: boolean) => void;
  microphoneDeviceId: string | undefined;
  setMicrophoneDeviceId: (deviceId: string | undefined) => void;
  systemAudioEnabled: boolean;
  setSystemAudioEnabled: (enabled: boolean) => void;
};

export function useScreenRecorder(): UseScreenRecorderReturn {
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [isMacOS, setIsMacOS] = useState(false);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
  const [microphoneDeviceId, setMicrophoneDeviceId] = useState<string | undefined>(undefined);
  const [systemAudioEnabled, setSystemAudioEnabled] = useState(false);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const screenStream = useRef<MediaStream | null>(null);
  const microphoneStream = useRef<MediaStream | null>(null);
  const mixingContext = useRef<AudioContext | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startTime = useRef<number>(0);
  const nativeScreenRecording = useRef(false);
  const wgcRecording = useRef(false);
  const startInFlight = useRef(false);
  const hasPromptedForReselect = useRef(false);

  const preparePermissions = useCallback(async (options: { startup?: boolean } = {}) => {
    const platform = await window.electronAPI.getPlatform();
    if (platform !== "darwin") {
      return true;
    }

    const screenPermission = await window.electronAPI.getScreenRecordingPermissionStatus();
    if (!screenPermission.success || screenPermission.status !== "granted") {
      await window.electronAPI.openScreenRecordingPreferences();
      alert(
        options.startup
          ? "Open Recorder needs Screen Recording permission before you start. System Settings has been opened. After enabling it, quit and reopen Open Recorder."
          : "Screen Recording permission is still missing. System Settings has been opened again. Enable it, then quit and reopen Open Recorder before recording.",
      );
      return false;
    }

    const accessibilityPermission = await window.electronAPI.getAccessibilityPermissionStatus();
    if (!accessibilityPermission.success) {
      return false;
    }

    if (accessibilityPermission.trusted) {
      return true;
    }

    const requestedAccessibility = await window.electronAPI.requestAccessibilityPermission();
    if (requestedAccessibility.success && requestedAccessibility.trusted) {
      return true;
    }

    await window.electronAPI.openAccessibilityPreferences();
    alert(
      options.startup
        ? "Open Recorder also needs Accessibility permission for cursor tracking. System Settings has been opened. After enabling it, quit and reopen Open Recorder."
        : "Accessibility permission is still missing. System Settings has been opened again. Enable it, then quit and reopen Open Recorder before recording.",
    );

    return false;
  }, []);

  const selectMimeType = () => {
    const preferred = [
      "video/webm;codecs=av1",
      "video/webm;codecs=h264",
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ];

    return preferred.find((type) => MediaRecorder.isTypeSupported(type)) ?? "video/webm";
  };

  const computeBitrate = (width: number, height: number) => {
    const pixels = width * height;
    const highFrameRateBoost =
      TARGET_FRAME_RATE >= HIGH_FRAME_RATE_THRESHOLD ? HIGH_FRAME_RATE_BOOST : 1;

    if (pixels >= FOUR_K_PIXELS) {
      return Math.round(BITRATE_4K * highFrameRateBoost);
    }

    if (pixels >= QHD_PIXELS) {
      return Math.round(BITRATE_QHD * highFrameRateBoost);
    }

    return Math.round(BITRATE_BASE * highFrameRateBoost);
  };

  const cleanupCapturedMedia = useCallback(() => {
    if (stream.current) {
      stream.current.getTracks().forEach((track) => track.stop());
      stream.current = null;
    }

    if (screenStream.current) {
      screenStream.current.getTracks().forEach((track) => track.stop());
      screenStream.current = null;
    }

    if (microphoneStream.current) {
      microphoneStream.current.getTracks().forEach((track) => track.stop());
      microphoneStream.current = null;
    }

    if (mixingContext.current) {
      mixingContext.current.close().catch(() => {});
      mixingContext.current = null;
    }
  }, []);

  const stopRecording = useRef(() => {
    if (nativeScreenRecording.current) {
      nativeScreenRecording.current = false;
      setRecording(false);

      void (async () => {
        const isWgc = wgcRecording.current;
        wgcRecording.current = false;

        const result = await window.electronAPI.stopNativeScreenRecording();
        window.electronAPI?.setRecordingState(false);

        if (!result.success || !result.path) {
          console.error("Failed to stop native screen recording:", result.error ?? result.message);
          return;
        }

        let finalPath = result.path;

        if (isWgc) {
          const muxResult = await window.electronAPI.muxWgcRecording();
          finalPath = muxResult?.path ?? result.path;
        }

        await window.electronAPI.setCurrentVideoPath(finalPath);
        await window.electronAPI.switchToEditor();
      })();
      return;
    }

    if (mediaRecorder.current?.state === "recording") {
      cleanupCapturedMedia();
      mediaRecorder.current.stop();
      setRecording(false);
      window.electronAPI?.setRecordingState(false);
    }
  });

  useEffect(() => {
    void (async () => {
      const platform = await window.electronAPI.getPlatform();
      setIsMacOS(platform === "darwin");
    })();
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    if (window.electronAPI?.onStopRecordingFromTray) {
      cleanup = window.electronAPI.onStopRecordingFromTray(() => {
        stopRecording.current();
      });
    }

    const removeRecordingStateListener = window.electronAPI?.onRecordingStateChanged?.((state) => {
      setRecording(state.recording);
    });

    const removeRecordingInterruptedListener = window.electronAPI?.onRecordingInterrupted?.((state) => {
      setRecording(false);
      nativeScreenRecording.current = false;
      cleanupCapturedMedia();
      void window.electronAPI.setRecordingState(false);

      if (state.reason === "window-unavailable" && !hasPromptedForReselect.current) {
        hasPromptedForReselect.current = true;
        alert(state.message);
        void window.electronAPI.openSourceSelector();
      } else {
        console.error(state.message);
      }
    });

    return () => {
      cleanup?.();
      removeRecordingStateListener?.();
      removeRecordingInterruptedListener?.();

      if (nativeScreenRecording.current) {
        nativeScreenRecording.current = false;
        void window.electronAPI.stopNativeScreenRecording();
      }

      if (mediaRecorder.current?.state === "recording") {
        mediaRecorder.current.stop();
      }

      cleanupCapturedMedia();
    };
  }, [cleanupCapturedMedia]);

  const startRecording = async () => {
    if (startInFlight.current) {
      return;
    }

    hasPromptedForReselect.current = false;
    startInFlight.current = true;
    setStarting(true);

    try {
      const selectedSource = await window.electronAPI.getSelectedSource();
      if (!selectedSource) {
        alert("Please select a source to record");
        return;
      }

      const permissionsReady = await preparePermissions();
      if (!permissionsReady) {
        return;
      }

      const platform = await window.electronAPI.getPlatform();
      const useNativeMacScreenCapture =
        platform === "darwin" &&
        (selectedSource.id?.startsWith("screen:") || selectedSource.id?.startsWith("window:")) &&
        typeof window.electronAPI.startNativeScreenRecording === "function";

      let useWgcCapture = false;
      if (
        platform === "win32" &&
        (selectedSource.id?.startsWith("screen:") || selectedSource.id?.startsWith("window:")) &&
        typeof window.electronAPI.isWgcAvailable === "function"
      ) {
        try {
          const wgcResult = await window.electronAPI.isWgcAvailable();
          useWgcCapture = wgcResult.available;
        } catch {
          useWgcCapture = false;
        }
      }

      if (useNativeMacScreenCapture || useWgcCapture) {
        // WGC: resolve mic device label for native WASAPI capture
        let micLabel: string | undefined;
        if (useWgcCapture && microphoneEnabled) {
          try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const mic = devices.find(
              (d) => d.deviceId === microphoneDeviceId && d.kind === "audioinput",
            );
            micLabel = mic?.label || undefined;
          } catch {
            // Fall through — native process will use default mic
          }
        }

        const nativeResult = await window.electronAPI.startNativeScreenRecording(selectedSource, {
          capturesSystemAudio: systemAudioEnabled,
          capturesMicrophone: microphoneEnabled,
          microphoneDeviceId,
          microphoneLabel: micLabel,
        });
        if (!nativeResult.success) {
          if (useWgcCapture) {
            console.warn("WGC capture failed, falling back to browser capture:", nativeResult.error ?? nativeResult.message);
          } else {
            throw new Error(
              nativeResult.error ?? nativeResult.message ?? "Failed to start native screen recording",
            );
          }
        }

        if (nativeResult.success) {
          nativeScreenRecording.current = true;
          wgcRecording.current = useWgcCapture;
          startTime.current = Date.now();
          setRecording(true);
          window.electronAPI?.setRecordingState(true);

          return;
        }
      }

      const wantsAudioCapture = microphoneEnabled || systemAudioEnabled;

      try {
        await window.electronAPI.hideOsCursor?.();
      } catch {
        console.warn("Could not hide OS cursor before recording.");
      }

      let videoTrack: MediaStreamTrack | undefined;
      let systemAudioIncluded = false;

      if (wantsAudioCapture) {
        const videoConstraints = {
          mandatory: {
            chromeMediaSource: CHROME_MEDIA_SOURCE,
            chromeMediaSourceId: selectedSource.id,
            maxWidth: TARGET_WIDTH,
            maxHeight: TARGET_HEIGHT,
            maxFrameRate: TARGET_FRAME_RATE,
            minFrameRate: MIN_FRAME_RATE,
          },
        };

        let screenMediaStream: MediaStream;

        if (systemAudioEnabled) {
          try {
            screenMediaStream = await (navigator.mediaDevices as any).getUserMedia({
              audio: {
                mandatory: {
                  chromeMediaSource: CHROME_MEDIA_SOURCE,
                  chromeMediaSourceId: selectedSource.id,
                },
              },
              video: videoConstraints,
            });
          } catch (audioError) {
            console.warn("System audio capture failed, falling back to video-only:", audioError);
            alert("System audio is not available for this source. Recording will continue without system audio.");
            screenMediaStream = await (navigator.mediaDevices as any).getUserMedia({
              audio: false,
              video: videoConstraints,
            });
          }
        } else {
          screenMediaStream = await (navigator.mediaDevices as any).getUserMedia({
            audio: false,
            video: videoConstraints,
          });
        }

        screenStream.current = screenMediaStream;
        stream.current = new MediaStream();

        videoTrack = screenMediaStream.getVideoTracks()[0];
        if (!videoTrack) {
          throw new Error("Video track is not available.");
        }

        stream.current.addTrack(videoTrack);

        if (microphoneEnabled) {
          try {
            microphoneStream.current = await navigator.mediaDevices.getUserMedia({
              audio: microphoneDeviceId
                ? {
                    deviceId: { exact: microphoneDeviceId },
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                  }
                : {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                  },
              video: false,
            });
          } catch (audioError) {
            console.warn("Failed to get microphone access:", audioError);
            alert("Microphone access was denied. Recording will continue without microphone audio.");
            setMicrophoneEnabled(false);
          }
        }

        const systemAudioTrack = screenMediaStream.getAudioTracks()[0];
        const micAudioTrack = microphoneStream.current?.getAudioTracks()[0];

        if (systemAudioTrack && micAudioTrack) {
          const context = new AudioContext();
          mixingContext.current = context;
          const systemSource = context.createMediaStreamSource(new MediaStream([systemAudioTrack]));
          const micSource = context.createMediaStreamSource(new MediaStream([micAudioTrack]));
          const micGain = context.createGain();
          micGain.gain.value = MIC_GAIN_BOOST;
          const destination = context.createMediaStreamDestination();

          systemSource.connect(destination);
          micSource.connect(micGain).connect(destination);

          const mixedTrack = destination.stream.getAudioTracks()[0];
          if (mixedTrack) {
            stream.current.addTrack(mixedTrack);
            systemAudioIncluded = true;
          }
        } else if (systemAudioTrack) {
          stream.current.addTrack(systemAudioTrack);
          systemAudioIncluded = true;
        } else if (micAudioTrack) {
          stream.current.addTrack(micAudioTrack);
        }
      } else {
        const mediaStream = await navigator.mediaDevices.getDisplayMedia({
          audio: false,
          video: {
            displaySurface: selectedSource.id?.startsWith("window:") ? "window" : "monitor",
            width: { ideal: TARGET_WIDTH, max: TARGET_WIDTH },
            height: { ideal: TARGET_HEIGHT, max: TARGET_HEIGHT },
            frameRate: { ideal: TARGET_FRAME_RATE, max: TARGET_FRAME_RATE },
            cursor: "never",
          },
          selfBrowserSurface: "exclude",
          surfaceSwitching: "exclude",
        } as any);

        stream.current = mediaStream;
        videoTrack = mediaStream.getVideoTracks()[0];
      }

      if (!stream.current || !videoTrack) {
        throw new Error("Media stream is not available.");
      }

      try {
        await videoTrack.applyConstraints({
          frameRate: { ideal: TARGET_FRAME_RATE, max: TARGET_FRAME_RATE },
          width: { ideal: TARGET_WIDTH, max: TARGET_WIDTH },
          height: { ideal: TARGET_HEIGHT, max: TARGET_HEIGHT },
        } as MediaTrackConstraints);
      } catch (error) {
        console.warn(
          "Unable to lock 4K/60fps constraints, using best available track settings.",
          error,
        );
      }

      let {
        width = DEFAULT_WIDTH,
        height = DEFAULT_HEIGHT,
        frameRate = TARGET_FRAME_RATE,
      } = videoTrack.getSettings();

      width = Math.floor(width / CODEC_ALIGNMENT) * CODEC_ALIGNMENT;
      height = Math.floor(height / CODEC_ALIGNMENT) * CODEC_ALIGNMENT;

      const videoBitsPerSecond = computeBitrate(width, height);
      const mimeType = selectMimeType();

      console.log(
        `Recording at ${width}x${height} @ ${frameRate ?? TARGET_FRAME_RATE}fps using ${mimeType} / ${Math.round(
          videoBitsPerSecond / BITS_PER_MEGABIT,
        )} Mbps`,
      );

      chunks.current = [];
      const hasAudio = stream.current.getAudioTracks().length > 0;
      const recorder = new MediaRecorder(stream.current, {
        mimeType,
        videoBitsPerSecond,
        ...(hasAudio
          ? { audioBitsPerSecond: systemAudioIncluded ? AUDIO_BITRATE_SYSTEM : AUDIO_BITRATE_VOICE }
          : {}),
      });

      mediaRecorder.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.current.push(event.data);
      };
      recorder.onstop = async () => {
        cleanupCapturedMedia();
        if (chunks.current.length === 0) return;

        const duration = Date.now() - startTime.current;
        const recordedChunks = chunks.current;
        const buggyBlob = new Blob(recordedChunks, { type: mimeType });
        chunks.current = [];
        const timestamp = Date.now();
        const videoFileName = `${RECORDING_FILE_PREFIX}${timestamp}${VIDEO_FILE_EXTENSION}`;

        try {
          const videoBlob = await fixWebmDuration(buggyBlob, duration);
          const arrayBuffer = await videoBlob.arrayBuffer();
          const videoResult = await window.electronAPI.storeRecordedVideo(arrayBuffer, videoFileName);
          if (!videoResult.success) {
            console.error("Failed to store video:", videoResult.message);
            return;
          }

          if (videoResult.path) {
            await window.electronAPI.setCurrentVideoPath(videoResult.path);
          }

          await window.electronAPI.switchToEditor();
        } catch (error) {
          console.error("Error saving recording:", error);
        }
      };
      recorder.onerror = () => {
        setRecording(false);
      };
      recorder.start(RECORDER_TIMESLICE_MS);
      startTime.current = Date.now();
      setRecording(true);
      window.electronAPI?.setRecordingState(true);
    } catch (error) {
      console.error("Failed to start recording:", error);
      alert(error instanceof Error ? `Failed to start recording: ${error.message}` : "Failed to start recording");
      setRecording(false);
      cleanupCapturedMedia();
    } finally {
      startInFlight.current = false;
      setStarting(false);
    }
  };

  const toggleRecording = () => {
    if (starting) {
      return;
    }

    recording ? stopRecording.current() : startRecording();
  };

  return {
    recording,
    toggleRecording,
    preparePermissions,
    isMacOS,
    microphoneEnabled,
    setMicrophoneEnabled,
    microphoneDeviceId,
    setMicrophoneDeviceId,
    systemAudioEnabled,
    setSystemAudioEnabled,
  };
}

