import { contextBridge, ipcRenderer } from 'electron'
import type { CursorTelemetryPoint } from '../src/components/video-editor/types'
import type { RecordingSession } from '../src/lib/recordingSession'

contextBridge.exposeInMainWorld('electronAPI', {
    hudOverlayHide: () => {
      ipcRenderer.send('hud-overlay-hide');
    },
    hudOverlayClose: () => {
      ipcRenderer.send('hud-overlay-close');
    },
  getAssetBasePath: async () => {
    // ask main process for the correct base path (production vs dev)
    return await ipcRenderer.invoke('get-asset-base-path')
  },
  readLocalFile: (filePath: string) => {
    return ipcRenderer.invoke('read-local-file', filePath)
  },
  getSources: async (opts: Electron.SourcesOptions) => {
    return await ipcRenderer.invoke('get-sources', opts)
  },
  switchToEditor: () => {
    return ipcRenderer.invoke('switch-to-editor')
  },
  openSourceSelector: () => {
    return ipcRenderer.invoke('open-source-selector')
  },
  selectSource: (source: any) => {
    return ipcRenderer.invoke('select-source', source)
  },
  getSelectedSource: () => {
    return ipcRenderer.invoke('get-selected-source')
  },
  startNativeScreenRecording: (
    source: any,
    options?: {
      capturesSystemAudio?: boolean
      capturesMicrophone?: boolean
      microphoneDeviceId?: string
      microphoneLabel?: string
    },
  ) => {
    return ipcRenderer.invoke('start-native-screen-recording', source, options)
  },
  stopNativeScreenRecording: () => {
    return ipcRenderer.invoke('stop-native-screen-recording')
  },
  startFfmpegRecording: (source: any) => {
    return ipcRenderer.invoke('start-ffmpeg-recording', source)
  },
  stopFfmpegRecording: () => {
    return ipcRenderer.invoke('stop-ffmpeg-recording')
  },

  storeRecordedVideo: (videoData: ArrayBuffer, fileName: string) => {
    return ipcRenderer.invoke('store-recorded-video', videoData, fileName)
  },
  storeRecordingAsset: (assetData: ArrayBuffer, fileName: string) => {
    return ipcRenderer.invoke('store-recording-asset', assetData, fileName)
  },

  getRecordedVideoPath: () => {
    return ipcRenderer.invoke('get-recorded-video-path')
  },
  setRecordingState: (recording: boolean) => {
    return ipcRenderer.invoke('set-recording-state', recording)
  },
  setCursorScale: (scale: number) => {
    return ipcRenderer.invoke('set-cursor-scale', scale)
  },
  getCursorTelemetry: (videoPath?: string) => {
    return ipcRenderer.invoke('get-cursor-telemetry', videoPath)
  },
  getSystemCursorAssets: () => {
    return ipcRenderer.invoke('get-system-cursor-assets')
  },
  onStopRecordingFromTray: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('stop-recording-from-tray', listener)
    return () => ipcRenderer.removeListener('stop-recording-from-tray', listener)
  },
  onRecordingStateChanged: (callback: (state: { recording: boolean; sourceName: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { recording: boolean; sourceName: string }) => callback(payload)
    ipcRenderer.on('recording-state-changed', listener)
    return () => ipcRenderer.removeListener('recording-state-changed', listener)
  },
  onRecordingInterrupted: (callback: (state: { reason: string; message: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { reason: string; message: string }) => callback(payload)
    ipcRenderer.on('recording-interrupted', listener)
    return () => ipcRenderer.removeListener('recording-interrupted', listener)
  },
  onCursorStateChanged: (callback: (state: { cursorType: CursorTelemetryPoint['cursorType'] }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { cursorType: CursorTelemetryPoint['cursorType'] }) => callback(payload)
    ipcRenderer.on('cursor-state-changed', listener)
    return () => ipcRenderer.removeListener('cursor-state-changed', listener)
  },
  openExternalUrl: (url: string) => {
    return ipcRenderer.invoke('open-external-url', url)
  },
  getAccessibilityPermissionStatus: () => {
    return ipcRenderer.invoke('get-accessibility-permission-status')
  },
  requestAccessibilityPermission: () => {
    return ipcRenderer.invoke('request-accessibility-permission')
  },
  getScreenRecordingPermissionStatus: () => {
    return ipcRenderer.invoke('get-screen-recording-permission-status')
  },
  openScreenRecordingPreferences: () => {
    return ipcRenderer.invoke('open-screen-recording-preferences')
  },
  openAccessibilityPreferences: () => {
    return ipcRenderer.invoke('open-accessibility-preferences')
  },
  saveExportedVideo: (videoData: ArrayBuffer, fileName: string) => {
    return ipcRenderer.invoke('save-exported-video', videoData, fileName)
  },
  openVideoFilePicker: () => {
    return ipcRenderer.invoke('open-video-file-picker')
  },
  setCurrentVideoPath: (path: string) => {
    return ipcRenderer.invoke('set-current-video-path', path)
  },
  setCurrentRecordingSession: (session: RecordingSession | null) => {
    return ipcRenderer.invoke('set-current-recording-session', session)
  },
  getCurrentVideoPath: () => {
    return ipcRenderer.invoke('get-current-video-path')
  },
  getCurrentRecordingSession: () => {
    return ipcRenderer.invoke('get-current-recording-session')
  },
  clearCurrentVideoPath: () => {
    return ipcRenderer.invoke('clear-current-video-path')
  },
  saveProjectFile: (projectData: unknown, suggestedName?: string, existingProjectPath?: string) => {
    return ipcRenderer.invoke('save-project-file', projectData, suggestedName, existingProjectPath)
  },
  loadProjectFile: () => {
    return ipcRenderer.invoke('load-project-file')
  },
  loadCurrentProjectFile: () => {
    return ipcRenderer.invoke('load-current-project-file')
  },
  onMenuLoadProject: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('menu-load-project', listener)
    return () => ipcRenderer.removeListener('menu-load-project', listener)
  },
  onMenuSaveProject: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('menu-save-project', listener)
    return () => ipcRenderer.removeListener('menu-save-project', listener)
  },
  onMenuSaveProjectAs: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('menu-save-project-as', listener)
    return () => ipcRenderer.removeListener('menu-save-project-as', listener)
  },
  getPlatform: () => {
    return ipcRenderer.invoke('get-platform')
  },
  revealInFolder: (filePath: string) => {
    return ipcRenderer.invoke('reveal-in-folder', filePath)
  },
  openRecordingsFolder: () => {
    return ipcRenderer.invoke('open-recordings-folder')
  },
  getRecordingsDirectory: () => {
    return ipcRenderer.invoke('get-recordings-directory')
  },
  chooseRecordingsDirectory: () => {
    return ipcRenderer.invoke('choose-recordings-directory')
  },
  getShortcuts: () => {
    return ipcRenderer.invoke('get-shortcuts')
  },
  saveShortcuts: (shortcuts: unknown) => {
    return ipcRenderer.invoke('save-shortcuts', shortcuts)
  },
  setHasUnsavedChanges: (hasChanges: boolean) => {
    ipcRenderer.send('set-has-unsaved-changes', hasChanges)
  },
  onRequestSaveBeforeClose: (callback: () => Promise<void>) => {
    const listener = async () => {
      await callback()
      ipcRenderer.send('save-before-close-done')
    }
    ipcRenderer.on('request-save-before-close', listener)
    return () => ipcRenderer.removeListener('request-save-before-close', listener)
  },
  isWgcAvailable: () => ipcRenderer.invoke('is-wgc-available'),
  muxWgcRecording: () => ipcRenderer.invoke('mux-wgc-recording'),
  // Cursor visibility control for cursor-free browser capture fallback
  hideOsCursor: () => ipcRenderer.invoke('hide-cursor'),
})
