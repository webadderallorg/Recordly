/// <reference types="vite-plugin-electron/electron-env" />

import type { RecordingSession } from "@/lib/recordingSession";

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      APP_ROOT: string;
      VITE_PUBLIC: string;
    }
  }

  interface ProcessedDesktopSource {
    id: string;
    name: string;
    display_id: string;
    thumbnail: string | null;
    appIcon: string | null;
    originalName?: string;
    sourceType?: "screen" | "window";
    appName?: string;
    windowTitle?: string;
  }

  interface CursorTelemetryPoint {
    timeMs: number;
    cx: number;
    cy: number;
    interactionType?:
      | "move"
      | "click"
      | "double-click"
      | "right-click"
      | "middle-click"
      | "mouseup";
    cursorType?:
      | "arrow"
      | "text"
      | "pointer"
      | "crosshair"
      | "open-hand"
      | "closed-hand"
      | "resize-ew"
      | "resize-ns"
      | "not-allowed";
  }

  interface SystemCursorAsset {
    dataUrl: string;
    hotspotX: number;
    hotspotY: number;
    width: number;
    height: number;
  }

  interface Window {
    electronAPI: {
      getSources: (opts: Electron.SourcesOptions) => Promise<ProcessedDesktopSource[]>;
      switchToEditor: () => Promise<void>;
      openSourceSelector: () => Promise<void>;
      selectSource: (source: any) => Promise<any>;
      getSelectedSource: () => Promise<any>;
      startNativeScreenRecording: (
        source: any,
        options?: {
          capturesSystemAudio?: boolean;
          capturesMicrophone?: boolean;
          microphoneDeviceId?: string;
          microphoneLabel?: string;
        },
      ) => Promise<{
        success: boolean;
        path?: string;
        message?: string;
        error?: string;
      }>;
      stopNativeScreenRecording: () => Promise<{
        success: boolean;
        path?: string;
        message?: string;
        error?: string;
      }>;
      startFfmpegRecording: (source: any) => Promise<{
        success: boolean;
        path?: string;
        message?: string;
        error?: string;
      }>;
      stopFfmpegRecording: () => Promise<{
        success: boolean;
        path?: string;
        message?: string;
        error?: string;
      }>;
      storeRecordedVideo: (videoData: ArrayBuffer, fileName: string) => Promise<{
        success: boolean;
        path?: string;
        message?: string;
      }>;
      storeRecordingAsset: (assetData: ArrayBuffer, fileName: string) => Promise<{
        success: boolean;
        path?: string;
        message?: string;
        error?: string;
      }>;
      getRecordedVideoPath: () => Promise<{
        success: boolean;
        path?: string;
        message?: string;
      }>;
      readLocalFile: (filePath: string) => Promise<{
        success: boolean;
        data?: Uint8Array;
        error?: string;
      }>;
      setRecordingState: (recording: boolean) => Promise<void>;
      getCursorTelemetry: (videoPath?: string) => Promise<{
        success: boolean;
        samples: CursorTelemetryPoint[];
        message?: string;
        error?: string;
      }>;
      getSystemCursorAssets: () => Promise<{
        success: boolean;
        cursors: Record<string, SystemCursorAsset>;
        error?: string;
      }>;
      onStopRecordingFromTray: (callback: () => void) => () => void;
      onRecordingStateChanged: (
        callback: (state: { recording: boolean; sourceName: string }) => void,
      ) => () => void;
      onRecordingInterrupted: (
        callback: (state: { reason: string; message: string }) => void,
      ) => () => void;
      onCursorStateChanged: (
        callback: (state: { cursorType: CursorTelemetryPoint["cursorType"] }) => void,
      ) => () => void;
      openExternalUrl: (url: string) => Promise<{ success: boolean; error?: string }>;
      getAccessibilityPermissionStatus: () => Promise<{
        success: boolean;
        trusted: boolean;
        prompted: boolean;
        error?: string;
      }>;
      requestAccessibilityPermission: () => Promise<{
        success: boolean;
        trusted: boolean;
        prompted: boolean;
        error?: string;
      }>;
      getScreenRecordingPermissionStatus: () => Promise<{
        success: boolean;
        status: string;
        error?: string;
      }>;
      openScreenRecordingPreferences: () => Promise<{ success: boolean; error?: string }>;
      openAccessibilityPreferences: () => Promise<{ success: boolean; error?: string }>;
      saveExportedVideo: (videoData: ArrayBuffer, fileName: string) => Promise<{
        success: boolean;
        path?: string;
        message?: string;
        canceled?: boolean;
      }>;
      openVideoFilePicker: () => Promise<{ success: boolean; path?: string; canceled?: boolean }>;
      setCurrentVideoPath: (path: string) => Promise<{ success: boolean }>;
      setCurrentRecordingSession: (
        session: RecordingSession | null,
      ) => Promise<{ success: boolean }>;
      getCurrentVideoPath: () => Promise<{ success: boolean; path?: string }>;
      getCurrentRecordingSession: () => Promise<{
        success: boolean;
        session?: RecordingSession;
      }>;
      clearCurrentVideoPath: () => Promise<{ success: boolean }>;
      saveProjectFile: (
        projectData: unknown,
        suggestedName?: string,
        existingProjectPath?: string,
      ) => Promise<{
        success: boolean;
        path?: string;
        message?: string;
        canceled?: boolean;
        error?: string;
      }>;
      loadProjectFile: () => Promise<{
        success: boolean;
        path?: string;
        project?: unknown;
        message?: string;
        canceled?: boolean;
        error?: string;
      }>;
      loadCurrentProjectFile: () => Promise<{
        success: boolean;
        path?: string;
        project?: unknown;
        message?: string;
        canceled?: boolean;
        error?: string;
      }>;
      onMenuLoadProject: (callback: () => void) => () => void;
      onMenuSaveProject: (callback: () => void) => () => void;
      onMenuSaveProjectAs: (callback: () => void) => () => void;
      getPlatform: () => Promise<string>;
      revealInFolder: (
        filePath: string,
      ) => Promise<{ success: boolean; error?: string; message?: string }>;
      openRecordingsFolder: () => Promise<{
        success: boolean;
        error?: string;
        message?: string;
      }>;
      getRecordingsDirectory: () => Promise<{
        success: boolean;
        path: string;
        isDefault: boolean;
        error?: string;
      }>;
      chooseRecordingsDirectory: () => Promise<{
        success: boolean;
        canceled?: boolean;
        path?: string;
        isDefault?: boolean;
        message?: string;
        error?: string;
      }>;
      getShortcuts: () => Promise<Record<string, unknown> | null>;
      saveShortcuts: (
        shortcuts: unknown,
      ) => Promise<{ success: boolean; error?: string }>;
      hudOverlayHide: () => void;
      hudOverlayClose: () => void;
      setHasUnsavedChanges: (hasChanges: boolean) => void;
      onRequestSaveBeforeClose: (callback: () => Promise<void>) => () => void;
      isWgcAvailable: () => Promise<{ available: boolean }>;
      muxWgcRecording: () => Promise<{
        success: boolean;
        path?: string;
        message?: string;
        error?: string;
      }>;
      hideOsCursor: () => Promise<{ success: boolean }>;
      getAssetBasePath: () => Promise<string | null>;
    };
  }
}

export {};
