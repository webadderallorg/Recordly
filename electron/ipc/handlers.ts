import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { execFile, spawn, spawnSync } from 'node:child_process'
import { createWriteStream, constants as fsConstants, existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import { get as httpsGet } from 'node:https'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import type { SaveDialogOptions } from 'electron'
import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, shell, systemPreferences, screen } from 'electron'
import { RECORDINGS_DIR, USER_DATA_PATH } from '../appPaths'
import { hideCursor, showCursor } from '../cursorHider'
import { closeCountdownWindow, createCountdownWindow, getCountdownWindow, createAreaHighlightWindow } from '../windows'
import { resolveWindowsCaptureDisplay } from './windowsCaptureSelection'

const execFileAsync = promisify(execFile)
const nodeRequire = createRequire(import.meta.url)

const PROJECT_FILE_EXTENSION = 'recordly'
const LEGACY_PROJECT_FILE_EXTENSIONS = ['openscreen']
const PROJECTS_DIRECTORY_NAME = 'Projects'
const PROJECT_THUMBNAIL_SUFFIX = '.preview.png'
const RECENT_PROJECTS_FILE = path.join(USER_DATA_PATH, 'recent-projects.json')
const MAX_RECENT_PROJECTS = 16
const SHORTCUTS_FILE = path.join(USER_DATA_PATH, 'shortcuts.json')
const RECORDINGS_SETTINGS_FILE = path.join(USER_DATA_PATH, 'recordings-settings.json')
const COUNTDOWN_SETTINGS_FILE = path.join(USER_DATA_PATH, 'countdown-settings.json')
const AUTO_RECORDING_PREFIX = 'recording-'
const AUTO_RECORDING_RETENTION_COUNT = 20
const AUTO_RECORDING_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000
const ALLOW_RECORDLY_WINDOW_CAPTURE = Boolean(process.env['VITE_DEV_SERVER_URL'])
const RECORDING_SESSION_MANIFEST_SUFFIX = '.recordly-session.json'
const WHISPER_MODEL_DOWNLOAD_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin'
const WHISPER_MODEL_DIR = path.join(USER_DATA_PATH, 'whisper')
const WHISPER_SMALL_MODEL_PATH = path.join(WHISPER_MODEL_DIR, 'ggml-small.bin')
const COMPANION_AUDIO_LAYOUTS = [
  { platform: 'mac' as const, systemSuffix: '.system.m4a', micSuffix: '.mic.m4a' },
  { platform: 'win' as const, systemSuffix: '.system.wav', micSuffix: '.mic.wav' },
]

function getAssetRootPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'assets')
  }

  return path.join(app.getAppPath(), 'public')
}

function getScreen() {
  if (!app.isReady()) {
    throw new Error("getScreen() called before app is ready. Ensure all screen access happens after app.whenReady().")
  }
  return nodeRequire('electron').screen as typeof import('electron').screen
}

function normalizeRecordingTimeOffsetMs(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value)
    : 0
}

function broadcastSelectedSourceChange() {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('selected-source-changed', selectedSource)
    }
  }
}

type SelectedSource = {
  id?: string
  name: string
  display_id?: string
  sourceType?: 'screen' | 'window'
  appName?: string
  windowTitle?: string
  [key: string]: unknown
}

type NativeMacRecordingOptions = {
  capturesSystemAudio?: boolean
  capturesMicrophone?: boolean
  microphoneDeviceId?: string
  microphoneLabel?: string
}

type WindowBounds = {
  x: number
  y: number
  width: number
  height: number
}

type NativeCaptureDiagnostics = {
  backend: 'windows-wgc' | 'mac-screencapturekit' | 'browser-store' | 'ffmpeg'
  phase: 'availability' | 'start' | 'stop' | 'mux'
  timestamp: string
  sourceId?: string | null
  sourceType?: SelectedSource['sourceType'] | 'unknown'
  displayId?: number | null
  displayBounds?: WindowBounds | null
  windowHandle?: number | null
  helperPath?: string | null
  outputPath?: string | null
  systemAudioPath?: string | null
  microphonePath?: string | null
  osRelease?: string
  supported?: boolean
  helperExists?: boolean
  fileSizeBytes?: number | null
  processOutput?: string
  error?: string
}

type RecordingSessionData = {
  videoPath: string
  webcamPath?: string | null
  timeOffsetMs?: number
}

type PauseSegment = {
  startMs: number
  endMs: number
}

type RecordingSessionManifest = {
  version: 1 | 2
  videoFileName: string
  webcamFileName?: string | null
  timeOffsetMs?: number
}

type ProjectLibraryEntry = {
  path: string
  name: string
  updatedAt: number
  thumbnailPath: string | null
  isCurrent: boolean
  isInProjectsDirectory: boolean
}

let selectedSource: SelectedSource | null = null
let selectedArea: WindowBounds | null = null
let previousScreenSource: SelectedSource | null = null
let selectorWindowOrigin = { x: 0, y: 0 }
let currentProjectPath: string | null = null
let nativeScreenRecordingActive = false
let currentVideoPath: string | null = null
let currentRecordingSession: RecordingSessionData | null = null
let nativeCaptureProcess: ChildProcessWithoutNullStreams | null = null
let nativeCaptureOutputBuffer = ''
let nativeCaptureTargetPath: string | null = null
let nativeCaptureStopRequested = false
let nativeCaptureSystemAudioPath: string | null = null
let nativeCaptureMicrophonePath: string | null = null
let nativeCapturePaused = false
let nativeCursorMonitorProcess: ChildProcessWithoutNullStreams | null = null
let nativeCursorMonitorOutputBuffer = ''
let windowsCaptureProcess: ChildProcessWithoutNullStreams | null = null
let windowsCaptureOutputBuffer = ''
let windowsCaptureTargetPath: string | null = null
let areaHighlightWindow: BrowserWindow | null = null
let windowsNativeCaptureActive = false
let windowsCaptureStopRequested = false
let windowsCapturePaused = false
let windowsSystemAudioPath: string | null = null
let windowsMicAudioPath: string | null = null
let windowsPendingVideoPath: string | null = null
let lastNativeCaptureDiagnostics: NativeCaptureDiagnostics | null = null
let ffmpegScreenRecordingActive = false
let ffmpegCaptureProcess: ChildProcessWithoutNullStreams | null = null
let ffmpegCaptureOutputBuffer = ''
let ffmpegCaptureTargetPath: string | null = null
let customRecordingsDir: string | null = null
let recordingsDirLoaded = false
let cachedSystemCursorAssets: Record<string, SystemCursorAsset> | null = null
let cachedSystemCursorAssetsSourceMtimeMs: number | null = null
let countdownTimer: ReturnType<typeof setInterval> | null = null
let countdownCancelled = false
let countdownInProgress = false
let countdownRemaining: number | null = null
let countdownResolve: ((value: { success: boolean; cancelled?: boolean }) => void) | null = null


function stopCountdown(result: { success: boolean; cancelled?: boolean } = { success: false, cancelled: true }) {
  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
  if (countdownResolve) {
    countdownResolve(result)
    countdownResolve = null
  }
  closeCountdownWindow()
  if (areaHighlightWindow) {
    areaHighlightWindow.close()
    areaHighlightWindow = null
  }
  countdownInProgress = false
  countdownRemaining = null
}

type SystemCursorAsset = {
  dataUrl: string
  hotspotX: number
  hotspotY: number
  width: number
  height: number
}

type CursorVisualType = 'arrow' | 'text' | 'pointer' | 'crosshair' | 'open-hand' | 'closed-hand' | 'resize-ew' | 'resize-ns' | 'not-allowed'

let currentCursorVisualType: CursorVisualType | undefined = undefined

/** Returns the currently selected source ID for setDisplayMediaRequestHandler */
export function getSelectedSourceId(): string | null {
  return selectedSource?.id as string | null ?? null
}

export function killWindowsCaptureProcess() {
  if (windowsCaptureProcess) {
    try { windowsCaptureProcess.kill() } catch { /* ignore */ }
    windowsCaptureProcess = null
    windowsCaptureTargetPath = null
    windowsNativeCaptureActive = false
    nativeScreenRecordingActive = false
    windowsCaptureStopRequested = false
    windowsCapturePaused = false
    windowsSystemAudioPath = null
    windowsMicAudioPath = null
    windowsPendingVideoPath = null
  }
}

function normalizePath(filePath: string) {
  return path.resolve(filePath)
}

function normalizeDesktopSourceName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function hasUsableSourceThumbnail(
  thumbnail:
    | {
        isEmpty: () => boolean
        getSize: () => { width: number; height: number }
      }
    | null
    | undefined,
) {
  if (!thumbnail || thumbnail.isEmpty()) {
    return false
  }

  const size = thumbnail.getSize()
  return size.width > 1 && size.height > 1
}

function getMacPrivacySettingsUrl(pane: 'screen' | 'accessibility' | 'microphone') {
  if (pane === 'screen') return 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
  if (pane === 'microphone') return 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
  return 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
}

function isAutoRecordingPath(filePath: string) {
  return path.basename(filePath).startsWith(AUTO_RECORDING_PREFIX)
}

function getTelemetryPathForVideo(videoPath: string) {
  return `${videoPath}.cursor.json`
}

async function loadRecordingsDirectorySetting() {
  if (recordingsDirLoaded) {
    return
  }

  recordingsDirLoaded = true

  try {
    const content = await fs.readFile(RECORDINGS_SETTINGS_FILE, 'utf-8')
    const parsed = JSON.parse(content) as { recordingsDir?: unknown }
    if (typeof parsed.recordingsDir === 'string' && parsed.recordingsDir.trim()) {
      customRecordingsDir = path.resolve(parsed.recordingsDir)
    }
  } catch {
    customRecordingsDir = null
  }
}

async function getRecordingsDir() {
  await loadRecordingsDirectorySetting()
  const targetDir = customRecordingsDir ?? RECORDINGS_DIR
  await fs.mkdir(targetDir, { recursive: true })
  return targetDir
}

function recordNativeCaptureDiagnostics(
  diagnostics: Omit<NativeCaptureDiagnostics, 'timestamp'>,
) {
  lastNativeCaptureDiagnostics = {
    timestamp: new Date().toISOString(),
    ...diagnostics,
  }

  return lastNativeCaptureDiagnostics
}

async function getFileSizeIfPresent(filePath: string | null | undefined) {
  if (!filePath) {
    return null
  }

  try {
    const stat = await fs.stat(filePath)
    return stat.size
  } catch {
    return null
  }
}

function parseFfmpegDurationSeconds(stderr: string) {
  const match = stderr.match(/Duration:\s+(\d+):(\d+):(\d+(?:\.\d+)?)/i)
  if (!match) {
    return null
  }

  const hours = Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  if (![hours, minutes, seconds].every(Number.isFinite)) {
    return null
  }

  return hours * 3600 + minutes * 60 + seconds
}

type CompanionAudioCandidate = {
  platform: (typeof COMPANION_AUDIO_LAYOUTS)[number]['platform']
  systemPath: string
  micPath: string
  usablePaths: string[]
}

async function getUsableCompanionAudioCandidates(videoPath: string): Promise<CompanionAudioCandidate[]> {
  const basePath = videoPath.replace(/\.[^.]+$/u, '')
  const candidates: CompanionAudioCandidate[] = []

  for (const layout of COMPANION_AUDIO_LAYOUTS) {
    const systemPath = `${basePath}${layout.systemSuffix}`
    const micPath = `${basePath}${layout.micSuffix}`
    const usablePaths: string[] = []

    for (const companionPath of [systemPath, micPath]) {
      try {
        const stat = await fs.stat(companionPath)
        if (stat.size > 0) {
          usablePaths.push(companionPath)
        }
      } catch {
        // Missing companion audio is expected for many recordings.
      }
    }

    if (usablePaths.length > 0) {
      candidates.push({
        platform: layout.platform,
        systemPath,
        micPath,
        usablePaths,
      })
    }
  }

  return candidates
}

async function hasEmbeddedAudioStream(videoPath: string) {
  const ffmpegPath = getFfmpegBinaryPath()
  let stderr = ''

  try {
    const result = await execFileAsync(
      ffmpegPath,
      ['-hide_banner', '-i', videoPath, '-map', '0:a:0', '-frames:a', '1', '-f', 'null', '-'],
      { timeout: 20000, maxBuffer: 10 * 1024 * 1024 },
    )
    stderr = result.stderr
  } catch (error) {
    stderr = (error as NodeJS.ErrnoException & { stderr?: string }).stderr ?? ''
  }

  return /Stream #.*Audio:/i.test(stderr)
}

async function getCompanionAudioFallbackPaths(videoPath: string) {
  const companionCandidates = await getUsableCompanionAudioCandidates(videoPath)
  if (companionCandidates.length === 0) {
    return []
  }

  if (await hasEmbeddedAudioStream(videoPath)) {
    return []
  }

  return companionCandidates.flatMap((candidate) => candidate.usablePaths)
}

async function validateRecordedVideo(videoPath: string) {
  const stat = await fs.stat(videoPath)
  if (!stat.isFile()) {
    throw new Error(`Recorded output is not a file: ${videoPath}`)
  }

  if (stat.size <= 0) {
    throw new Error(`Recorded output is empty: ${videoPath}`)
  }

  const ffmpegPath = getFfmpegBinaryPath()
  let stderr = ''

  try {
    const result = await execFileAsync(
      ffmpegPath,
      ['-hide_banner', '-i', videoPath, '-f', 'null', '-'],
      { timeout: 20000, maxBuffer: 10 * 1024 * 1024 },
    )
    stderr = result.stderr + result.stdout
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string }
    stderr = (execError.stderr ?? '') + (execError.stdout ?? '')

    // FFmpeg exits with code 1 if it just shows info, but if it truly fails to parse, we error
    if (!/Stream #.*Video:/i.test(stderr)) {
      throw new Error(`Recorded output is not a valid video file: ${videoPath}`)
    }
  }

  if (!/Stream #.*Video:/i.test(stderr)) {
    throw new Error(`Recorded output does not contain a readable video stream (too short?): ${videoPath}`)
  }

  const durationSeconds = parseFfmpegDurationSeconds(stderr)
  if (durationSeconds !== null && durationSeconds <= 0) {
    throw new Error(`Recorded output has an invalid duration: ${videoPath}`)
  }

  return {
    fileSizeBytes: stat.size,
    durationSeconds,
  }
}

async function getProjectsDir() {
  const projectsDir = path.join(await getRecordingsDir(), PROJECTS_DIRECTORY_NAME)
  await fs.mkdir(projectsDir, { recursive: true })
  return projectsDir
}

async function persistRecordingsDirectorySetting(nextDir: string) {
  customRecordingsDir = path.resolve(nextDir)
  recordingsDirLoaded = true
  await fs.writeFile(
    RECORDINGS_SETTINGS_FILE,
    JSON.stringify({ recordingsDir: customRecordingsDir }, null, 2),
    'utf-8',
  )
}

function hasProjectFileExtension(filePath: string) {
  const extension = path.extname(filePath).replace(/^\./, '').toLowerCase()
  return [PROJECT_FILE_EXTENSION, ...LEGACY_PROJECT_FILE_EXTENSIONS].includes(extension)
}

function getProjectThumbnailPath(projectPath: string) {
  return `${projectPath}${PROJECT_THUMBNAIL_SUFFIX}`
}

async function saveProjectThumbnail(projectPath: string, thumbnailDataUrl?: string | null) {
  const thumbnailPath = getProjectThumbnailPath(projectPath)
  if (!thumbnailDataUrl) {
    await fs.rm(thumbnailPath, { force: true }).catch(() => undefined)
    return null
  }

  const match = thumbnailDataUrl.match(/^data:image\/png;base64,(.+)$/)
  if (!match) {
    throw new Error('Project thumbnail must be a PNG data URL.')
  }

  await fs.writeFile(thumbnailPath, Buffer.from(match[1], 'base64'))
  return thumbnailPath
}

async function loadRecentProjectPaths() {
  try {
    const content = await fs.readFile(RECENT_PROJECTS_FILE, 'utf-8')
    const parsed = JSON.parse(content) as { paths?: unknown }
    return Array.isArray(parsed.paths)
      ? parsed.paths.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : []
  } catch {
    return []
  }
}

async function saveRecentProjectPaths(paths: string[]) {
  const normalizedPaths = Array.from(new Set(paths.map((value) => normalizePath(value)))).slice(0, MAX_RECENT_PROJECTS)
  await fs.writeFile(
    RECENT_PROJECTS_FILE,
    JSON.stringify({ paths: normalizedPaths }, null, 2),
    'utf-8',
  )
}

async function rememberRecentProject(projectPath: string) {
  if (!hasProjectFileExtension(projectPath)) {
    return
  }

  const existingPaths = await loadRecentProjectPaths()
  await saveRecentProjectPaths([projectPath, ...existingPaths])
}

async function buildProjectLibraryEntry(projectPath: string, projectsDir: string): Promise<ProjectLibraryEntry | null> {
  try {
    const normalizedPath = normalizePath(projectPath)
    if (!hasProjectFileExtension(normalizedPath)) {
      return null
    }

    const stats = await fs.stat(normalizedPath)
    if (!stats.isFile()) {
      return null
    }

    const thumbnailPath = getProjectThumbnailPath(normalizedPath)
    const thumbnailExists = await fs.access(thumbnailPath, fsConstants.R_OK)
      .then(() => true)
      .catch(() => false)

    return {
      path: normalizedPath,
      name: path.basename(normalizedPath).replace(/\.(recordly|openscreen)$/i, ''),
      updatedAt: stats.mtimeMs,
      thumbnailPath: thumbnailExists ? thumbnailPath : null,
      isCurrent: Boolean(currentProjectPath && normalizePath(currentProjectPath) === normalizedPath),
      isInProjectsDirectory: path.dirname(normalizedPath) === normalizePath(projectsDir),
    }
  } catch {
    return null
  }
}

async function listProjectLibraryEntries() {
  const projectsDir = await getProjectsDir()
  const projectPaths: string[] = []

  try {
    const entries = await fs.readdir(projectsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue
      }

      const entryPath = path.join(projectsDir, entry.name)
      if (hasProjectFileExtension(entryPath)) {
        projectPaths.push(entryPath)
      }
    }
  } catch {
    // Ignore directory read failures and fall back to recent files.
  }

  const recentProjectPaths = await loadRecentProjectPaths()
  const candidatePaths = Array.from(new Set([...projectPaths, ...recentProjectPaths]))
  const entries = (await Promise.all(candidatePaths.map((candidatePath) => buildProjectLibraryEntry(candidatePath, projectsDir))))
    .filter((entry): entry is ProjectLibraryEntry => entry != null)
    .sort((left, right) => right.updatedAt - left.updatedAt)

  await saveRecentProjectPaths(entries.map((entry) => entry.path))

  return {
    projectsDir,
    entries,
  }
}

async function loadProjectFromPath(projectPath: string) {
  const normalizedPath = normalizePath(projectPath)
  const content = await fs.readFile(normalizedPath, 'utf-8')
  const project = JSON.parse(content)
  const mediaSources = await resolveProjectMediaSources(project)

  if (!mediaSources.success) {
    return {
      success: false,
      canceled: false,
      message: mediaSources.message,
    }
  }

  currentProjectPath = normalizedPath
  currentVideoPath = mediaSources.videoPath
  currentRecordingSession = {
    videoPath: mediaSources.videoPath,
    webcamPath: mediaSources.webcamPath,
    timeOffsetMs: 0,
  }
  await rememberRecentProject(normalizedPath)

  return {
    success: true,
    path: normalizedPath,
    project,
  }
}

function normalizeVideoSourcePath(videoPath?: string | null): string | null {
  if (typeof videoPath !== 'string') {
    return null
  }

  const trimmed = videoPath.trim()
  if (!trimmed) {
    return null
  }

  if (/^file:\/\//i.test(trimmed)) {
    try {
      return fileURLToPath(trimmed)
    } catch {
      // Fall through and keep best-effort string path below.
    }
  }

  return trimmed
}

async function resolveProjectMediaSources(project: unknown): Promise<
  | {
      success: true
      videoPath: string
      webcamPath: string | null
    }
  | {
      success: false
      message: string
    }
> {
  if (!project || typeof project !== 'object') {
    return { success: false, message: 'Invalid project file format' }
  }

  const rawVideoPath = (project as { videoPath?: unknown }).videoPath
  if (typeof rawVideoPath !== 'string') {
    return { success: false, message: 'Project file is missing a video path' }
  }

  const normalizedVideoPath = normalizeVideoSourcePath(rawVideoPath)
  if (!normalizedVideoPath) {
    return { success: false, message: 'Project file is missing a valid video path' }
  }

  try {
    await fs.access(normalizedVideoPath, fsConstants.F_OK)
  } catch {
    return {
      success: false,
      message: `Project video file not found: ${normalizedVideoPath}`,
    }
  }

  const rawWebcamPath =
    typeof (project as { editor?: { webcam?: { sourcePath?: unknown } } }).editor?.webcam?.sourcePath === 'string'
      ? ((project as { editor?: { webcam?: { sourcePath?: string } } }).editor?.webcam?.sourcePath ?? null)
      : null
  const normalizedWebcamPath = normalizeVideoSourcePath(rawWebcamPath)

  if (!normalizedWebcamPath) {
    return {
      success: true,
      videoPath: normalizedVideoPath,
      webcamPath: null,
    }
  }

  try {
    await fs.access(normalizedWebcamPath, fsConstants.F_OK)
    return {
      success: true,
      videoPath: normalizedVideoPath,
      webcamPath: normalizedWebcamPath,
    }
  } catch {
    return {
      success: true,
      videoPath: normalizedVideoPath,
      webcamPath: null,
    }
  }
}

function getRecordingSessionManifestPath(videoPath: string) {
  const extension = path.extname(videoPath)
  const baseName = path.basename(videoPath, extension)
  return path.join(path.dirname(videoPath), `${baseName}${RECORDING_SESSION_MANIFEST_SUFFIX}`)
}

async function persistRecordingSessionManifest(session: RecordingSessionData): Promise<void> {
  const normalizedVideoPath = normalizeVideoSourcePath(session.videoPath)
  if (!normalizedVideoPath) {
    return
  }

  const normalizedWebcamPath = normalizeVideoSourcePath(session.webcamPath ?? null)
  const manifestPath = getRecordingSessionManifestPath(normalizedVideoPath)

  if (!normalizedWebcamPath) {
    await fs.rm(manifestPath, { force: true })
    return
  }

  const manifest: RecordingSessionManifest = {
    version: 2,
    videoFileName: path.basename(normalizedVideoPath),
    webcamFileName: path.basename(normalizedWebcamPath),
    timeOffsetMs: normalizeRecordingTimeOffsetMs(session.timeOffsetMs),
  }

  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
}

async function resolveRecordingSessionManifest(videoPath?: string | null): Promise<RecordingSessionData | null> {
  const normalizedVideoPath = normalizeVideoSourcePath(videoPath)
  if (!normalizedVideoPath) {
    return null
  }

  const manifestPath = getRecordingSessionManifestPath(normalizedVideoPath)

  try {
    const content = await fs.readFile(manifestPath, 'utf-8')
    const parsed = JSON.parse(content) as Partial<RecordingSessionManifest>
    if (parsed.version !== 1 && parsed.version !== 2) {
      return null
    }

    const webcamFileName = typeof parsed.webcamFileName === 'string' && parsed.webcamFileName.trim()
      ? parsed.webcamFileName.trim()
      : null

    if (!webcamFileName) {
      return {
        videoPath: normalizedVideoPath,
        webcamPath: null,
        timeOffsetMs: 0,
      }
    }

    const webcamPath = path.join(path.dirname(normalizedVideoPath), webcamFileName)
    await fs.access(webcamPath, fsConstants.F_OK)

    return {
      videoPath: normalizedVideoPath,
      webcamPath,
      timeOffsetMs: normalizeRecordingTimeOffsetMs(parsed.timeOffsetMs),
    }
  } catch {
    return null
  }
}

async function resolveLinkedWebcamPath(videoPath?: string | null): Promise<string | null> {
  const normalizedVideoPath = normalizeVideoSourcePath(videoPath)
  if (!normalizedVideoPath) {
    return null
  }

  const extension = path.extname(normalizedVideoPath)
  const baseName = path.basename(normalizedVideoPath, extension)
  if (!baseName || baseName.endsWith('-webcam')) {
    return null
  }

  const candidateExtensions = Array.from(
    new Set([extension, '.webm', '.mp4', '.mov', '.mkv', '.avi'].filter(Boolean)),
  )

  for (const candidateExtension of candidateExtensions) {
    const candidatePath = path.join(
      path.dirname(normalizedVideoPath),
      `${baseName}-webcam${candidateExtension}`,
    )

    try {
      await fs.access(candidatePath, fsConstants.F_OK)
      return candidatePath
    } catch {
      continue
    }
  }

  return null
}

async function resolveRecordingSession(videoPath?: string | null): Promise<RecordingSessionData | null> {
  const manifestSession = await resolveRecordingSessionManifest(videoPath)
  if (manifestSession) {
    return manifestSession
  }

  const normalizedVideoPath = normalizeVideoSourcePath(videoPath)
  if (!normalizedVideoPath) {
    return null
  }

  const linkedWebcamPath = await resolveLinkedWebcamPath(normalizedVideoPath)
  return {
    videoPath: normalizedVideoPath,
    webcamPath: linkedWebcamPath,
  }
}

async function hasSiblingProjectFile(videoPath: string) {
  const baseName = path.basename(videoPath, path.extname(videoPath))
  const candidateExtensions = [PROJECT_FILE_EXTENSION, ...LEGACY_PROJECT_FILE_EXTENSIONS]

  for (const extension of candidateExtensions) {
    const projectPath = path.join(path.dirname(videoPath), `${baseName}.${extension}`)

    try {
      await fs.access(projectPath)
      return true
    } catch {
      continue
    }
  }

  return false
}

async function pruneAutoRecordings(exemptPaths: string[] = []) {
  const recordingsDir = await getRecordingsDir()
  const exempt = new Set(
    [currentVideoPath, ...exemptPaths]
      .filter((value): value is string => Boolean(value))
      .map((value) => normalizePath(value)),
  )

  const entries = await fs.readdir(recordingsDir, { withFileTypes: true })
  const autoRecordingStats = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && /^recording-.*\.(mp4|mov|webm)$/i.test(entry.name))
      .map(async (entry) => {
        const filePath = path.join(recordingsDir, entry.name)
        const stats = await fs.stat(filePath)
        return { filePath, stats }
      }),
  )

  const sorted = autoRecordingStats.sort((left, right) => right.stats.mtimeMs - left.stats.mtimeMs)
  const now = Date.now()

  for (const [index, entry] of sorted.entries()) {
    const normalizedFilePath = normalizePath(entry.filePath)
    if (exempt.has(normalizedFilePath)) {
      continue
    }

    if (await hasSiblingProjectFile(entry.filePath)) {
      continue
    }

    const tooOld = now - entry.stats.mtimeMs > AUTO_RECORDING_MAX_AGE_MS
    const overLimit = index >= AUTO_RECORDING_RETENTION_COUNT
    if (!tooOld && !overLimit) {
      continue
    }

    try {
      await fs.rm(entry.filePath, { force: true })
      await fs.rm(getTelemetryPathForVideo(entry.filePath), { force: true })
      // Clean up companion audio files left from recording (macOS .m4a, Windows .wav)
      const base = entry.filePath.replace(/\.(mp4|mov|webm)$/i, '')
      for (const suffix of ['.system.m4a', '.mic.m4a', '.system.wav', '.mic.wav']) {
        await fs.rm(base + suffix, { force: true }).catch(() => {})
      }
    } catch (error) {
      console.warn('Failed to prune old auto recording:', entry.filePath, error)
    }
  }
}

/**
 * Resolve a path within the app bundle, handling asar unpacking in production.
 * Files listed in asarUnpack are extracted to app.asar.unpacked/ and must be
 * accessed via that path instead of the asar virtual filesystem.
 */
function resolveUnpackedAppPath(...segments: string[]) {
  const base = app.getAppPath()
  const resolved = path.join(base, ...segments)
  if (app.isPackaged) {
    return resolved.replace(/\.asar([/\\])/, '.asar.unpacked$1')
  }
  return resolved
}

function getNativeCaptureHelperSourcePath() {
  return resolveUnpackedAppPath('electron', 'native', 'ScreenCaptureKitRecorder.swift')
}

function getNativeArchTag() {
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64'
  }

  if (process.platform === 'win32') {
    return process.arch === 'arm64' ? 'win32-arm64' : 'win32-x64'
  }

  if (process.platform === 'linux') {
    return process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64'
  }

  return `${process.platform}-${process.arch}`
}

function getPrebundledNativeHelperPath(binaryName: string) {
  return resolveUnpackedAppPath('electron', 'native', 'bin', getNativeArchTag(), binaryName)
}

function resolvePreferredWindowsNativeHelperPath(helperDirectory: string, binaryName: string) {
  const buildOutputPath = resolveUnpackedAppPath(
    'electron',
    'native',
    helperDirectory,
    'build',
    'Release',
    binaryName,
  )
  const prebundledPath = getPrebundledNativeHelperPath(binaryName)

  if (existsSync(buildOutputPath)) {
    return buildOutputPath
  }

  if (existsSync(prebundledPath)) {
    return prebundledPath
  }

  return buildOutputPath
}

function getBundledWhisperExecutableCandidates() {
  const binaryNames = process.platform === 'win32'
    ? ['whisper-cli.exe', 'whisper-cpp.exe', 'whisper.exe', 'main.exe']
    : ['whisper-cli', 'whisper-cpp', 'whisper', 'main']

  return binaryNames.map((binaryName) => getPrebundledNativeHelperPath(binaryName))
}

function getNativeCaptureHelperBinaryPath() {
  return path.join(app.getPath('userData'), 'native-tools', 'openscreen-screencapturekit-helper')
}

function getSystemCursorHelperSourcePath() {
  return resolveUnpackedAppPath('electron', 'native', 'SystemCursorAssets.swift')
}

function getSystemCursorHelperBinaryPath() {
  return path.join(app.getPath('userData'), 'native-tools', 'openscreen-system-cursors')
}

function getNativeCursorMonitorSourcePath() {
  return resolveUnpackedAppPath('electron', 'native', 'NativeCursorMonitor.swift')
}

function getNativeCursorMonitorBinaryPath() {
  return path.join(app.getPath('userData'), 'native-tools', 'openscreen-native-cursor-monitor')
}

function getNativeWindowListSourcePath() {
  return resolveUnpackedAppPath('electron', 'native', 'ScreenCaptureKitWindowList.swift')
}

function getNativeWindowListBinaryPath() {
  return path.join(app.getPath('userData'), 'native-tools', 'openscreen-window-list')
}

type NativeMacWindowSource = {
  id: string
  name: string
  display_id?: string
  appName?: string
  windowTitle?: string
  bundleId?: string
  appIcon?: string | null
  x?: number
  y?: number
  width?: number
  height?: number
}

let cachedNativeMacWindowSources: NativeMacWindowSource[] | null = null
let cachedNativeMacWindowSourcesAtMs = 0

async function ensureSwiftHelperBinary(
  sourcePath: string,
  binaryPath: string,
  label: string,
  prebundledBinaryName?: string,
) {
  if (prebundledBinaryName) {
    const prebundledPath = getPrebundledNativeHelperPath(prebundledBinaryName)
    try {
      await fs.access(prebundledPath, fsConstants.X_OK)
      return prebundledPath
    } catch {
      if (app.isPackaged) {
        throw new Error(
          `${label} is missing from this app build (${prebundledPath}). Reinstall or update the app.`
        )
      }
    }
  }

  const helperDir = path.dirname(binaryPath)

  await fs.mkdir(helperDir, { recursive: true })

  let shouldCompile = false
  try {
    const [sourceStat, binaryStat] = await Promise.all([
      fs.stat(sourcePath),
      fs.stat(binaryPath).catch(() => null),
    ])
    shouldCompile = !binaryStat || sourceStat.mtimeMs > binaryStat.mtimeMs
  } catch (error) {
    throw new Error(`${label} source is unavailable: ${String(error)}`)
  }

  if (!shouldCompile) {
    return binaryPath
  }

  const result = spawnSync('swiftc', ['-O', sourcePath, '-o', binaryPath], {
    encoding: 'utf8',
    timeout: 120000,
  })

  if (result.status !== 0) {
    const details = [result.stderr, result.stdout].filter(Boolean).join('\n').trim()
    throw new Error(details || `Failed to compile ${label}`)
  }

  return binaryPath
}

async function ensureNativeCaptureHelperBinary() {
  return ensureSwiftHelperBinary(
    getNativeCaptureHelperSourcePath(),
    getNativeCaptureHelperBinaryPath(),
    'native ScreenCaptureKit helper',
    'openscreen-screencapturekit-helper'
  )
}

async function ensureNativeWindowListBinary() {
  return ensureSwiftHelperBinary(
    getNativeWindowListSourcePath(),
    getNativeWindowListBinaryPath(),
    'native ScreenCaptureKit window list helper',
    'openscreen-window-list'
  )
}

async function getNativeMacWindowSources(options?: { maxAgeMs?: number }) {
  if (process.platform !== 'darwin') {
    return [] as NativeMacWindowSource[]
  }

  const maxAgeMs = options?.maxAgeMs ?? 5000
  const now = Date.now()
  if (cachedNativeMacWindowSources && now - cachedNativeMacWindowSourcesAtMs < maxAgeMs) {
    return cachedNativeMacWindowSources
  }

  const binaryPath = await ensureNativeWindowListBinary()
  const { stdout } = await execFileAsync(binaryPath, [], {
    timeout: 30000,
    maxBuffer: 10 * 1024 * 1024,
  })

  const parsed = JSON.parse(stdout)
  if (!Array.isArray(parsed)) {
    return [] as NativeMacWindowSource[]
  }

  const entries = parsed.filter((entry: unknown): entry is NativeMacWindowSource => {
    if (!entry || typeof entry !== 'object') {
      return false
    }

    const candidate = entry as Partial<NativeMacWindowSource>
    return typeof candidate.id === 'string' && typeof candidate.name === 'string'
  })

  cachedNativeMacWindowSources = entries
  cachedNativeMacWindowSourcesAtMs = now
  return entries
}

async function getSystemCursorAssets() {
  if (process.platform !== 'darwin') {
    cachedSystemCursorAssets = {}
    cachedSystemCursorAssetsSourceMtimeMs = null
    return cachedSystemCursorAssets
  }

  const sourcePath = getSystemCursorHelperSourcePath()
  const sourceStat = await fs.stat(sourcePath)
  if (cachedSystemCursorAssets && cachedSystemCursorAssetsSourceMtimeMs === sourceStat.mtimeMs) {
    return cachedSystemCursorAssets
  }

  const binaryPath = await ensureSwiftHelperBinary(
    sourcePath,
    getSystemCursorHelperBinaryPath(),
    'system cursor helper',
    'openscreen-system-cursors'
  )

  const { stdout } = await execFileAsync(binaryPath, [], { timeout: 15000, maxBuffer: 20 * 1024 * 1024 })
  const parsed = JSON.parse(stdout) as Record<string, Partial<SystemCursorAsset>>
  cachedSystemCursorAssets = Object.fromEntries(
    Object.entries(parsed).filter(([, asset]) => (
      typeof asset?.dataUrl === 'string'
      && typeof asset?.hotspotX === 'number'
      && typeof asset?.hotspotY === 'number'
      && typeof asset?.width === 'number'
      && typeof asset?.height === 'number'
    ))
  ) as Record<string, SystemCursorAsset>
  cachedSystemCursorAssetsSourceMtimeMs = sourceStat.mtimeMs

  return cachedSystemCursorAssets
}

function parseWindowId(sourceId?: string) {
  if (!sourceId) return null
  const match = sourceId.match(/^window:(\d+)/)
  return match ? Number.parseInt(match[1], 10) : null
}

function loadFfmpegStatic() {
  const moduleExports = nodeRequire('ffmpeg-static')
  if (typeof moduleExports === 'string') {
    return moduleExports
  }

  if (typeof moduleExports?.default === 'string') {
    return moduleExports.default as string
  }

  return null
}

function loadUiohookModule() {
  const moduleExports = nodeRequire('uiohook-napi')
  return (
    (moduleExports as any)?.uIOhook
    ?? (moduleExports as any)?.uiohook
    ?? (moduleExports as any)?.Uiohook
    ?? (moduleExports as any)?.default?.uIOhook
    ?? (moduleExports as any)?.default?.uiohook
    ?? (moduleExports as any)?.default
    ?? moduleExports
  )
}

function getFfmpegBinaryPath() {
  const ffmpegStatic = loadFfmpegStatic()
  if (!ffmpegStatic || typeof ffmpegStatic !== 'string') {
    throw new Error('FFmpeg binary is unavailable. Install ffmpeg-static for this platform.')
  }

  if (app.isPackaged) {
    return ffmpegStatic.replace(/\.asar([\/\\])/, '.asar.unpacked$1')
  }

  return ffmpegStatic
}

function sendWhisperModelDownloadProgress(
  webContents: Electron.WebContents,
  payload: { status: 'idle' | 'downloading' | 'downloaded' | 'error'; progress: number; path?: string | null; error?: string },
) {
  webContents.send('whisper-small-model-download-progress', payload)
}

async function getWhisperSmallModelStatus() {
  try {
    await fs.access(WHISPER_SMALL_MODEL_PATH, fsConstants.R_OK)
    return {
      success: true,
      exists: true,
      path: WHISPER_SMALL_MODEL_PATH,
    }
  } catch {
    return {
      success: true,
      exists: false,
      path: null,
    }
  }
}

function downloadFileWithProgress(
  url: string,
  destinationPath: string,
  onProgress: (progress: number) => void,
): Promise<void> {
  const request = (currentUrl: string, redirectCount = 0): Promise<void> => {
    return new Promise((resolve, reject) => {
      const req = httpsGet(currentUrl, (response) => {
        const statusCode = response.statusCode ?? 0
        const location = response.headers.location

        if (statusCode >= 300 && statusCode < 400 && location) {
          response.resume()
          if (redirectCount >= 5) {
            reject(new Error('Too many redirects while downloading Whisper model.'))
            return
          }

          const nextUrl = new URL(location, currentUrl).toString()
          void request(nextUrl, redirectCount + 1).then(resolve).catch(reject)
          return
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume()
          reject(new Error(`Whisper model download failed with status ${statusCode}.`))
          return
        }

        const totalBytes = Number.parseInt(String(response.headers['content-length'] ?? '0'), 10)
        let downloadedBytes = 0
        const fileStream = createWriteStream(destinationPath)

        response.on('data', (chunk: Buffer) => {
          downloadedBytes += chunk.length
          if (Number.isFinite(totalBytes) && totalBytes > 0) {
            onProgress(Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)))
          }
        })

        response.on('error', (error) => {
          fileStream.destroy(error)
        })

        fileStream.on('error', (error) => {
          response.destroy(error)
          reject(error)
        })

        fileStream.on('finish', () => {
          onProgress(100)
          resolve()
        })

        response.pipe(fileStream)
      })

      req.on('error', reject)
    })
  }

  return request(url)
}

async function downloadWhisperSmallModel(webContents: Electron.WebContents) {
  await fs.mkdir(WHISPER_MODEL_DIR, { recursive: true })
  const tempPath = `${WHISPER_SMALL_MODEL_PATH}.download`

  sendWhisperModelDownloadProgress(webContents, {
    status: 'downloading',
    progress: 0,
    path: null,
  })

  try {
    await fs.rm(tempPath, { force: true })
    await downloadFileWithProgress(WHISPER_MODEL_DOWNLOAD_URL, tempPath, (progress) => {
      sendWhisperModelDownloadProgress(webContents, {
        status: 'downloading',
        progress,
        path: null,
      })
    })
    await fs.rename(tempPath, WHISPER_SMALL_MODEL_PATH)
    sendWhisperModelDownloadProgress(webContents, {
      status: 'downloaded',
      progress: 100,
      path: WHISPER_SMALL_MODEL_PATH,
    })
    return WHISPER_SMALL_MODEL_PATH
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined)
    sendWhisperModelDownloadProgress(webContents, {
      status: 'error',
      progress: 0,
      path: null,
      error: String(error),
    })
    throw error
  }
}

async function deleteWhisperSmallModel() {
  await fs.rm(WHISPER_SMALL_MODEL_PATH, { force: true })
}

function parseSrtTimestamp(value: string) {
  const match = value.trim().match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/)
  if (!match) {
    return null
  }

  const [, hours, minutes, seconds, milliseconds] = match
  return (
    Number(hours) * 60 * 60 * 1000
    + Number(minutes) * 60 * 1000
    + Number(seconds) * 1000
    + Number(milliseconds)
  )
}

type CaptionWordPayload = {
  text: string
  startMs: number
  endMs: number
  leadingSpace?: boolean
}

type CaptionCuePayload = {
  id: string
  startMs: number
  endMs: number
  text: string
  words?: CaptionWordPayload[]
}

type WhisperJsonToken = {
  text?: unknown
  offsets?: {
    from?: unknown
    to?: unknown
  }
}

type WhisperJsonSegment = {
  text?: unknown
  offsets?: {
    from?: unknown
    to?: unknown
  }
  tokens?: unknown
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function buildCaptionTextFromWords(words: CaptionWordPayload[]) {
  return words
    .map((word, index) => `${index > 0 && word.leadingSpace ? ' ' : ''}${word.text}`)
    .join('')
    .trim()
}

function parseWhisperJsonWords(tokens: unknown) {
  if (!Array.isArray(tokens)) {
    return []
  }

  const words: CaptionWordPayload[] = []
  let nextLeadingSpace = false

  for (const token of tokens) {
    if (!token || typeof token !== 'object') {
      continue
    }

    const tokenData = token as WhisperJsonToken
    const tokenText = typeof tokenData.text === 'string' ? tokenData.text : ''
    if (!tokenText) {
      continue
    }

    const tokenStartMs = isFiniteNumber(tokenData.offsets?.from) ? Math.round(tokenData.offsets.from) : null
    const tokenEndMs = isFiniteNumber(tokenData.offsets?.to) ? Math.round(tokenData.offsets.to) : null
    const parts = tokenText.match(/\s+|[^\s]+/g) ?? []

    for (const part of parts) {
      if (/^\s+$/.test(part)) {
        nextLeadingSpace = words.length > 0
        continue
      }

      if (tokenStartMs == null || tokenEndMs == null || tokenEndMs <= tokenStartMs) {
        return []
      }

      const previousWord = words.length > 0 ? words[words.length - 1] : null
      if (!previousWord || nextLeadingSpace) {
        words.push({
          text: part,
          startMs: tokenStartMs,
          endMs: tokenEndMs,
          ...(words.length > 0 && nextLeadingSpace ? { leadingSpace: true } : {}),
        })
      } else {
        previousWord.text += part
        previousWord.endMs = Math.max(previousWord.endMs, tokenEndMs)
      }

      nextLeadingSpace = false
    }
  }

  return words.filter((word) => word.text.trim().length > 0)
}

function parseWhisperJsonCues(content: string) {
  try {
    const parsed = JSON.parse(content) as {
      transcription?: unknown
    }

    if (!Array.isArray(parsed.transcription)) {
      return []
    }

    return parsed.transcription
      .map((segment, index) => {
        if (!segment || typeof segment !== 'object') {
          return null
        }

        const segmentData = segment as WhisperJsonSegment
        const startMs = isFiniteNumber(segmentData.offsets?.from) ? Math.round(segmentData.offsets.from) : null
        const endMs = isFiniteNumber(segmentData.offsets?.to) ? Math.round(segmentData.offsets.to) : null
        const segmentText = typeof segmentData.text === 'string' ? segmentData.text.trim() : ''

        if (startMs == null || endMs == null || endMs <= startMs) {
          return null
        }

        const words = parseWhisperJsonWords(segmentData.tokens)
        const text = words.length > 0 ? buildCaptionTextFromWords(words) : segmentText

        if (!text) {
          return null
        }

        return {
          id: `caption-${index + 1}`,
          startMs,
          endMs,
          text,
          ...(words.length > 0 ? { words } : {}),
        }
      })
      .filter((cue): cue is CaptionCuePayload => cue != null)
  } catch (error) {
    console.warn('[auto-captions] Failed to parse Whisper JSON output:', error)
    return []
  }
}

function parseSrtCues(content: string) {
  return content
    .split(/\r?\n\r?\n/)
    .map((block, index) => {
      const lines = block.split(/\r?\n/).map((line) => line.trim())
      const timingLine = lines.find((line) => line.includes('-->'))
      if (!timingLine) {
        return null
      }

      const [rawStart, rawEnd] = timingLine.split('-->').map((part) => part.trim())
      const startMs = parseSrtTimestamp(rawStart)
      const endMs = parseSrtTimestamp(rawEnd)
      if (startMs == null || endMs == null || endMs <= startMs) {
        return null
      }

      const text = lines
        .slice(lines.indexOf(timingLine) + 1)
        .filter((line) => line.length > 0)
        .join('\n')
        .trim()

      if (!text) {
        return null
      }

      return {
        id: `caption-${index + 1}`,
        startMs,
        endMs,
        text,
      }
    })
    .filter((cue): cue is CaptionCuePayload => cue != null)
}

function shouldRetryWhisperWithoutJson(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /unknown argument|output-json-full|output-json|ojf|\boj\b/i.test(message)
}

async function ensureReadableFile(filePath: string, description: string) {
  await fs.access(filePath, fsConstants.R_OK)
  if (description === 'whisper executable') {
    try {
      await fs.access(filePath, fsConstants.X_OK)
    } catch {
      throw new Error('The selected Whisper executable is not marked as executable.')
    }
  }
}

async function isExecutableFile(filePath: string) {
  try {
    await fs.access(filePath, fsConstants.R_OK | fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

async function resolveWhisperExecutablePath(preferredPath?: string | null) {
  const candidatePaths = [
    preferredPath?.trim() || null,
    ...getBundledWhisperExecutableCandidates(),
    process.env['WHISPER_CPP_PATH']?.trim() || null,
    process.platform === 'darwin' ? '/opt/homebrew/bin/whisper-cli' : null,
    process.platform === 'darwin' ? '/usr/local/bin/whisper-cli' : null,
    process.platform === 'darwin' ? '/opt/homebrew/bin/whisper-cpp' : null,
    process.platform === 'darwin' ? '/usr/local/bin/whisper-cpp' : null,
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidatePaths) {
    const normalized = path.resolve(candidate)
    if (await isExecutableFile(normalized)) {
      return normalized
    }
  }

  const pathCommand = process.platform === 'win32' ? 'where' : 'which'
  const binaryNames = process.platform === 'win32'
    ? ['whisper-cli.exe', 'whisper.exe', 'main.exe']
    : ['whisper-cli', 'whisper-cpp', 'whisper', 'main']

  for (const binaryName of binaryNames) {
    const result = spawnSync(pathCommand, [binaryName], { encoding: 'utf-8' })
    if (result.status === 0) {
      const resolvedPath = result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean)

      if (resolvedPath && await isExecutableFile(resolvedPath)) {
        return resolvedPath
      }
    }
  }

  throw new Error('No Whisper runtime was found. Recordly looked for a bundled binary first, then checked common system install locations.')
}

async function resolveCaptionAudioCandidates(videoPath: string) {
  const candidates: Array<{ path: string; label: string }> = []
  const seenPaths = new Set<string>()

  const pushCandidate = (candidatePath: string | null | undefined, label: string) => {
    const normalizedCandidatePath = normalizeVideoSourcePath(candidatePath)
    if (!normalizedCandidatePath || seenPaths.has(normalizedCandidatePath)) {
      return
    }

    seenPaths.add(normalizedCandidatePath)
    candidates.push({ path: normalizedCandidatePath, label })
  }

  pushCandidate(videoPath, 'recording')

  const requestedRecordingSession = await resolveRecordingSession(videoPath)
  pushCandidate(requestedRecordingSession?.webcamPath, 'linked webcam recording')

  return candidates
}

async function extractCaptionAudioSource(options: {
  videoPath: string
  ffmpegPath: string
  wavPath: string
}) {
  const candidates = await resolveCaptionAudioCandidates(options.videoPath)
  const attemptedCandidates: Array<{
    path: string
    label: string
    readable: boolean
    extractedAudio: boolean
    error?: string
  }> = []

  for (const candidate of candidates) {
    try {
      await ensureReadableFile(candidate.path, 'video file')
      await execFileAsync(
        options.ffmpegPath,
        ['-y', '-i', candidate.path, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', options.wavPath],
        { timeout: 5 * 60 * 1000, maxBuffer: 20 * 1024 * 1024 },
      )
      attemptedCandidates.push({ ...candidate, readable: true, extractedAudio: true })
      return candidate
    } catch (error) {
      attemptedCandidates.push({
        ...candidate,
        readable: true,
        extractedAudio: false,
        error: error instanceof Error ? error.message : String(error),
      })
      // Try the next candidate instead of failing on stale editor state.
    }
  }

  console.warn('[auto-captions] No audio source candidate could be extracted:', attemptedCandidates)

  throw new Error('No audio was found to transcribe in the saved recording file. Captions need an audio track. If this recording should have contained sound, the recording was saved without an audio stream.')
}

async function generateAutoCaptionsFromVideo(options: {
  videoPath: string
  whisperExecutablePath?: string
  whisperModelPath: string
  language?: string
}) {
  const ffmpegPath = getFfmpegBinaryPath()
  const normalizedVideoPath = normalizeVideoSourcePath(options.videoPath)
  if (!normalizedVideoPath) {
    throw new Error('Missing source video path.')
  }

  const whisperExecutablePath = await resolveWhisperExecutablePath(options.whisperExecutablePath)
  const whisperModelPath = path.resolve(options.whisperModelPath)
  await ensureReadableFile(whisperExecutablePath, 'whisper executable')
  await ensureReadableFile(whisperModelPath, 'whisper model')

  const tempBase = path.join(app.getPath('temp'), `recordly-captions-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const wavPath = `${tempBase}.wav`
  const outputBase = `${tempBase}-whisper`
  const srtPath = `${outputBase}.srt`
  const jsonPath = `${outputBase}.json`

  try {
    const audioSource = await extractCaptionAudioSource({
      videoPath: normalizedVideoPath,
      ffmpegPath,
      wavPath,
    })

    const language = options.language && options.language.trim() ? options.language.trim() : 'auto'
    const whisperBaseArgs = [
      '-m', whisperModelPath,
      '-f', wavPath,
      '-osrt',
      '-of', outputBase,
      '-l', language,
      '-np',
    ]

    let jsonEnabled = true
    try {
      await execFileAsync(whisperExecutablePath, [...whisperBaseArgs, '-ojf'], {
        timeout: 30 * 60 * 1000,
        maxBuffer: 20 * 1024 * 1024,
      })
    } catch (error) {
      if (!shouldRetryWhisperWithoutJson(error)) {
        throw error
      }

      jsonEnabled = false
      console.warn('[auto-captions] Whisper runtime does not support JSON full output, retrying with SRT only:', error)
      await execFileAsync(whisperExecutablePath, whisperBaseArgs, {
        timeout: 30 * 60 * 1000,
        maxBuffer: 20 * 1024 * 1024,
      })
    }

    const timedCues = jsonEnabled
      ? parseWhisperJsonCues(await fs.readFile(jsonPath, 'utf-8'))
      : []
    const cues = timedCues.length > 0
      ? timedCues
      : parseSrtCues(await fs.readFile(srtPath, 'utf-8'))
    if (cues.length === 0) {
      throw new Error('Whisper completed, but no caption cues were produced.')
    }

    return {
      cues,
      audioSourceLabel: audioSource.label,
    }
  } finally {
    await Promise.allSettled([
      fs.rm(wavPath, { force: true }),
      fs.rm(srtPath, { force: true }),
      fs.rm(jsonPath, { force: true }),
    ])
  }
}

function waitForFfmpegCaptureStart(process: ChildProcessWithoutNullStreams) {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }

    const onExit = (code: number | null) => {
      cleanup()
      reject(new Error(ffmpegCaptureOutputBuffer.trim() || `FFmpeg exited before recording started (code ${code ?? 'unknown'})`))
    }

    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, 900)

    const cleanup = () => {
      clearTimeout(timer)
      process.off('error', onError)
      process.off('exit', onExit)
    }

    process.once('error', onError)
    process.once('exit', onExit)
  })
}

function waitForFfmpegCaptureStop(process: ChildProcessWithoutNullStreams, outputPath: string) {
  return new Promise<string>((resolve, reject) => {
    const onClose = async (code: number | null) => {
      cleanup()

      try {
        await fs.access(outputPath)
        if (code === 0 || code === null) {
          resolve(outputPath)
          return
        }

        if (ffmpegCaptureOutputBuffer.includes('Exiting normally')) {
          resolve(outputPath)
          return
        }
      } catch {
        // handled below
      }

      reject(new Error(ffmpegCaptureOutputBuffer.trim() || `FFmpeg exited with code ${code ?? 'unknown'}`))
    }

    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }

    const cleanup = () => {
      process.off('close', onClose)
      process.off('error', onError)
    }

    process.once('close', onClose)
    process.once('error', onError)
  })
}

function getDisplayBoundsForSource(source: SelectedSource) {
  return resolveWindowsCaptureDisplay(
    source,
    getScreen().getAllDisplays(),
    getScreen().getPrimaryDisplay(),
  ).bounds
}

function parseXwininfoBounds(stdout: string): WindowBounds | null {
  const absX = stdout.match(/Absolute upper-left X:\s+(-?\d+)/)
  const absY = stdout.match(/Absolute upper-left Y:\s+(-?\d+)/)
  const width = stdout.match(/Width:\s+(\d+)/)
  const height = stdout.match(/Height:\s+(\d+)/)

  if (!absX || !absY || !width || !height) {
    return null
  }

  return {
    x: Number.parseInt(absX[1], 10),
    y: Number.parseInt(absY[1], 10),
    width: Number.parseInt(width[1], 10),
    height: Number.parseInt(height[1], 10),
  }
}

async function resolveLinuxWindowBounds(source: SelectedSource): Promise<WindowBounds | null> {
  const windowId = parseWindowId(source?.id)

  if (windowId) {
    try {
      const { stdout } = await execFileAsync('xwininfo', ['-id', String(windowId)], { timeout: 1500 })
      const bounds = parseXwininfoBounds(stdout)
      if (bounds && bounds.width > 0 && bounds.height > 0) {
        return bounds
      }
    } catch {
      // fall back to title lookup below
    }
  }

  const windowTitle = typeof source.windowTitle === 'string' ? source.windowTitle.trim() : source.name.trim()
  if (!windowTitle) {
    return null
  }

  try {
    const { stdout } = await execFileAsync('xwininfo', ['-name', windowTitle], { timeout: 1500 })
    const bounds = parseXwininfoBounds(stdout)
    return bounds && bounds.width > 0 && bounds.height > 0 ? bounds : null
  } catch {
    return null
  }
}

async function resolveWindowsWindowBounds(source: SelectedSource): Promise<WindowBounds | null> {
  const windowId = parseWindowId(source?.id)
  const windowTitle = typeof source.windowTitle === 'string' ? source.windowTitle.trim() : source.name.trim()

  if (!windowId && !windowTitle) {
    return null
  }

  const script = [
    'param([string]$windowId, [string]$windowTitle)',
    'Add-Type -TypeDefinition @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class RecordlyWindowBounds {',
    '  [StructLayout(LayoutKind.Sequential)]',
    '  public struct RECT {',
    '    public int Left;',
    '    public int Top;',
    '    public int Right;',
    '    public int Bottom;',
    '  }',
    '  [DllImport("user32.dll")]',
    '  [return: MarshalAs(UnmanagedType.Bool)]',
    '  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);',
    '}',
    '"@',
    '$handle = [Int64]0',
    'if ($windowId) {',
    '  $handle = [Int64]$windowId',
    '}',
    'if ($handle -le 0 -and $windowTitle) {',
    '  $matchingProcess = Get-Process | Where-Object { $_.MainWindowTitle -eq $windowTitle -or $_.MainWindowTitle -like "*$windowTitle*" } | Select-Object -First 1',
    '  if ($matchingProcess) {',
    '    $handle = $matchingProcess.MainWindowHandle.ToInt64()',
    '  }',
    '}',
    'if ($handle -le 0) {',
    '  exit 1',
    '}',
    '$rect = New-Object RecordlyWindowBounds+RECT',
    'if (-not [RecordlyWindowBounds]::GetWindowRect([IntPtr]$handle, [ref]$rect)) {',
    '  exit 1',
    '}',
    '@{ x = $rect.Left; y = $rect.Top; width = $rect.Right - $rect.Left; height = $rect.Bottom - $rect.Top } | ConvertTo-Json -Compress',
  ].join('\n')

  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-Command', script, String(windowId ?? ''), windowTitle],
      { timeout: 1500 },
    )
    const bounds = JSON.parse(stdout) as WindowBounds
    return bounds && bounds.width > 0 && bounds.height > 0 ? bounds : null
  } catch {
    return null
  }
}

async function buildFfmpegCaptureArgs(source: SelectedSource, outputPath: string) {
  const commonOutputArgs = ['-an', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputPath]

  if (process.platform === 'win32') {
    if (source?.id?.startsWith('window:')) {
      const windowTitle = typeof source.windowTitle === 'string' ? source.windowTitle.trim() : source.name.trim()
      if (!windowTitle) {
        throw new Error('Missing window title for FFmpeg window capture')
      }

      return ['-y', '-f', 'gdigrab', '-framerate', '60', '-draw_mouse', '0', '-i', `title=${windowTitle}`, ...commonOutputArgs]
    }

    return ['-y', '-f', 'gdigrab', '-framerate', '60', '-draw_mouse', '0', '-i', 'desktop', ...commonOutputArgs]
  }

  if (process.platform === 'linux') {
    const displayEnv = process.env.DISPLAY || ':0.0'
    if (source?.id?.startsWith('window:')) {
      const bounds = await resolveLinuxWindowBounds(source)
      if (!bounds) {
        throw new Error('Unable to resolve Linux window bounds for FFmpeg capture')
      }

      return [
        '-y',
        '-f', 'x11grab',
        '-framerate', '60',
        '-draw_mouse', '0',
        '-video_size', `${Math.max(2, bounds.width)}x${Math.max(2, bounds.height)}`,
        '-i', `${displayEnv}+${Math.round(bounds.x)},${Math.round(bounds.y)}`,
        ...commonOutputArgs,
      ]
    }

    const bounds = getDisplayBoundsForSource(source)
    return [
      '-y',
      '-f', 'x11grab',
      '-framerate', '60',
      '-draw_mouse', '0',
      '-video_size', `${Math.max(2, bounds.width)}x${Math.max(2, bounds.height)}`,
      '-i', `${displayEnv}+${Math.round(bounds.x)},${Math.round(bounds.y)}`,
      ...commonOutputArgs,
    ]
  }

  if (process.platform === 'darwin') {
    return ['-y', '-f', 'avfoundation', '-capture_cursor', '0', '-framerate', '60', '-i', '1:none', ...commonOutputArgs]
  }

  throw new Error(`FFmpeg capture is not supported on ${process.platform}`)
}

function getWindowsCaptureExePath() {
  return resolvePreferredWindowsNativeHelperPath('wgc-capture', 'wgc-capture.exe')
}

function getCursorMonitorExePath() {
  return resolvePreferredWindowsNativeHelperPath('cursor-monitor', 'cursor-monitor.exe')
}

async function isNativeWindowsCaptureAvailable(): Promise<boolean> {
  if (process.platform !== 'win32') return false

  const helperPath = getWindowsCaptureExePath()
  const os = await import('node:os')
  const [major, , build] = os.release().split('.').map(Number)
  const supported = major >= 10 && build >= 19041
  let helperExists = false

  try {
    await fs.access(helperPath, fsConstants.X_OK)
    helperExists = true
  } catch {
    recordNativeCaptureDiagnostics({
      backend: 'windows-wgc',
      phase: 'availability',
      helperPath,
      helperExists,
      osRelease: os.release(),
      supported,
      error: 'Native Windows capture helper is missing or not executable.',
    })
    return false
  }

  recordNativeCaptureDiagnostics({
    backend: 'windows-wgc',
    phase: 'availability',
    helperPath,
    helperExists,
    osRelease: os.release(),
    supported,
  })

  return supported
}

function waitForWindowsCaptureStart(proc: ChildProcessWithoutNullStreams) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Timed out waiting for native Windows capture to start'))
    }, 12000)

    const onStdout = (chunk: Buffer) => {
      const text = chunk.toString()
      if (text.includes('Recording started')) {
        cleanup()
        resolve()
      }
    }

    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }

    const onExit = (code: number | null) => {
      cleanup()
      reject(new Error(windowsCaptureOutputBuffer.trim() || `Native Windows capture exited before recording started (code ${code ?? 'unknown'})`))
    }

    const cleanup = () => {
      clearTimeout(timer)
      proc.stdout.off('data', onStdout)
      proc.off('error', onError)
      proc.off('exit', onExit)
    }

    proc.stdout.on('data', onStdout)
    proc.once('error', onError)
    proc.once('exit', onExit)
  })
}

function waitForWindowsCaptureStop(proc: ChildProcessWithoutNullStreams) {
  return new Promise<string>((resolve, reject) => {
    const onClose = (code: number | null) => {
      cleanup()
      const match = windowsCaptureOutputBuffer.match(/Recording stopped\. Output path: (.+)/)
      if (match?.[1]) {
        resolve(match[1].trim())
        return
      }
      if (code === 0 && windowsCaptureTargetPath) {
        resolve(windowsCaptureTargetPath)
        return
      }
      reject(new Error(windowsCaptureOutputBuffer.trim() || `Native Windows capture exited with code ${code ?? 'unknown'}`))
    }

    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }

    const cleanup = () => {
      proc.off('close', onClose)
      proc.off('error', onError)
    }

    proc.once('close', onClose)
    proc.once('error', onError)
  })
}

function attachWindowsCaptureLifecycle(proc: ChildProcessWithoutNullStreams) {
  proc.once('close', () => {
    const wasActive = windowsNativeCaptureActive
    windowsCaptureProcess = null

    if (!wasActive || windowsCaptureStopRequested) {
      return
    }

    windowsNativeCaptureActive = false
    windowsCaptureTargetPath = null
    windowsCaptureStopRequested = false

    const sourceName = selectedSource?.name ?? 'Screen'
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send('recording-state-changed', {
          recording: false,
          sourceName,
        })
      }
    })

    emitRecordingInterrupted('capture-stopped', 'Recording stopped unexpectedly.')
  })
}

async function muxNativeWindowsVideoWithAudio(videoPath: string, systemAudioPath: string | null, micAudioPath: string | null, pauseSegments: PauseSegment[] = []) {
  const ffmpegPath = getFfmpegBinaryPath()
  const inputs: string[] = ['-i', videoPath]
  const audioInputs: string[] = []

  for (const [label, audioPath] of [['system', systemAudioPath], ['mic', micAudioPath]] as const) {
    if (!audioPath) continue
    try {
      const stat = await fs.stat(audioPath)
      if (stat.size <= 0) {
        console.warn(`[mux-win] Skipping ${label} audio: file is empty (${audioPath})`)
        await fs.rm(audioPath, { force: true }).catch(() => {})
        continue
      }
      inputs.push('-i', audioPath)
      audioInputs.push(label)
    } catch {
      console.warn(`[mux-win] Skipping ${label} audio: file not accessible (${audioPath})`)
    }
  }

  if (audioInputs.length === 0) return

  const mixedOutputPath = `${videoPath}.muxed.mp4`
  const normalizedPauseSegments = normalizePauseSegments(pauseSegments)

  if (audioInputs.length === 2) {
    // Both system + mic audio: mix them
    const filterParts: string[] = []
    const systemPauseFilter = buildPausedAudioFilter('1:a', 'system_trimmed', normalizedPauseSegments)
    const micPauseFilter = buildPausedAudioFilter('2:a', 'mic_trimmed', normalizedPauseSegments)

    if (systemPauseFilter) {
      filterParts.push(systemPauseFilter)
    }
    if (micPauseFilter) {
      filterParts.push(micPauseFilter)
    }

    filterParts.push(`${micPauseFilter ? '[mic_trimmed]' : '[2:a]'}atrim=start=0.10,asetpts=PTS-STARTPTS[m]`)
    filterParts.push(`${systemPauseFilter ? '[system_trimmed]' : '[1:a]'}[m]amix=inputs=2:duration=longest:normalize=0[aout]`)

    await execFileAsync(
      ffmpegPath,
      [
        '-y',
        ...inputs,
        '-filter_complex', filterParts.join(';'),
        '-map', '0:v:0',
        '-map', '[aout]',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        mixedOutputPath,
      ],
      { timeout: 120000, maxBuffer: 10 * 1024 * 1024 },
    )
  } else {
    // Single audio track
    const pauseFilter = buildPausedAudioFilter('1:a', 'aout', normalizedPauseSegments)

    await execFileAsync(
      ffmpegPath,
      pauseFilter
        ? [
            '-y',
            ...inputs,
            '-filter_complex', pauseFilter,
            '-map', '0:v:0',
            '-map', '[aout]',
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-b:a', '192k',
            mixedOutputPath,
          ]
        : [
            '-y',
            ...inputs,
            '-map', '0:v:0',
            '-map', '1:a:0',
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-b:a', '192k',
            mixedOutputPath,
          ],
      { timeout: 120000, maxBuffer: 10 * 1024 * 1024 },
    )
  }

  await moveFileWithOverwrite(mixedOutputPath, videoPath)

  // Clean up audio files
  for (const audioPath of [systemAudioPath, micAudioPath]) {
    if (audioPath) {
      await fs.rm(audioPath, { force: true }).catch(() => {})
    }
  }
}

function normalizePauseSegments(pauseSegments: PauseSegment[] | undefined): PauseSegment[] {
  if (!Array.isArray(pauseSegments) || pauseSegments.length === 0) {
    return []
  }

  const normalized = pauseSegments
    .map((segment) => {
      const startMs = Number(segment?.startMs)
      const endMs = Number(segment?.endMs)

      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
        return null
      }

      const clampedStart = Math.max(0, Math.round(startMs))
      const clampedEnd = Math.max(0, Math.round(endMs))
      if (clampedEnd <= clampedStart) {
        return null
      }

      return { startMs: clampedStart, endMs: clampedEnd }
    })
    .filter((segment): segment is PauseSegment => !!segment)
    .sort((left, right) => left.startMs - right.startMs)

  if (normalized.length <= 1) {
    return normalized
  }

  const merged: PauseSegment[] = [{ ...normalized[0] }]

  for (const segment of normalized.slice(1)) {
    const previous = merged[merged.length - 1]
    if (segment.startMs <= previous.endMs) {
      previous.endMs = Math.max(previous.endMs, segment.endMs)
    } else {
      merged.push({ ...segment })
    }
  }

  return merged
}

function formatFfmpegSeconds(milliseconds: number) {
  return (milliseconds / 1000).toFixed(3)
}

function buildPausedAudioFilter(inputLabel: string, outputLabel: string, pauseSegments: PauseSegment[]) {
  if (pauseSegments.length === 0) {
    return null
  }

  const activeSegments: Array<{ startMs: number, endMs?: number }> = []
  let cursorMs = 0

  for (const pauseSegment of pauseSegments) {
    if (pauseSegment.startMs > cursorMs) {
      activeSegments.push({ startMs: cursorMs, endMs: pauseSegment.startMs })
    }
    cursorMs = Math.max(cursorMs, pauseSegment.endMs)
  }

  activeSegments.push({ startMs: cursorMs })

  const filterParts: string[] = []
  const segmentLabels: string[] = []

  activeSegments.forEach((segment, index) => {
    if (typeof segment.endMs === 'number' && segment.endMs <= segment.startMs) {
      return
    }

    const segmentLabel = `${outputLabel}_part${index}`
    const trimArgs = typeof segment.endMs === 'number'
      ? `start=${formatFfmpegSeconds(segment.startMs)}:end=${formatFfmpegSeconds(segment.endMs)}`
      : `start=${formatFfmpegSeconds(segment.startMs)}`

    filterParts.push(`[${inputLabel}]atrim=${trimArgs},asetpts=PTS-STARTPTS[${segmentLabel}]`)
    segmentLabels.push(`[${segmentLabel}]`)
  })

  if (segmentLabels.length === 0) {
    return null
  }

  if (segmentLabels.length === 1) {
    filterParts.push(`${segmentLabels[0]}anull[${outputLabel}]`)
  } else {
    filterParts.push(`${segmentLabels.join('')}concat=n=${segmentLabels.length}:v=0:a=1[${outputLabel}]`)
  }

  return filterParts.join(';')
}

function waitForNativeCaptureStart(process: ChildProcessWithoutNullStreams) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Timed out waiting for ScreenCaptureKit recorder to start'))
    }, 12000)

    // Only check for the start pattern — the start handler already
    // appends stdout/stderr to nativeCaptureOutputBuffer
    const onStdout = (chunk: Buffer) => {
      const text = chunk.toString()
      if (text.includes('Recording started')) {
        cleanup()
        resolve()
      }
    }

    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }

    const onExit = (code: number | null) => {
      cleanup()
      reject(new Error(nativeCaptureOutputBuffer.trim() || `Native capture helper exited before recording started (code ${code ?? 'unknown'})`))
    }

    const cleanup = () => {
      clearTimeout(timer)
      process.stdout.off('data', onStdout)
      process.off('error', onError)
      process.off('exit', onExit)
    }

    process.stdout.on('data', onStdout)
    process.once('error', onError)
    process.once('exit', onExit)
  })
}

function waitForNativeCaptureStop(process: ChildProcessWithoutNullStreams) {
  return new Promise<string>((resolve, reject) => {
    const onClose = (code: number | null) => {
      cleanup()
      const match = nativeCaptureOutputBuffer.match(/Recording stopped\. Output path: (.+)/)
      if (match?.[1]) {
        resolve(match[1].trim())
        return
      }
      // Fallback: if exit code was 0 and we know the target path, try to use it
      if (code === 0 && nativeCaptureTargetPath) {
        resolve(nativeCaptureTargetPath)
        return
      }
      reject(new Error(nativeCaptureOutputBuffer.trim() || `Native capture helper exited with code ${code ?? 'unknown'}`))
    }

    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }

    const cleanup = () => {
      process.off('close', onClose)
      process.off('error', onError)
    }

    process.once('close', onClose)
    process.once('error', onError)
  })
}

async function muxNativeMacRecordingWithAudio(
  videoPath: string,
  systemAudioPath?: string | null,
  microphonePath?: string | null,
) {
  const ffmpegPath = getFfmpegBinaryPath()
  const mixedOutputPath = `${videoPath}.mixed.mp4`

  const inputs = ['-i', videoPath]
  const availableAudioInputs: string[] = []

  for (const [label, audioPath] of [['system', systemAudioPath], ['microphone', microphonePath]] as const) {
    if (!audioPath) continue
    try {
      const stat = await fs.stat(audioPath)
      if (stat.size <= 0) {
        console.warn(`[mux] Skipping ${label} audio: file is empty (${audioPath})`)
        await fs.rm(audioPath, { force: true }).catch(() => {})
        continue
      }
      inputs.push('-i', audioPath)
      availableAudioInputs.push(label)
    } catch {
      console.warn(`[mux] Skipping ${label} audio: file not accessible (${audioPath})`)
    }
  }

  if (availableAudioInputs.length === 0) {
    console.warn('[mux] No valid audio files to mux')
    return
  }

  const args = availableAudioInputs.length === 2
    ? [
        '-y',
        ...inputs,
        '-filter_complex', '[1:a][2:a]amix=inputs=2:duration=longest:normalize=0[aout]',
        '-map', '0:v:0',
        '-map', '[aout]',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-shortest',
        mixedOutputPath,
      ]
    : [
        '-y',
        ...inputs,
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-shortest',
        mixedOutputPath,
      ]

  console.log('[mux] Running ffmpeg:', ffmpegPath, args.join(' '))

  try {
    await execFileAsync(
      ffmpegPath,
      args,
      { timeout: 120000, maxBuffer: 10 * 1024 * 1024 },
    )
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & { stderr?: string }
    console.error('[mux] ffmpeg failed:', execError.stderr || execError.message)
    throw error
  }

  await moveFileWithOverwrite(mixedOutputPath, videoPath)
  console.log('[mux] Successfully muxed audio into video:', videoPath)

  for (const audioPath of [systemAudioPath, microphonePath]) {
    if (audioPath) {
      await fs.rm(audioPath, { force: true }).catch(() => {})
    }
  }
}

function emitRecordingInterrupted(reason: string, message: string) {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send('recording-interrupted', { reason, message })
    }
  })
}

function emitCursorStateChanged(cursorType: CursorVisualType) {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send('cursor-state-changed', { cursorType })
    }
  })
}

function sampleCursorStateChange(cursorType: CursorVisualType) {
  if (!isCursorCaptureActive) {
    return
  }

  const point = getNormalizedCursorPoint()
  if (!point) {
    return
  }

  pushCursorSample(point.cx, point.cy, Date.now() - cursorCaptureStartTimeMs, 'move', cursorType, point.hidden)
}

function attachNativeCaptureLifecycle(process: ChildProcessWithoutNullStreams) {
  process.once('close', () => {
    const wasActive = nativeScreenRecordingActive
    nativeCaptureProcess = null

    if (!wasActive || nativeCaptureStopRequested) {
      return
    }

    nativeScreenRecordingActive = false
    nativeCaptureTargetPath = null
    nativeCaptureStopRequested = false
    nativeCaptureSystemAudioPath = null
    nativeCaptureMicrophonePath = null

    const sourceName = selectedSource?.name ?? 'Screen'
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send('recording-state-changed', {
          recording: false,
          sourceName,
        })
      }
    })

    const reason = nativeCaptureOutputBuffer.includes('WINDOW_UNAVAILABLE')
      ? 'window-unavailable'
      : 'capture-stopped'
    const message = reason === 'window-unavailable'
      ? 'The selected window is no longer capturable. Please reselect a window.'
      : 'Recording stopped unexpectedly.'

    emitRecordingInterrupted(reason, message)
  })
}

async function ensureNativeCursorMonitorBinary() {
  return ensureSwiftHelperBinary(
    getNativeCursorMonitorSourcePath(),
    getNativeCursorMonitorBinaryPath(),
    'native cursor monitor helper',
    'openscreen-native-cursor-monitor'
  )
}

function handleCursorMonitorStdout(chunk: Buffer) {
  nativeCursorMonitorOutputBuffer += chunk.toString()
  const lines = nativeCursorMonitorOutputBuffer.split(/\r?\n/)
  nativeCursorMonitorOutputBuffer = lines.pop() ?? ''

  for (const line of lines) {
    const match = line.match(/^STATE:(.+)$/)
    if (!match) continue
    const next = match[1].trim() as CursorVisualType
    if (
      next === 'arrow'
      || next === 'text'
      || next === 'pointer'
      || next === 'crosshair'
      || next === 'open-hand'
      || next === 'closed-hand'
      || next === 'resize-ew'
      || next === 'resize-ns'
      || next === 'not-allowed'
    ) {
      if (currentCursorVisualType !== next) {
        currentCursorVisualType = next
        sampleCursorStateChange(next)
        emitCursorStateChanged(next)
      }
    }
  }
}

async function startNativeCursorMonitor() {
  stopNativeCursorMonitor()

  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    currentCursorVisualType = 'arrow'
    return
  }

  try {
    let helperPath: string
    if (process.platform === 'win32') {
      helperPath = getCursorMonitorExePath()
      try {
        await fs.access(helperPath, fsConstants.X_OK)
      } catch {
        console.warn('Windows cursor monitor helper missing or not executable:', helperPath)
        currentCursorVisualType = 'arrow'
        return
      }
    } else {
      helperPath = await ensureNativeCursorMonitorBinary()
    }

    nativeCursorMonitorOutputBuffer = ''
    currentCursorVisualType = 'arrow'
    nativeCursorMonitorProcess = spawn(helperPath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    nativeCursorMonitorProcess.once('error', (error) => {
      console.warn('Native cursor monitor process error:', error)
      nativeCursorMonitorProcess = null
      nativeCursorMonitorOutputBuffer = ''
      currentCursorVisualType = 'arrow'
    })

    nativeCursorMonitorProcess.stdout.on('data', handleCursorMonitorStdout)

    nativeCursorMonitorProcess.once('close', () => {
      nativeCursorMonitorProcess = null
      nativeCursorMonitorOutputBuffer = ''
      currentCursorVisualType = 'arrow'
    })
  } catch (error) {
    console.warn('Failed to start native cursor monitor:', error)
    nativeCursorMonitorProcess = null
    nativeCursorMonitorOutputBuffer = ''
    currentCursorVisualType = 'arrow'
  }
}

function stopNativeCursorMonitor() {
  currentCursorVisualType = 'arrow'

  if (!nativeCursorMonitorProcess) {
    return
  }

  try {
    nativeCursorMonitorProcess.stdin.write('stop\n')
  } catch {
    // ignore stop signal issues
  }
  try {
    nativeCursorMonitorProcess.kill()
  } catch {
    // ignore kill issues
  }

  nativeCursorMonitorProcess = null
  nativeCursorMonitorOutputBuffer = ''
}

async function moveFileWithOverwrite(sourcePath: string, destinationPath: string) {
  await fs.mkdir(path.dirname(destinationPath), { recursive: true })
  await fs.rm(destinationPath, { force: true })

  try {
    await fs.rename(sourcePath, destinationPath)
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code !== 'EXDEV') {
      throw error
    }

    await fs.copyFile(sourcePath, destinationPath)
    await fs.unlink(sourcePath)
  }
}

function isTrustedProjectPath(filePath?: string | null) {
  if (!filePath || !currentProjectPath) {
    return false
  }
  return normalizePath(filePath) === normalizePath(currentProjectPath)
}

const CURSOR_TELEMETRY_VERSION = 2
const CURSOR_SAMPLE_INTERVAL_MS = 33
const MAX_CURSOR_SAMPLES = 60 * 60 * 30 // 1 hour @ 30Hz

type CursorInteractionType = 'move' | 'click' | 'double-click' | 'right-click' | 'middle-click' | 'mouseup'

interface CursorTelemetryPoint {
  timeMs: number
  cx: number
  cy: number
  hidden?: boolean
  interactionType?: CursorInteractionType
  cursorType?: CursorVisualType
}

let cursorCaptureInterval: NodeJS.Timeout | null = null
let cursorCaptureStartTimeMs = 0
let activeCursorSamples: CursorTelemetryPoint[] = []
let pendingCursorSamples: CursorTelemetryPoint[] = []
let isCursorCaptureActive = false
let interactionCaptureCleanup: (() => void) | null = null
let hasLoggedInteractionHookFailure = false
let lastLeftClick: { timeMs: number; cx: number; cy: number } | null = null
let linuxCursorScreenPoint: { x: number; y: number; updatedAt: number } | null = null
let selectedWindowBounds: WindowBounds | null = null
let windowBoundsCaptureInterval: NodeJS.Timeout | null = null

function normalizeHookMouseButton(rawButton: unknown): 1 | 2 | 3 {
  if (typeof rawButton !== 'number' || !Number.isFinite(rawButton)) {
    return 1
  }

  // uiohook/libuiohook button codes are typically 1/2/3. Some wrappers may
  // expose alternate constants depending on platform/runtime.
  if (rawButton === 2 || rawButton === 39) {
    return 2
  }

  if (rawButton === 3 || rawButton === 38) {
    return 3
  }

  return 1
}

function getHookMouseButton(event: any): 1 | 2 | 3 {
  return normalizeHookMouseButton(
    event?.button
    ?? event?.mouseButton
    ?? event?.data?.button
    ?? event?.data?.mouseButton
  )
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function stopCursorCapture() {
  if (cursorCaptureInterval) {
    clearInterval(cursorCaptureInterval)
    cursorCaptureInterval = null
  }
}

function stopInteractionCapture() {
  if (interactionCaptureCleanup) {
    interactionCaptureCleanup()
    interactionCaptureCleanup = null
  }
}

function stopWindowBoundsCapture() {
  if (windowBoundsCaptureInterval) {
    clearInterval(windowBoundsCaptureInterval)
    windowBoundsCaptureInterval = null
  }
  selectedWindowBounds = null
}

function getWindowBoundsFromNativeSource(source?: NativeMacWindowSource | null): WindowBounds | null {
  if (!source) {
    return null
  }

  const { x, y, width, height } = source
  if (
    typeof x !== 'number' || !Number.isFinite(x)
    || typeof y !== 'number' || !Number.isFinite(y)
    || typeof width !== 'number' || !Number.isFinite(width)
    || typeof height !== 'number' || !Number.isFinite(height)
  ) {
    return null
  }

  if (width <= 0 || height <= 0) {
    return null
  }

  return { x, y, width, height }
}

async function resolveMacWindowBounds(source: SelectedSource): Promise<WindowBounds | null> {
  const windowId = parseWindowId(source.id)
  if (!windowId) {
    return null
  }

  try {
    const nativeSources = await getNativeMacWindowSources({ maxAgeMs: 250 })
    const matchedSource = nativeSources.find((entry) => parseWindowId(entry.id) === windowId)
    return getWindowBoundsFromNativeSource(matchedSource)
  } catch {
    return null
  }
}

async function refreshSelectedWindowBounds() {
  if (!selectedSource?.id?.startsWith('window:')) {
    selectedWindowBounds = null
    return
  }

  let bounds: WindowBounds | null = null

  if (process.platform === 'darwin') {
    bounds = await resolveMacWindowBounds(selectedSource)
  } else if (process.platform === 'win32') {
    bounds = await resolveWindowsWindowBounds(selectedSource)
  } else if (process.platform === 'linux') {
    bounds = await resolveLinuxWindowBounds(selectedSource)
  }

  selectedWindowBounds = bounds
}

function startWindowBoundsCapture() {
  stopWindowBoundsCapture()

  if (!['darwin', 'win32', 'linux'].includes(process.platform) || !selectedSource?.id?.startsWith('window:')) {
    return
  }

  void refreshSelectedWindowBounds()
  windowBoundsCaptureInterval = setInterval(() => {
    void refreshSelectedWindowBounds()
  }, 250)
}

function getNormalizedCursorPoint() {
  const fallbackCursor = getScreen().getCursorScreenPoint()
  const linuxCursorCache = process.platform === 'linux' ? linuxCursorScreenPoint : null
  const isLinuxCacheFresh = !!linuxCursorCache
    && Date.now() - linuxCursorCache.updatedAt <= 1000

  const cursor = isLinuxCacheFresh
    ? { x: linuxCursorCache.x, y: linuxCursorCache.y }
    : fallbackCursor

  const windowBounds = selectedSource?.id?.startsWith('window:') ? selectedWindowBounds : null
  if (windowBounds) {
    const width = Math.max(1, windowBounds.width)
    const height = Math.max(1, windowBounds.height)
    const isHidden = cursor.x < windowBounds.x || cursor.x > windowBounds.x + windowBounds.width ||
                     cursor.y < windowBounds.y || cursor.y > windowBounds.y + windowBounds.height

    return {
      cx: clamp((cursor.x - windowBounds.x) / width, 0, 1),
      cy: clamp((cursor.y - windowBounds.y) / height, 0, 1),
      hidden: isHidden,
    }
  }

  const areaBounds = selectedSource?.id === 'area:custom' ? selectedArea : null
  if (areaBounds) {
    const width = Math.max(1, areaBounds.width)
    const height = Math.max(1, areaBounds.height)
    const isHidden = cursor.x < areaBounds.x || cursor.x > areaBounds.x + areaBounds.width ||
                     cursor.y < areaBounds.y || cursor.y > areaBounds.y + areaBounds.height

    return {
      cx: clamp((cursor.x - areaBounds.x) / width, 0, 1),
      cy: clamp((cursor.y - areaBounds.y) / height, 0, 1),
      hidden: isHidden,
    }
  }

  const sourceDisplayId = Number(selectedSource?.display_id)
  const sourceDisplay = Number.isFinite(sourceDisplayId)
    ? getScreen().getAllDisplays().find((display) => display.id === sourceDisplayId) ?? null
    : null
  
  // If we have a specific source display, check if cursor is within it.
  // Otherwise, use the nearest display (no hiding possible if no target display was locked).
  const display = sourceDisplay ?? getScreen().getDisplayNearestPoint(cursor)
  const bounds = display.bounds
  const width = Math.max(1, bounds.width)
  const height = Math.max(1, bounds.height)

  const isHidden = sourceDisplay && (
    cursor.x < bounds.x || cursor.x > bounds.x + bounds.width ||
    cursor.y < bounds.y || cursor.y > bounds.y + bounds.height
  )

  const cx = clamp((cursor.x - bounds.x) / width, 0, 1)
  const cy = clamp((cursor.y - bounds.y) / height, 0, 1)
  return { cx, cy, hidden: !!isHidden }
}

function getHookCursorScreenPoint(event: any): { x: number; y: number } | null {
  const rawX = event?.x ?? event?.data?.x ?? event?.screenX ?? event?.data?.screenX
  const rawY = event?.y ?? event?.data?.y ?? event?.screenY ?? event?.data?.screenY

  if (typeof rawX !== 'number' || !Number.isFinite(rawX) || typeof rawY !== 'number' || !Number.isFinite(rawY)) {
    return null
  }

  return { x: rawX, y: rawY }
}

function pushCursorSample(
  cx: number,
  cy: number,
  timeMs: number,
  interactionType: CursorInteractionType = 'move',
  cursorType?: CursorVisualType,
  hidden?: boolean,
) {
  activeCursorSamples.push({
    timeMs: Math.max(0, timeMs),
    cx,
    cy,
    hidden,
    interactionType,
    cursorType: cursorType ?? currentCursorVisualType,
  })

  if (activeCursorSamples.length > MAX_CURSOR_SAMPLES) {
    activeCursorSamples.shift()
  }
}

function sampleCursorPoint() {
  const point = getNormalizedCursorPoint()
  if (!point) {
    return
  }

  pushCursorSample(point.cx, point.cy, Date.now() - cursorCaptureStartTimeMs, 'move', undefined, point.hidden)
}

async function persistPendingCursorTelemetry(videoPath: string) {
  const telemetryPath = getTelemetryPathForVideo(videoPath)
  if (pendingCursorSamples.length > 0) {
    await fs.writeFile(
      telemetryPath,
      JSON.stringify({ version: CURSOR_TELEMETRY_VERSION, samples: pendingCursorSamples }, null, 2),
      'utf-8'
    )
  }
  pendingCursorSamples = []
}

function snapshotCursorTelemetryForPersistence() {
  if (activeCursorSamples.length === 0) {
    return
  }

  if (pendingCursorSamples.length === 0) {
    pendingCursorSamples = [...activeCursorSamples]
    return
  }

  const lastPendingTimeMs = pendingCursorSamples[pendingCursorSamples.length - 1]?.timeMs ?? -1
  pendingCursorSamples = [
    ...pendingCursorSamples,
    ...activeCursorSamples.filter((sample) => sample.timeMs > lastPendingTimeMs),
  ]
}

async function finalizeStoredVideo(videoPath: string) {
  // Safety net: if companion audio files still exist, the mux was skipped — attempt it now
  if (videoPath.endsWith('.mp4')) {
    const companionCandidates = await getUsableCompanionAudioCandidates(videoPath)
    for (const { systemPath, micPath, platform } of companionCandidates) {
      if (platform === 'mac' || platform === 'win') {
        console.log(`[finalize] Detected un-muxed ${platform} audio files alongside video — attempting safety-net mux`)
        try {
          if (platform === 'win') {
            await muxNativeWindowsVideoWithAudio(videoPath, systemPath, micPath)
          } else {
            await muxNativeMacRecordingWithAudio(videoPath, systemPath, micPath)
          }
          console.log('[finalize] Safety-net mux completed successfully')
        } catch (error) {
          console.warn('[finalize] Safety-net mux failed:', error)
        }
        break
      }
    }
  }

  let validation: { fileSizeBytes: number; durationSeconds: number | null } | null = null
  try {
    validation = await validateRecordedVideo(videoPath)
  } catch (error) {
    console.warn('Video validation failed (proceeding anyway):', error)
  }

  snapshotCursorTelemetryForPersistence()
  currentVideoPath = videoPath
  currentProjectPath = null
  await persistPendingCursorTelemetry(videoPath)
  if (isAutoRecordingPath(videoPath)) {
    await pruneAutoRecordings([videoPath])
  }

  if (lastNativeCaptureDiagnostics?.backend === 'mac-screencapturekit') {
    recordNativeCaptureDiagnostics({
      backend: 'mac-screencapturekit',
      phase: 'stop',
      sourceId: lastNativeCaptureDiagnostics.sourceId ?? null,
      sourceType: lastNativeCaptureDiagnostics.sourceType ?? 'unknown',
      displayId: lastNativeCaptureDiagnostics.displayId ?? null,
      displayBounds: lastNativeCaptureDiagnostics.displayBounds ?? null,
      windowHandle: lastNativeCaptureDiagnostics.windowHandle ?? null,
      helperPath: lastNativeCaptureDiagnostics.helperPath ?? null,
      outputPath: videoPath,
      systemAudioPath: lastNativeCaptureDiagnostics.systemAudioPath ?? null,
      microphonePath: lastNativeCaptureDiagnostics.microphonePath ?? null,
      osRelease: lastNativeCaptureDiagnostics.osRelease,
      supported: lastNativeCaptureDiagnostics.supported,
      helperExists: lastNativeCaptureDiagnostics.helperExists,
      processOutput: lastNativeCaptureDiagnostics.processOutput,
      fileSizeBytes: validation?.fileSizeBytes ?? null,
    })
  }

  return {
    success: true,
    path: videoPath,
    message: validation?.durationSeconds !== null && validation !== null
      ? `Video stored successfully (${validation.fileSizeBytes} bytes, ${validation.durationSeconds.toFixed(2)}s)`
      : `Video stored successfully`
  }
}

async function recoverNativeMacCaptureOutput() {
  const macDiagnostics =
    lastNativeCaptureDiagnostics?.backend === 'mac-screencapturekit'
      ? lastNativeCaptureDiagnostics
      : null
  const diagnosticsPath = macDiagnostics?.outputPath ?? null
  const candidatePath = nativeCaptureTargetPath ?? diagnosticsPath
  const systemAudioPath = nativeCaptureSystemAudioPath ?? macDiagnostics?.systemAudioPath ?? null
  const microphonePath = nativeCaptureMicrophonePath ?? macDiagnostics?.microphonePath ?? null

  if (!candidatePath) {
    return null
  }

  try {
    if (systemAudioPath || microphonePath) {
      try {
        await muxNativeMacRecordingWithAudio(candidatePath, systemAudioPath, microphonePath)
      } catch (muxError) {
        console.warn('Failed to mux audio during recovery:', muxError)
      }
    }

    return await finalizeStoredVideo(candidatePath)
  } catch (error) {
    recordNativeCaptureDiagnostics({
      backend: 'mac-screencapturekit',
      phase: 'stop',
      outputPath: candidatePath,
      systemAudioPath,
      microphonePath,
      processOutput: nativeCaptureOutputBuffer.trim() || undefined,
      fileSizeBytes: await getFileSizeIfPresent(candidatePath),
      error: String(error),
    })
    return null
  }
}

async function startInteractionCapture() {
  if (!isCursorCaptureActive) {
    return
  }

  if (!['darwin', 'win32', 'linux'].includes(process.platform)) {
    return
  }

  try {
    const hook = loadUiohookModule()
    console.log('[CursorTelemetry] hook loaded:', !!hook, 'has.on:', typeof hook?.on, 'has.start:', typeof hook?.start)
    if (!isCursorCaptureActive) {
      return
    }

    if (!hook || typeof hook.on !== 'function' || typeof hook.start !== 'function') {
      console.log('[CursorTelemetry] hook unusable — aborting interaction capture')
      return
    }

    const onMouseDown = (event: any) => {
      if (!isCursorCaptureActive) {
        return
      }

      const point = getNormalizedCursorPoint()
      if (!point) {
        return
      }

      const timeMs = Date.now() - cursorCaptureStartTimeMs
      const button = getHookMouseButton(event)
      let interactionType: CursorInteractionType = 'click'

      if (button === 2) {
        interactionType = 'right-click'
      } else if (button === 3) {
        interactionType = 'middle-click'
      } else {
        const thresholdMs = 350
        const distance = lastLeftClick
          ? Math.hypot(point.cx - lastLeftClick.cx, point.cy - lastLeftClick.cy)
          : Number.POSITIVE_INFINITY

        if (lastLeftClick && timeMs - lastLeftClick.timeMs <= thresholdMs && distance <= 0.04) {
          interactionType = 'double-click'
        }

        lastLeftClick = { timeMs, cx: point.cx, cy: point.cy }
      }

      pushCursorSample(point.cx, point.cy, timeMs, interactionType, undefined, point.hidden)
    }

    const onMouseUp = (_event: any) => {
      if (!isCursorCaptureActive) {
        return
      }

      const point = getNormalizedCursorPoint()
      if (!point) {
        return
      }

      const timeMs = Date.now() - cursorCaptureStartTimeMs
      pushCursorSample(point.cx, point.cy, timeMs, 'mouseup', undefined, point.hidden)
    }

    const onMouseMove = (event: any) => {
      if (process.platform !== 'linux' || !isCursorCaptureActive) {
        return
      }

      const point = getHookCursorScreenPoint(event)
      if (!point) {
        return
      }

      linuxCursorScreenPoint = { x: point.x, y: point.y, updatedAt: Date.now() }
    }

    hook.on('mousedown', onMouseDown)
    hook.on('mouseup', onMouseUp)
    hook.on('mousemove', onMouseMove)

    hook.start()

    interactionCaptureCleanup = () => {
      try {
        if (typeof hook.off === 'function') {
          hook.off('mousedown', onMouseDown)
          hook.off('mouseup', onMouseUp)
          hook.off('mousemove', onMouseMove)
        } else if (typeof hook.removeListener === 'function') {
          hook.removeListener('mousedown', onMouseDown)
          hook.removeListener('mouseup', onMouseUp)
          hook.removeListener('mousemove', onMouseMove)
        }
      } catch {
        // ignore listener cleanup errors
      }

      try {
        if (typeof hook.stop === 'function') {
          hook.stop()
        }
      } catch {
        // ignore hook shutdown errors
      }
    }
  } catch (error) {
    if (!hasLoggedInteractionHookFailure) {
      hasLoggedInteractionHookFailure = true
      console.warn('[CursorTelemetry] Global interaction capture unavailable:', error)
    }
  }
}

function validateRecordingArea(area: any): area is WindowBounds {
  if (!area || typeof area !== 'object') return false
  const { x, y, width, height } = area
  if (![x, y, width, height].every(v => typeof v === 'number' && Number.isFinite(v))) return false
  if (width <= 0 || height <= 0) return false

  const intersectingDisplays = getScreen().getAllDisplays().filter(display => {
    const db = display.bounds
    const ix = Math.max(x, db.x)
    const iy = Math.max(y, db.y)
    const iw = Math.min(x + width, db.x + db.width) - ix
    const ih = Math.min(y + height, db.y + db.height) - iy
    return iw > 0 && ih > 0
  })

  return intersectingDisplays.length === 1
}

export function registerIpcHandlers(
  createEditorWindow: () => void,
  createSourceSelectorWindow: () => void,
  createAreaSelectorWindow: (options?: { displayId?: string }) => BrowserWindow,
  _getMainWindow: () => BrowserWindow | null,
  getSourceSelectorWindow: () => BrowserWindow | null,
  onRecordingStateChange?: (recording: boolean, sourceName: string) => void
) {
  // Load initially selected area if present in settings.
  // We do it here so it's ready when the handlers are registered.
  void (async () => {
    try {
      if (await fs.stat(RECORDINGS_SETTINGS_FILE).catch(() => null)) {
        const content = await fs.readFile(RECORDINGS_SETTINGS_FILE, 'utf-8')
        const parsed = JSON.parse(content) as any
        if (parsed.lastSelectedArea && validateRecordingArea(parsed.lastSelectedArea)) {
          const area = parsed.lastSelectedArea
          selectedArea = area
          // Re-detect display for loaded area
          const targetDisplay = getScreen().getDisplayMatching(area)
          const displayId = targetDisplay ? String(targetDisplay.id) : undefined

          selectedSource = {
            name: `Area: ${Math.round(area.width)}x${Math.round(area.height)}`,
            sourceType: 'screen' as const,
            id: 'area:custom',
            display_id: displayId,
            scaleFactor: targetDisplay?.scaleFactor || 1,
            displayBounds: targetDisplay?.bounds
          }
        }
      }
    } catch (error) {
      console.warn('Failed to load lastSelectedArea:', error)
    }
  })()
  ipcMain.handle('get-sources', async (_, opts) => {
    const includeScreens = Array.isArray(opts?.types) ? opts.types.includes('screen') : true
    const includeWindows = Array.isArray(opts?.types) ? opts.types.includes('window') : true
    const electronTypes = [
      ...(includeScreens ? ['screen' as const] : []),
      ...(includeWindows ? ['window' as const] : []),
    ]
    const electronSources = electronTypes.length > 0
      ? await desktopCapturer.getSources({
          ...opts,
          types: electronTypes,
        }).catch((error) => {
          console.warn('desktopCapturer.getSources failed (screen recording permission may be missing):', error)
          return []
        })
      : []
    const ownWindowNames = new Set(
      [
        app.getName(),
        'Recordly',
        ...BrowserWindow.getAllWindows().flatMap((win) => {
          const title = win.getTitle().trim()
          return title ? [title] : []
        }),
      ]
        .map((name) => normalizeDesktopSourceName(name))
        .filter(Boolean)
    )
    const ownAppName = normalizeDesktopSourceName(app.getName())

    const displays = includeScreens
      ? [...getScreen().getAllDisplays()].sort((left, right) => (
          left.bounds.x - right.bounds.x
          || left.bounds.y - right.bounds.y
          || left.id - right.id
        ))
      : []
    const primaryDisplayId = includeScreens ? String(getScreen().getPrimaryDisplay().id) : ''
    const electronScreenSourcesByDisplayId = new Map(
      electronSources
        .filter((source) => source.id.startsWith('screen:'))
        .map((source) => [String(source.display_id ?? ''), source] as const)
    )

    const screenSources = displays.map((display, index) => {
      const displayId = String(display.id)
      const matchedSource = electronScreenSourcesByDisplayId.get(displayId)
      const displayName = displayId === primaryDisplayId
        ? `Screen ${index + 1} (Primary)`
        : `Screen ${index + 1}`

      return {
        id: matchedSource?.id ?? `screen:fallback:${displayId}`,
        name: displayName,
        originalName: matchedSource?.name ?? displayName,
        display_id: displayId,
        thumbnail: matchedSource?.thumbnail ? matchedSource.thumbnail.toDataURL() : null,
        appIcon: matchedSource?.appIcon ? matchedSource.appIcon.toDataURL() : null,
        sourceType: 'screen' as const,
      }
    })

    if (process.platform !== 'darwin' || !includeWindows) {
      const windowSources = electronSources
        .filter((source) => source.id.startsWith('window:'))
        .filter((source) => hasUsableSourceThumbnail(source.thumbnail))
        .filter((source) => {
          const normalizedName = normalizeDesktopSourceName(source.name)
          if (!normalizedName) {
            return true
          }

          if (ALLOW_RECORDLY_WINDOW_CAPTURE && normalizedName.includes('recordly')) {
            return true
          }

          for (const ownName of ownWindowNames) {
            if (!ownName) continue
            if (normalizedName === ownName) {
              return false
            }
          }

          return true
        })
        .map((source) => ({
          id: source.id,
          name: source.name,
          originalName: source.name,
          display_id: source.display_id,
          thumbnail: source.thumbnail ? source.thumbnail.toDataURL() : null,
          appIcon: source.appIcon ? source.appIcon.toDataURL() : null,
          sourceType: 'window' as const,
        }))

      return [...screenSources, ...windowSources]
    }

    try {
      const nativeWindowSources = await getNativeMacWindowSources()
      const electronWindowSourceMap = new Map(
        electronSources
          .filter((source) => source.id.startsWith('window:'))
          .map((source) => [source.id, source] as const)
      )

      const mergedWindowSources = nativeWindowSources
        .filter((source) => {
          const normalizedWindowName = normalizeDesktopSourceName(source.windowTitle ?? source.name)
          const normalizedAppName = normalizeDesktopSourceName(source.appName ?? '')

          if (!ALLOW_RECORDLY_WINDOW_CAPTURE && normalizedAppName && normalizedAppName === ownAppName) {
            return false
          }

          if (ALLOW_RECORDLY_WINDOW_CAPTURE && (normalizedAppName === 'recordly' || normalizedWindowName?.includes('recordly'))) {
            return true
          }

          if (!normalizedWindowName) {
            return true
          }

          for (const ownName of ownWindowNames) {
            if (!ownName) continue
            if (normalizedWindowName === ownName) {
              return false
            }
          }

          return true
        })
        .map((source) => {
          const electronWindowSource = electronWindowSourceMap.get(source.id)
          return {
            id: source.id,
            name: source.name,
            originalName: source.name,
            display_id: source.display_id ?? electronWindowSource?.display_id ?? '',
            thumbnail: electronWindowSource?.thumbnail ? electronWindowSource.thumbnail.toDataURL() : null,
            appIcon: source.appIcon ?? (electronWindowSource?.appIcon ? electronWindowSource.appIcon.toDataURL() : null),
            appName: source.appName,
            windowTitle: source.windowTitle,
            sourceType: 'window' as const,
          }
        })

      return [...screenSources, ...mergedWindowSources]
    } catch (error) {
      console.warn('Falling back to Electron window enumeration on macOS:', error)

      const windowSources = electronSources
        .filter((source) => source.id.startsWith('window:'))
        .filter((source) => {
          const normalizedName = normalizeDesktopSourceName(source.name)
          if (!normalizedName) {
            return true
          }

          if (ALLOW_RECORDLY_WINDOW_CAPTURE && normalizedName.includes('recordly')) {
            return true
          }

          for (const ownName of ownWindowNames) {
            if (!ownName) continue
            if (normalizedName === ownName || normalizedName.includes(ownName) || ownName.includes(normalizedName)) {
              return false
            }
          }

          return true
        })
        .map((source) => ({
          id: source.id,
          name: source.name,
          originalName: source.name,
          display_id: source.display_id,
          thumbnail: source.thumbnail ? source.thumbnail.toDataURL() : null,
          appIcon: source.appIcon ? source.appIcon.toDataURL() : null,
          sourceType: 'window' as const,
        }))

      return [...screenSources, ...windowSources]
    }
  })

  ipcMain.handle('open-area-selector', (_, options?: { displayId?: string }) => {
    // Save the current screen source so we can revert on cancel
    if (selectedSource?.id?.startsWith('screen:')) {
      previousScreenSource = selectedSource
    }
    const win = createAreaSelectorWindow(options)
    const bounds = win.getBounds()
    selectorWindowOrigin = { x: bounds.x, y: bounds.y }
  })

  ipcMain.handle('cancel-area-selector', () => {
    // Revert to the previous screen source (fullscreen)
    if (previousScreenSource) {
      selectedSource = previousScreenSource
      selectedArea = null
      broadcastSelectedSourceChange()
    }
    BrowserWindow.getAllWindows().forEach(win => {
      if (win.webContents.getURL().includes('windowType=area-selector')) {
        win.close()
      }
    })
  })

  ipcMain.handle('set-selected-area', async (_event, area: WindowBounds) => {
    // Convert relative window coordinates to global screen coordinates using
    // our stored origin, rather than win.getBounds(), to avoid macOS frame drift.
    const globalArea = {
      x: area.x + selectorWindowOrigin.x,
      y: area.y + selectorWindowOrigin.y,
      width: area.width,
      height: area.height
    }

    if (!validateRecordingArea(globalArea)) {
      console.warn('Rejecting area selection: invalid or spans multiple monitors')
      return { success: false, error: 'Select a valid area on a single monitor' }
    }

    // Detect which display contains this area
    const targetDisplay = getScreen().getDisplayMatching(globalArea)
    const displayId = targetDisplay ? String(targetDisplay.id) : undefined

    selectedArea = globalArea
    selectedSource = {
      name: `Area: ${Math.round(area.width)}x${Math.round(area.height)}`,
      sourceType: 'screen' as const,
      id: 'area:custom',
      display_id: displayId,
      scaleFactor: targetDisplay?.scaleFactor || 1,
      displayBounds: targetDisplay?.bounds
    }
    broadcastSelectedSourceChange()

    // Also close the source selector if open
    getSourceSelectorWindow()?.close()

    // Persist to settings
    try {
      let existing: any = {}
      try {
        const content = await fs.readFile(RECORDINGS_SETTINGS_FILE, 'utf-8')
        existing = JSON.parse(content)
      } catch {}
      const merged = { ...existing, lastSelectedArea: globalArea }
      await fs.writeFile(RECORDINGS_SETTINGS_FILE, JSON.stringify(merged, null, 2), 'utf-8')
    } catch (error) {
      console.error('Failed to persist selected area:', error)
    }

    return { success: true }
  })

  ipcMain.handle('get-selected-area', () => {
    return selectedArea
  })

  ipcMain.handle('select-source', (_, source: SelectedSource) => {
    selectedSource = source
    broadcastSelectedSourceChange()
    stopWindowBoundsCapture()
    const sourceSelectorWin = getSourceSelectorWindow()
    if (sourceSelectorWin) {
      sourceSelectorWin.close()
    }
    return selectedSource
  })

  ipcMain.handle('show-source-highlight', async (_, source: SelectedSource) => {
    try {
      const isWindow = source.id?.startsWith('window:')
      const windowId = isWindow ? parseWindowId(source.id) : null

      // ── 1. Bring window to front ──
      if (isWindow && process.platform === 'darwin') {
        const appName = source.appName || source.name?.split(' — ')[0]?.trim()
        if (appName) {
          try {
            await execFileAsync('osascript', ['-e',
              `tell application "${appName}" to activate`
            ], { timeout: 2000 })
            await new Promise((resolve) => setTimeout(resolve, 350))
          } catch { /* ignore */ }
        }
      } else if (windowId && process.platform === 'linux') {
        try {
          await execFileAsync('wmctrl', ['-i', '-a', `0x${windowId.toString(16)}`], { timeout: 1500 })
        } catch {
          try {
            await execFileAsync('xdotool', ['windowactivate', String(windowId)], { timeout: 1500 })
          } catch { /* not available */ }
        }
        await new Promise((resolve) => setTimeout(resolve, 250))
      }

      // ── 2. Resolve bounds ──
      let bounds: { x: number; y: number; width: number; height: number } | null = null

      if (source.id?.startsWith('screen:')) {
        bounds = getDisplayBoundsForSource(source)
      } else if (isWindow) {
        if (process.platform === 'darwin') {
          bounds = await resolveMacWindowBounds(source)
        } else if (process.platform === 'win32') {
          bounds = await resolveWindowsWindowBounds(source)
        } else if (process.platform === 'linux') {
          bounds = await resolveLinuxWindowBounds(source)
        }
      }

      if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
        bounds = getDisplayBoundsForSource(source)
      }

      // ── 3. Show traveling wave highlight ──
      const pad = 6
      const highlightWin = new BrowserWindow({
        x: bounds.x - pad,
        y: bounds.y - pad,
        width: bounds.width + pad * 2,
        height: bounds.height + pad * 2,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        hasShadow: false,
        resizable: false,
        focusable: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      })

      highlightWin.setIgnoreMouseEvents(true)

      const html = `<!DOCTYPE html>
<html><head><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:transparent;overflow:hidden;width:100vw;height:100vh}

.border-wrap{
  position:fixed;inset:0;border-radius:10px;padding:3px;
  background:conic-gradient(from var(--angle,0deg),
    transparent 0%,
    transparent 60%,
    rgba(99,96,245,.15) 70%,
    rgba(99,96,245,.9) 80%,
    rgba(123,120,255,1) 85%,
    rgba(99,96,245,.9) 90%,
    rgba(99,96,245,.15) 95%,
    transparent 100%
  );
  -webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);
  -webkit-mask-composite:xor;
  mask-composite:exclude;
  animation:spin 1.2s linear forwards, fadeAll 1.6s ease-out forwards;
}

.glow-wrap{
  position:fixed;inset:-4px;border-radius:14px;padding:6px;
  background:conic-gradient(from var(--angle,0deg),
    transparent 0%,
    transparent 65%,
    rgba(99,96,245,.3) 78%,
    rgba(123,120,255,.5) 85%,
    rgba(99,96,245,.3) 92%,
    transparent 100%
  );
  -webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);
  -webkit-mask-composite:xor;
  mask-composite:exclude;
  filter:blur(8px);
  animation:spin 1.2s linear forwards, fadeAll 1.6s ease-out forwards;
}

@property --angle{
  syntax:'<angle>';
  initial-value:0deg;
  inherits:false;
}

@keyframes spin{
  0%{--angle:0deg}
  100%{--angle:360deg}
}

@keyframes fadeAll{
  0%,60%{opacity:1}
  100%{opacity:0}
}
</style></head><body>
<div class="glow-wrap"></div>
<div class="border-wrap"></div>
</body></html>`

      await highlightWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)

      setTimeout(() => {
        if (!highlightWin.isDestroyed()) highlightWin.close()
      }, 1700)

      return { success: true }
    } catch (error) {
      console.error('Failed to show source highlight:', error)
      return { success: false }
    }
  })

  ipcMain.handle('get-selected-source', () => {
    return selectedSource
  })

  ipcMain.handle('open-source-selector', () => {
    const sourceSelectorWin = getSourceSelectorWindow()
    if (sourceSelectorWin) {
      sourceSelectorWin.focus()
      return
    }
    createSourceSelectorWindow()
  })

  ipcMain.handle('switch-to-editor', () => {
    console.log('[switch-to-editor] Opening editor window')
    createEditorWindow()
  })

  ipcMain.handle('start-native-screen-recording', async (_, source: SelectedSource, options?: NativeMacRecordingOptions) => {
    // Windows native capture path
    if (process.platform === 'win32') {
      const windowsCaptureAvailable = await isNativeWindowsCaptureAvailable()
      if (!windowsCaptureAvailable) {
        return { success: false, message: 'Native Windows capture is not available on this system.' }
      }

      if (windowsCaptureProcess && !windowsNativeCaptureActive) {
        try { windowsCaptureProcess.kill() } catch { /* ignore */ }
        windowsCaptureProcess = null
        windowsCaptureTargetPath = null
        windowsCaptureStopRequested = false
      }

      if (windowsCaptureProcess) {
        return { success: false, message: 'A native Windows screen recording is already active.' }
      }

      try {
        const exePath = getWindowsCaptureExePath()
        const recordingsDir = await getRecordingsDir()
        const timestamp = Date.now()
        const outputPath = path.join(recordingsDir, `recording-${timestamp}.mp4`)
        const displayBounds = source?.id?.startsWith('window:') ? null : getDisplayBoundsForSource(source)

        const config: Record<string, unknown> = {
          outputPath,
          fps: 60,
        }

        if (options?.capturesSystemAudio) {
          const audioPath = path.join(recordingsDir, `recording-${timestamp}.system.wav`)
          config.captureSystemAudio = true
          config.audioOutputPath = audioPath
          windowsSystemAudioPath = audioPath
        }

        if (options?.capturesMicrophone) {
          const micPath = path.join(recordingsDir, `recording-${timestamp}.mic.wav`)
          config.captureMic = true
          config.micOutputPath = micPath
          if (options.microphoneLabel) {
            config.micDeviceName = options.microphoneLabel
          }
          windowsMicAudioPath = micPath
        }

        const windowId = parseWindowId(source?.id)
        if (windowId && source?.id?.startsWith('window:')) {
          config.windowHandle = windowId
        } else {
          const resolvedDisplay = resolveWindowsCaptureDisplay(
            source,
            getScreen().getAllDisplays(),
            getScreen().getPrimaryDisplay(),
          )
          config.displayId = resolvedDisplay.displayId

          // Monitor handle IDs can drift across Electron/Windows capture boundaries,
          // so also provide display bounds for a coordinate-based native fallback.
          config.displayX = Math.round(resolvedDisplay.bounds.x)
          config.displayY = Math.round(resolvedDisplay.bounds.y)
          config.displayW = Math.round(resolvedDisplay.bounds.width)
          config.displayH = Math.round(resolvedDisplay.bounds.height)
        }

        if (source?.id === 'area:custom' && selectedArea) {
          // Identify the target display for DPI scaling.
          const targetDisplay = getScreen().getDisplayMatching(selectedArea);
          const sf = targetDisplay.scaleFactor || 1;

          // IMPORTANT: WGC capture requires crop coordinates to be relative to the monitor, in RAW pixels.
          // Since we passed config.displayX/Y above as DIP (handled by findMonitorByBounds fallback),
          // or matched by handle ID, we must now provide the crop in monitor-local pixels.
          
          // 1. Calculate global screen coordinates in pixels
          const globalXPixels = Math.round(selectedArea.x * sf);
          const globalYPixels = Math.round(selectedArea.y * sf);
          
          // 2. Calculate display top-left in pixels (using Electron's display bounds converted to pixels)
          const displayXPixels = Math.round(targetDisplay.bounds.x * sf);
          const displayYPixels = Math.round(targetDisplay.bounds.y * sf);

          const finalW = Math.round(selectedArea.width * sf);
          const finalH = Math.round(selectedArea.height * sf);
          
          // Boundary safety for H.264 (ensure even dims)
          config.cropX = Math.round(globalXPixels - displayXPixels);
          config.cropY = Math.round(globalYPixels - displayYPixels);
          config.cropWidth = Math.floor(finalW / 2) * 2;
          config.cropHeight = Math.floor(finalH / 2) * 2;
        }

        recordNativeCaptureDiagnostics({
          backend: 'windows-wgc',
          phase: 'start',
          sourceId: source?.id ?? null,
          sourceType: source?.sourceType ?? 'unknown',
          displayId: typeof config.displayId === 'number' ? config.displayId : null,
          displayBounds,
          windowHandle: typeof config.windowHandle === 'number' ? config.windowHandle : null,
          helperPath: exePath,
          outputPath,
          systemAudioPath: windowsSystemAudioPath,
          microphonePath: windowsMicAudioPath,
        })

        windowsCaptureOutputBuffer = ''
        windowsCaptureTargetPath = outputPath
        windowsCaptureStopRequested = false
        windowsCapturePaused = false
        windowsCaptureProcess = spawn(exePath, [JSON.stringify(config)], {
          cwd: recordingsDir,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
        attachWindowsCaptureLifecycle(windowsCaptureProcess)

        windowsCaptureProcess.stdout.on('data', (chunk: Buffer) => {
          windowsCaptureOutputBuffer += chunk.toString()
        })
        windowsCaptureProcess.stderr.on('data', (chunk: Buffer) => {
          windowsCaptureOutputBuffer += chunk.toString()
        })

        await waitForWindowsCaptureStart(windowsCaptureProcess)
        windowsNativeCaptureActive = true
        nativeScreenRecordingActive = true
        recordNativeCaptureDiagnostics({
          backend: 'windows-wgc',
          phase: 'start',
          sourceId: source?.id ?? null,
          sourceType: source?.sourceType ?? 'unknown',
          displayId: typeof config.displayId === 'number' ? config.displayId : null,
          displayBounds,
          windowHandle: typeof config.windowHandle === 'number' ? config.windowHandle : null,
          helperPath: exePath,
          outputPath,
          systemAudioPath: windowsSystemAudioPath,
          microphonePath: windowsMicAudioPath,
          processOutput: windowsCaptureOutputBuffer.trim() || undefined,
        })
        return { success: true }
      } catch (error) {
        recordNativeCaptureDiagnostics({
          backend: 'windows-wgc',
          phase: 'start',
          sourceId: source?.id ?? null,
          sourceType: source?.sourceType ?? 'unknown',
          helperPath: windowsCaptureTargetPath ? getWindowsCaptureExePath() : null,
          outputPath: windowsCaptureTargetPath,
          systemAudioPath: windowsSystemAudioPath,
          microphonePath: windowsMicAudioPath,
          processOutput: windowsCaptureOutputBuffer.trim() || undefined,
          error: String(error),
        })
        console.error('Failed to start native Windows capture:', error)
        try { windowsCaptureProcess?.kill() } catch { /* ignore */ }
        windowsNativeCaptureActive = false
        nativeScreenRecordingActive = false
        windowsCaptureProcess = null
        windowsCaptureTargetPath = null
        windowsCaptureStopRequested = false
        windowsCapturePaused = false
        return {
          success: false,
          message: 'Failed to start native Windows capture',
          error: String(error),
        }
      }
    }

    if (process.platform !== 'darwin') {
      return { success: false, message: 'Native screen recording is only available on macOS.' }
    }

    if (nativeCaptureProcess && !nativeScreenRecordingActive) {
      try {
        nativeCaptureProcess.kill()
      } catch {
        // ignore stale helper cleanup failures
      }
      nativeCaptureProcess = null
      nativeCaptureTargetPath = null
      nativeCaptureStopRequested = false
    }

    if (nativeCaptureProcess) {
      return { success: false, message: 'A native screen recording is already active.' }
    }

    try {
      const recordingsDir = await getRecordingsDir()

      // Warm up TCC: trigger an Electron-level screen capture API call so macOS
      // activates the screen-recording grant for this process tree before the
      // native helper binary spawns and calls SCStream.startCapture().
      try {
        await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
      } catch {
        // non-fatal – the helper will report its own TCC status
      }

      // Ensure microphone TCC is granted for this process tree when mic capture
      // is requested, so the child helper inherits the grant.
      if (options?.capturesMicrophone) {
        const micStatus = systemPreferences.getMediaAccessStatus('microphone')
        if (micStatus !== 'granted') {
          await systemPreferences.askForMediaAccess('microphone')
        }
      }

      const appName = normalizeDesktopSourceName(String(source?.appName ?? ''))
      const ownAppName = normalizeDesktopSourceName(app.getName())
      if (
        !ALLOW_RECORDLY_WINDOW_CAPTURE
        &&
        source?.id?.startsWith('window:')
        && appName
        && (appName === ownAppName || appName === 'recordly')
      ) {
        return { success: false, message: 'Cannot record Recordly windows. Please select another app window.' }
      }

      const helperPath = await ensureNativeCaptureHelperBinary()
      const timestamp = Date.now()
      const outputPath = path.join(recordingsDir, `recording-${timestamp}.mp4`)
      const capturesSystemAudio = Boolean(options?.capturesSystemAudio)
      const capturesMicrophone = Boolean(options?.capturesMicrophone)
      const systemAudioOutputPath = capturesSystemAudio
        ? path.join(recordingsDir, `recording-${timestamp}.system.m4a`)
        : null
      const microphoneOutputPath = capturesMicrophone
        ? path.join(recordingsDir, `recording-${timestamp}.mic.m4a`)
        : null
      const config: Record<string, unknown> = {
        fps: 60,
        outputPath,
        capturesSystemAudio,
        capturesMicrophone,
      }

      if (options?.microphoneDeviceId) {
        config.microphoneDeviceId = options.microphoneDeviceId
      }

      if (options?.microphoneLabel) {
        config.microphoneLabel = options.microphoneLabel
      }

      if (systemAudioOutputPath) {
        config.systemAudioOutputPath = systemAudioOutputPath
      }

      if (microphoneOutputPath) {
        config.microphoneOutputPath = microphoneOutputPath
      }

      const windowId = parseWindowId(source?.id)
      const screenId = Number(source?.display_id)

      if (Number.isFinite(windowId) && windowId && source?.id?.startsWith('window:')) {
        config.windowId = windowId
      } else if (Number.isFinite(screenId) && screenId > 0) {
        config.displayId = screenId
      } else {
        config.displayId = Number(getScreen().getPrimaryDisplay().id)
      }

      if (source?.id === 'area:custom' && selectedArea) {
        config.cropX = selectedArea.x
        config.cropY = selectedArea.y
        config.cropWidth = selectedArea.width
        config.cropHeight = selectedArea.height
      }

      nativeCaptureOutputBuffer = ''
      nativeCaptureTargetPath = outputPath
      nativeCaptureSystemAudioPath = systemAudioOutputPath
      nativeCaptureMicrophonePath = microphoneOutputPath
      nativeCaptureStopRequested = false
      nativeCapturePaused = false
      nativeCaptureProcess = spawn(helperPath, [JSON.stringify(config)], {
        cwd: recordingsDir,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      attachNativeCaptureLifecycle(nativeCaptureProcess)

      nativeCaptureProcess.stdout.on('data', (chunk: Buffer) => {
        nativeCaptureOutputBuffer += chunk.toString()
      })
      nativeCaptureProcess.stderr.on('data', (chunk: Buffer) => {
        nativeCaptureOutputBuffer += chunk.toString()
      })

      await waitForNativeCaptureStart(nativeCaptureProcess)
      nativeScreenRecordingActive = true
      recordNativeCaptureDiagnostics({
        backend: 'mac-screencapturekit',
        phase: 'start',
        sourceId: source?.id ?? null,
        sourceType: source?.sourceType ?? 'unknown',
        displayId: typeof config.displayId === 'number' ? config.displayId : null,
        helperPath,
        outputPath,
        systemAudioPath: systemAudioOutputPath,
        microphonePath: microphoneOutputPath,
        processOutput: nativeCaptureOutputBuffer.trim() || undefined,
      })
      return { success: true }
    } catch (error) {
      console.error('Failed to start native ScreenCaptureKit recording:', error)
      const errorStr = String(error)

      // Detect TCC (screen recording permission) errors and show a helpful dialog
      if (errorStr.includes('declined TCC') || errorStr.includes('declined TCCs') || errorStr.includes('SCREEN_RECORDING_PERMISSION_DENIED')) {
        const { response } = await dialog.showMessageBox({
          type: 'warning',
          title: 'Screen Recording Permission Required',
          message: 'Recordly needs screen recording permission to capture your screen.',
          detail: 'Please open System Settings > Privacy & Security > Screen Recording, make sure Recordly is toggled ON, then try recording again.',
          buttons: ['Open System Settings', 'Cancel'],
          defaultId: 0,
          cancelId: 1,
        })
        if (response === 0) {
          await shell.openExternal(getMacPrivacySettingsUrl('screen'))
        }
        try { nativeCaptureProcess?.kill() } catch { /* ignore */ }
        nativeScreenRecordingActive = false
        nativeCaptureProcess = null
        nativeCaptureTargetPath = null
        nativeCaptureSystemAudioPath = null
        nativeCaptureMicrophonePath = null
        nativeCaptureStopRequested = false
        nativeCapturePaused = false
        return {
          success: false,
          message: 'Screen recording permission not granted. Please allow access in System Settings and restart the app.',
          userNotified: true,
        }
      }

      if (errorStr.includes('MICROPHONE_PERMISSION_DENIED')) {
        const { response } = await dialog.showMessageBox({
          type: 'warning',
          title: 'Microphone Permission Required',
          message: 'Recordly needs microphone permission to record audio.',
          detail: 'Please open System Settings > Privacy & Security > Microphone, make sure Recordly is toggled ON, then try recording again.',
          buttons: ['Open System Settings', 'Cancel'],
          defaultId: 0,
          cancelId: 1,
        })
        if (response === 0) {
          await shell.openExternal(getMacPrivacySettingsUrl('microphone'))
        }
        try { nativeCaptureProcess?.kill() } catch { /* ignore */ }
        nativeScreenRecordingActive = false
        nativeCaptureProcess = null
        nativeCaptureTargetPath = null
        nativeCaptureSystemAudioPath = null
        nativeCaptureMicrophonePath = null
        nativeCaptureStopRequested = false
        nativeCapturePaused = false
        return {
          success: false,
          message: 'Microphone permission not granted. Please allow access in System Settings.',
          userNotified: true,
        }
      }

      recordNativeCaptureDiagnostics({
        backend: 'mac-screencapturekit',
        phase: 'start',
        sourceId: source?.id ?? null,
        sourceType: source?.sourceType ?? 'unknown',
        helperPath: getNativeCaptureHelperBinaryPath(),
        outputPath: nativeCaptureTargetPath,
        systemAudioPath: nativeCaptureSystemAudioPath,
        microphonePath: nativeCaptureMicrophonePath,
        processOutput: nativeCaptureOutputBuffer.trim() || undefined,
        fileSizeBytes: await getFileSizeIfPresent(nativeCaptureTargetPath),
        error: String(error),
      })
      try {
        nativeCaptureProcess?.kill()
      } catch {
        // ignore cleanup failures
      }
      nativeScreenRecordingActive = false
      nativeCaptureProcess = null
      nativeCaptureTargetPath = null
      nativeCaptureSystemAudioPath = null
      nativeCaptureMicrophonePath = null
      nativeCaptureStopRequested = false
      nativeCapturePaused = false
      return {
        success: false,
        message: 'Failed to start native ScreenCaptureKit recording',
        error: String(error),
      }
    }
  })

  ipcMain.handle('stop-native-screen-recording', async () => {
    // Windows native capture stop path
    if (process.platform === 'win32' && windowsNativeCaptureActive) {
      try {
        if (!windowsCaptureProcess) {
          throw new Error('Native Windows capture process is not running')
        }

        const proc = windowsCaptureProcess
        const preferredVideoPath = windowsCaptureTargetPath
        windowsCaptureStopRequested = true
        proc.stdin.write('stop\n')
        const tempVideoPath = await waitForWindowsCaptureStop(proc)
        windowsCaptureProcess = null
        windowsNativeCaptureActive = false
        nativeScreenRecordingActive = false
        windowsCaptureTargetPath = null
        windowsCaptureStopRequested = false
        windowsCapturePaused = false

        const finalVideoPath = preferredVideoPath ?? tempVideoPath
        if (tempVideoPath !== finalVideoPath) {
          await moveFileWithOverwrite(tempVideoPath, finalVideoPath)
        }

        windowsPendingVideoPath = finalVideoPath
        recordNativeCaptureDiagnostics({
          backend: 'windows-wgc',
          phase: 'stop',
          outputPath: finalVideoPath,
          systemAudioPath: windowsSystemAudioPath,
          microphonePath: windowsMicAudioPath,
          processOutput: windowsCaptureOutputBuffer.trim() || undefined,
          fileSizeBytes: await getFileSizeIfPresent(finalVideoPath),
        })
        return { success: true, path: finalVideoPath }
      } catch (error) {
        console.error('Failed to stop native Windows capture:', error)
        const fallbackPath = windowsCaptureTargetPath
        windowsNativeCaptureActive = false
        nativeScreenRecordingActive = false
        windowsCaptureProcess = null
        windowsCaptureTargetPath = null
        windowsCaptureStopRequested = false
        windowsCapturePaused = false
        windowsSystemAudioPath = null
        windowsMicAudioPath = null
        windowsPendingVideoPath = null

        if (fallbackPath) {
          try {
            await fs.access(fallbackPath)
            windowsPendingVideoPath = fallbackPath
            recordNativeCaptureDiagnostics({
              backend: 'windows-wgc',
              phase: 'stop',
              outputPath: fallbackPath,
              systemAudioPath: windowsSystemAudioPath,
              microphonePath: windowsMicAudioPath,
              processOutput: windowsCaptureOutputBuffer.trim() || undefined,
              fileSizeBytes: await getFileSizeIfPresent(fallbackPath),
              error: String(error),
            })
            return { success: true, path: fallbackPath }
          } catch {
            // File doesn't exist
          }
        }

        recordNativeCaptureDiagnostics({
          backend: 'windows-wgc',
          phase: 'stop',
          outputPath: fallbackPath,
          systemAudioPath: windowsSystemAudioPath,
          microphonePath: windowsMicAudioPath,
          processOutput: windowsCaptureOutputBuffer.trim() || undefined,
          error: String(error),
        })

        return {
          success: false,
          message: 'Failed to stop native Windows capture',
          error: String(error),
        }
      }
    }

    if (process.platform !== 'darwin') {
      return { success: false, message: 'Native screen recording is only available on macOS.' }
    }

    if (!nativeScreenRecordingActive) {
      const recovered = await recoverNativeMacCaptureOutput()
      if (recovered) {
        return recovered
      }

      return { success: false, message: 'No native screen recording is active.' }
    }

    try {
      if (!nativeCaptureProcess) {
        throw new Error('Native capture helper process is not running')
      }

      const process = nativeCaptureProcess
      const preferredVideoPath = nativeCaptureTargetPath
      const preferredSystemAudioPath = nativeCaptureSystemAudioPath
      const preferredMicrophonePath = nativeCaptureMicrophonePath
      console.log('[stop-native] Audio paths — system:', preferredSystemAudioPath, 'mic:', preferredMicrophonePath)
      nativeCaptureStopRequested = true
      process.stdin.write('stop\n')
      const tempVideoPath = await waitForNativeCaptureStop(process)
      console.log('[stop-native] Helper stopped, tempVideoPath:', tempVideoPath)
      nativeCaptureProcess = null
      nativeScreenRecordingActive = false
      nativeCaptureTargetPath = null
      nativeCaptureSystemAudioPath = null
      nativeCaptureMicrophonePath = null
      nativeCaptureStopRequested = false
      nativeCapturePaused = false

      const finalVideoPath = preferredVideoPath ?? tempVideoPath
      if (tempVideoPath !== finalVideoPath) {
        await moveFileWithOverwrite(tempVideoPath, finalVideoPath)
      }

      if (preferredSystemAudioPath || preferredMicrophonePath) {
        console.log('[stop-native] Attempting audio mux (merging separate tracks) into:', finalVideoPath)
        try {
          await muxNativeMacRecordingWithAudio(finalVideoPath, preferredSystemAudioPath, preferredMicrophonePath)
          console.log('[stop-native] Audio mux completed successfully')
        } catch (error) {
          console.warn('[stop-native] Audio mux failed (video still has inline audio):', error)
        }
      } else {
        console.log('[stop-native] No separate audio tracks to mux')
      }

      return await finalizeStoredVideo(finalVideoPath)
    } catch (error) {
      console.error('Failed to stop native ScreenCaptureKit recording:', error)
      const fallbackPath = nativeCaptureTargetPath
      const fallbackSystemAudioPath = nativeCaptureSystemAudioPath
      const fallbackMicrophonePath = nativeCaptureMicrophonePath
      const fallbackFileSizeBytes = await getFileSizeIfPresent(fallbackPath)
      nativeScreenRecordingActive = false
      nativeCaptureProcess = null
      nativeCaptureTargetPath = null
      nativeCaptureSystemAudioPath = null
      nativeCaptureMicrophonePath = null
      nativeCaptureStopRequested = false
      nativeCapturePaused = false

      recordNativeCaptureDiagnostics({
        backend: 'mac-screencapturekit',
        phase: 'stop',
        sourceId: lastNativeCaptureDiagnostics?.sourceId ?? null,
        sourceType: lastNativeCaptureDiagnostics?.sourceType ?? 'unknown',
        displayId: lastNativeCaptureDiagnostics?.displayId ?? null,
        displayBounds: lastNativeCaptureDiagnostics?.displayBounds ?? null,
        windowHandle: lastNativeCaptureDiagnostics?.windowHandle ?? null,
        helperPath: lastNativeCaptureDiagnostics?.helperPath ?? null,
        outputPath: fallbackPath,
        systemAudioPath: fallbackSystemAudioPath,
        microphonePath: fallbackMicrophonePath,
        osRelease: lastNativeCaptureDiagnostics?.osRelease,
        supported: lastNativeCaptureDiagnostics?.supported,
        helperExists: lastNativeCaptureDiagnostics?.helperExists,
        processOutput: nativeCaptureOutputBuffer.trim() || undefined,
        fileSizeBytes: fallbackFileSizeBytes,
        error: String(error),
      })

      // Try to recover: if the target file exists on disk, finalize with it
      if (fallbackPath) {
        try {
          await fs.access(fallbackPath)
          console.log('[stop-native-screen-recording] Recovering with fallback path:', fallbackPath)
          if (fallbackSystemAudioPath || fallbackMicrophonePath) {
            try {
              await muxNativeMacRecordingWithAudio(
                fallbackPath,
                fallbackSystemAudioPath,
                fallbackMicrophonePath,
              )
            } catch (muxError) {
              console.warn('Failed to mux recovered native macOS audio into capture:', muxError)
            }
          }
          return await finalizeStoredVideo(fallbackPath)
        } catch {
          // File doesn't exist or isn't accessible
        }
      }

      const recovered = await recoverNativeMacCaptureOutput()
      if (recovered) {
        return recovered
      }

      return {
        success: false,
        message: 'Failed to stop native ScreenCaptureKit recording',
        error: String(error),
      }
    }
  })

  ipcMain.handle('recover-native-screen-recording', async () => {
    if (process.platform !== 'darwin') {
      return { success: false, message: 'Native screen recording recovery is only available on macOS.' }
    }

    const recovered = await recoverNativeMacCaptureOutput()
    if (recovered) {
      return recovered
    }

    return {
      success: false,
      message: 'No recoverable native macOS recording output was found.',
    }
  })

  ipcMain.handle('pause-native-screen-recording', async () => {
    if (process.platform === 'win32') {
      if (!windowsNativeCaptureActive || !windowsCaptureProcess) {
        return { success: false, message: 'No native Windows screen recording is active.' }
      }

      if (windowsCapturePaused) {
        return { success: true }
      }

      try {
        windowsCaptureProcess.stdin.write('pause\n')
        windowsCapturePaused = true
        return { success: true }
      } catch (error) {
        return { success: false, message: 'Failed to pause native Windows capture', error: String(error) }
      }
    }

    if (process.platform !== 'darwin') {
      return { success: false, message: 'Native screen recording is only available on macOS.' }
    }

    if (!nativeScreenRecordingActive || !nativeCaptureProcess) {
      return { success: false, message: 'No native screen recording is active.' }
    }

    if (nativeCapturePaused) {
      return { success: true }
    }

    try {
      nativeCaptureProcess.stdin.write('pause\n')
      nativeCapturePaused = true
      return { success: true }
    } catch (error) {
      return { success: false, message: 'Failed to pause native screen recording', error: String(error) }
    }
  })

  ipcMain.handle('resume-native-screen-recording', async () => {
    if (process.platform === 'win32') {
      if (!windowsNativeCaptureActive || !windowsCaptureProcess) {
        return { success: false, message: 'No native Windows screen recording is active.' }
      }

      if (!windowsCapturePaused) {
        return { success: true }
      }

      try {
        windowsCaptureProcess.stdin.write('resume\n')
        windowsCapturePaused = false
        return { success: true }
      } catch (error) {
        return { success: false, message: 'Failed to resume native Windows capture', error: String(error) }
      }
    }

    if (process.platform !== 'darwin') {
      return { success: false, message: 'Native screen recording is only available on macOS.' }
    }

    if (!nativeScreenRecordingActive || !nativeCaptureProcess) {
      return { success: false, message: 'No native screen recording is active.' }
    }

    if (!nativeCapturePaused) {
      return { success: true }
    }

    try {
      nativeCaptureProcess.stdin.write('resume\n')
      nativeCapturePaused = false
      return { success: true }
    } catch (error) {
      return { success: false, message: 'Failed to resume native screen recording', error: String(error) }
    }
  })

  ipcMain.handle('get-system-cursor-assets', async () => {
    try {
      return { success: true, cursors: await getSystemCursorAssets() }
    } catch (error) {
      console.error('Failed to load system cursor assets:', error)
      return { success: false, cursors: {}, error: String(error) }
    }
  })

  ipcMain.handle('is-native-windows-capture-available', async () => {
    return { available: await isNativeWindowsCaptureAvailable() }
  })

  ipcMain.handle('get-last-native-capture-diagnostics', async () => {
    return { success: true, diagnostics: lastNativeCaptureDiagnostics }
  })

  ipcMain.handle('get-video-audio-fallback-paths', async (_event, videoPath: string) => {
    if (!videoPath) {
      return { success: true, paths: [] }
    }

    try {
      return { success: true, paths: await getCompanionAudioFallbackPaths(videoPath) }
    } catch (error) {
      console.error('Failed to resolve companion audio fallback paths:', error)
      return { success: false, paths: [], error: String(error) }
    }
  })

  ipcMain.handle('mux-native-windows-recording', async (_event, pauseSegments?: PauseSegment[]) => {
    const videoPath = windowsPendingVideoPath
    windowsPendingVideoPath = null

    if (!videoPath) {
      return { success: false, message: 'No native Windows video pending for mux' }
    }

    try {
      if (windowsSystemAudioPath || windowsMicAudioPath) {
        await muxNativeWindowsVideoWithAudio(videoPath, windowsSystemAudioPath, windowsMicAudioPath, pauseSegments ?? [])
        windowsSystemAudioPath = null
        windowsMicAudioPath = null
      }

      recordNativeCaptureDiagnostics({
        backend: 'windows-wgc',
        phase: 'mux',
        outputPath: videoPath,
        fileSizeBytes: await getFileSizeIfPresent(videoPath),
      })
      return await finalizeStoredVideo(videoPath)
    } catch (error) {
      console.error('Failed to mux native Windows recording:', error)
      recordNativeCaptureDiagnostics({
        backend: 'windows-wgc',
        phase: 'mux',
        outputPath: videoPath,
        systemAudioPath: windowsSystemAudioPath,
        microphonePath: windowsMicAudioPath,
        fileSizeBytes: await getFileSizeIfPresent(videoPath),
        error: String(error),
      })
      windowsSystemAudioPath = null
      windowsMicAudioPath = null
      try {
        return await finalizeStoredVideo(videoPath)
      } catch {
        return { success: false, message: 'Failed to mux native Windows recording', error: String(error) }
      }
    }
  })

  ipcMain.handle('start-ffmpeg-recording', async (_, source: SelectedSource) => {
    if (ffmpegCaptureProcess) {
      return { success: false, message: 'An FFmpeg recording is already active.' }
    }

    try {
      const recordingsDir = await getRecordingsDir()
      const ffmpegPath = getFfmpegBinaryPath()
      const outputPath = path.join(recordingsDir, `recording-${Date.now()}.mp4`)
      const args = await buildFfmpegCaptureArgs(source, outputPath)

      ffmpegCaptureOutputBuffer = ''
      ffmpegCaptureTargetPath = outputPath
      ffmpegCaptureProcess = spawn(ffmpegPath, args, {
        cwd: recordingsDir,
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      ffmpegCaptureProcess.stdout.on('data', (chunk: Buffer) => {
        ffmpegCaptureOutputBuffer += chunk.toString()
      })
      ffmpegCaptureProcess.stderr.on('data', (chunk: Buffer) => {
        ffmpegCaptureOutputBuffer += chunk.toString()
      })

      await waitForFfmpegCaptureStart(ffmpegCaptureProcess)
      ffmpegScreenRecordingActive = true
      return { success: true }
    } catch (error) {
      console.error('Failed to start FFmpeg recording:', error)
      ffmpegScreenRecordingActive = false
      ffmpegCaptureProcess = null
      ffmpegCaptureTargetPath = null
      return {
        success: false,
        message: 'Failed to start FFmpeg recording',
        error: String(error),
      }
    }
  })

  ipcMain.handle('stop-ffmpeg-recording', async () => {
    if (!ffmpegScreenRecordingActive) {
      return { success: false, message: 'No FFmpeg recording is active.' }
    }

    try {
      if (!ffmpegCaptureProcess || !ffmpegCaptureTargetPath) {
        throw new Error('FFmpeg process is not running')
      }

      const process = ffmpegCaptureProcess
      const outputPath = ffmpegCaptureTargetPath
      process.stdin.write('q\n')
      const finalVideoPath = await waitForFfmpegCaptureStop(process, outputPath)

      ffmpegCaptureProcess = null
      ffmpegCaptureTargetPath = null
      ffmpegScreenRecordingActive = false

      return await finalizeStoredVideo(finalVideoPath)
    } catch (error) {
      console.error('Failed to stop FFmpeg recording:', error)
      ffmpegCaptureProcess = null
      ffmpegCaptureTargetPath = null
      ffmpegScreenRecordingActive = false
      return {
        success: false,
        message: 'Failed to stop FFmpeg recording',
        error: String(error),
      }
    }
  })



  ipcMain.handle('store-recorded-video', async (_, videoData: ArrayBuffer, fileName: string) => {
    try {
      const recordingsDir = await getRecordingsDir()
      const videoPath = path.join(recordingsDir, fileName)
      await fs.writeFile(videoPath, Buffer.from(videoData))
      return await finalizeStoredVideo(videoPath)
    } catch (error) {
      console.error('Failed to store video:', error)
      return {
        success: false,
        message: 'Failed to store video',
        error: String(error)
      }
    }
  })



  ipcMain.handle('get-recorded-video-path', async () => {
    try {
      const recordingsDir = await getRecordingsDir()
      const files = await fs.readdir(recordingsDir)
      const videoFiles = files.filter(file => /\.(webm|mov|mp4)$/i.test(file))
      
      if (videoFiles.length === 0) {
        return { success: false, message: 'No recorded video found' }
      }
      
      const latestVideo = videoFiles.sort().reverse()[0]
      const videoPath = path.join(recordingsDir, latestVideo)
      
      return { success: true, path: videoPath }
    } catch (error) {
      console.error('Failed to get video path:', error)
      return { success: false, message: 'Failed to get video path', error: String(error) }
    }
  })

  ipcMain.handle('set-recording-state', (_, recording: boolean) => {
    if (recording) {
      stopCursorCapture()
      stopInteractionCapture()
      startWindowBoundsCapture()
      void startNativeCursorMonitor()
      isCursorCaptureActive = true
      activeCursorSamples = []
      pendingCursorSamples = []
      cursorCaptureStartTimeMs = Date.now()
      linuxCursorScreenPoint = null
      lastLeftClick = null
      sampleCursorPoint()
      cursorCaptureInterval = setInterval(sampleCursorPoint, CURSOR_SAMPLE_INTERVAL_MS)
      void startInteractionCapture()
    } else {
      isCursorCaptureActive = false
      stopCursorCapture()
      stopInteractionCapture()
      stopWindowBoundsCapture()
      stopNativeCursorMonitor()
      showCursor()
      linuxCursorScreenPoint = null
      snapshotCursorTelemetryForPersistence()
      activeCursorSamples = []
    }

    const source = selectedSource || { name: 'Screen' }
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send('recording-state-changed', {
          recording,
          sourceName: source.name,
        })
      }
    })

    if (onRecordingStateChange) {
      onRecordingStateChange(recording, source.name)
    }
  })

  ipcMain.handle('get-cursor-telemetry', async (_, videoPath?: string) => {
    const targetVideoPath = normalizeVideoSourcePath(videoPath ?? currentVideoPath)
    if (!targetVideoPath) {
      return { success: true, samples: [] }
    }

    const telemetryPath = getTelemetryPathForVideo(targetVideoPath)
    try {
      const content = await fs.readFile(telemetryPath, 'utf-8')
      const parsed = JSON.parse(content)
      const rawSamples = Array.isArray(parsed)
        ? parsed
        : (Array.isArray(parsed?.samples) ? parsed.samples : [])

      const samples: CursorTelemetryPoint[] = rawSamples
        .filter((sample: unknown) => Boolean(sample && typeof sample === 'object'))
        .map((sample: unknown) => {
          const point = sample as Partial<CursorTelemetryPoint>
          return {
            timeMs: typeof point.timeMs === 'number' && Number.isFinite(point.timeMs) ? Math.max(0, point.timeMs) : 0,
            cx: typeof point.cx === 'number' && Number.isFinite(point.cx) ? clamp(point.cx, 0, 1) : 0.5,
            cy: typeof point.cy === 'number' && Number.isFinite(point.cy) ? clamp(point.cy, 0, 1) : 0.5,
            interactionType: point.interactionType === 'click'
              || point.interactionType === 'double-click'
              || point.interactionType === 'right-click'
              || point.interactionType === 'middle-click'
              || point.interactionType === 'move'
              || point.interactionType === 'mouseup'
              ? point.interactionType
              : undefined,
            cursorType: point.cursorType === 'arrow'
              || point.cursorType === 'text'
              || point.cursorType === 'pointer'
              || point.cursorType === 'crosshair'
              || point.cursorType === 'open-hand'
              || point.cursorType === 'closed-hand'
              || point.cursorType === 'resize-ew'
              || point.cursorType === 'resize-ns'
              || point.cursorType === 'not-allowed'
              ? point.cursorType
              : undefined,
          }
        })
        .sort((a: CursorTelemetryPoint, b: CursorTelemetryPoint) => a.timeMs - b.timeMs)

      return { success: true, samples }
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException
      if (nodeError.code === 'ENOENT') {
        return { success: true, samples: [] }
      }
      console.error('Failed to load cursor telemetry:', error)
      return { success: false, message: 'Failed to load cursor telemetry', error: String(error), samples: [] }
    }
  })


  ipcMain.handle('open-external-url', async (_, url: string) => {
    try {
      await shell.openExternal(url)
      return { success: true }
    } catch (error) {
      console.error('Failed to open URL:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('get-accessibility-permission-status', () => {
    if (process.platform !== 'darwin') {
      return { success: true, trusted: true, prompted: false }
    }

    return {
      success: true,
      trusted: systemPreferences.isTrustedAccessibilityClient(false),
      prompted: false,
    }
  })

  ipcMain.handle('request-accessibility-permission', () => {
    if (process.platform !== 'darwin') {
      return { success: true, trusted: true, prompted: false }
    }

    return {
      success: true,
      trusted: systemPreferences.isTrustedAccessibilityClient(true),
      prompted: true,
    }
  })

  ipcMain.handle('get-screen-recording-permission-status', () => {
    if (process.platform !== 'darwin') {
      return { success: true, status: 'granted' }
    }

    try {
      return {
        success: true,
        status: systemPreferences.getMediaAccessStatus('screen'),
      }
    } catch (error) {
      console.error('Failed to get screen recording permission status:', error)
      return { success: false, status: 'unknown', error: String(error) }
    }
  })

  ipcMain.handle('open-screen-recording-preferences', async () => {
    if (process.platform !== 'darwin') {
      return { success: true }
    }

    try {
      await shell.openExternal(getMacPrivacySettingsUrl('screen'))
      return { success: true }
    } catch (error) {
      console.error('Failed to open Screen Recording preferences:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('open-accessibility-preferences', async () => {
    if (process.platform !== 'darwin') {
      return { success: true }
    }

    try {
      await shell.openExternal(getMacPrivacySettingsUrl('accessibility'))
      return { success: true }
    } catch (error) {
      console.error('Failed to open Accessibility preferences:', error)
      return { success: false, error: String(error) }
    }
  })

  // Return base path for assets so renderer can resolve file:// paths in production
  ipcMain.handle('get-asset-base-path', () => {
    try {
      const assetPath = getAssetRootPath()
      return pathToFileURL(`${assetPath}${path.sep}`).toString()
    } catch (err) {
      console.error('Failed to resolve asset base path:', err)
      return null
    }
  })

  ipcMain.handle('list-asset-directory', async (_, relativeDir: string) => {
    try {
      const normalizedRelativeDir = String(relativeDir ?? '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')

      const assetRootPath = path.resolve(getAssetRootPath())
      const targetDirPath = path.resolve(assetRootPath, normalizedRelativeDir)
      if (targetDirPath !== assetRootPath && !targetDirPath.startsWith(`${assetRootPath}${path.sep}`)) {
        return { success: false, error: 'Invalid asset directory' }
      }

      const entries = await fs.readdir(targetDirPath, { withFileTypes: true })
      const files = entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort(new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare)

      return { success: true, files }
    } catch (error) {
      console.error('Failed to list asset directory:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('read-local-file', async (_, filePath: string) => {
    try {
      const data = await fs.readFile(filePath)
      return { success: true, data }
    } catch (error) {
      console.error('Failed to read local file:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('save-exported-video', async (event, videoData: ArrayBuffer, fileName: string) => {
    try {
      // Determine file type from extension
      const isGif = fileName.toLowerCase().endsWith('.gif');
      const filters = isGif 
        ? [{ name: 'GIF Image', extensions: ['gif'] }]
        : [{ name: 'MP4 Video', extensions: ['mp4'] }];
      const parentWindow = BrowserWindow.fromWebContents(event.sender)
      const saveDialogOptions: SaveDialogOptions = {
        title: isGif ? 'Save Exported GIF' : 'Save Exported Video',
        defaultPath: path.join(app.getPath('downloads'), fileName),
        filters,
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      }

      const result = parentWindow
        ? await dialog.showSaveDialog(parentWindow, saveDialogOptions)
        : await dialog.showSaveDialog(saveDialogOptions)

      if (result.canceled || !result.filePath) {
        return {
          success: false,
          canceled: true,
          message: 'Export canceled'
        };
      }

      await fs.writeFile(result.filePath, Buffer.from(videoData));

      return {
        success: true,
        path: result.filePath,
        message: 'Video exported successfully'
      };
    } catch (error) {
      console.error('Failed to save exported video:', error)
      return {
        success: false,
        message: 'Failed to save exported video',
        error: String(error)
      }
    }
  })

  ipcMain.handle('open-video-file-picker', async () => {
    try {
      const recordingsDir = await getRecordingsDir()
      const result = await dialog.showOpenDialog({
        title: 'Select Video File',
        defaultPath: recordingsDir,
        filters: [
          { name: 'Video Files', extensions: ['webm', 'mp4', 'mov', 'avi', 'mkv'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile']
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      currentProjectPath = null
      return {
        success: true,
        path: result.filePaths[0]
      };
    } catch (error) {
      console.error('Failed to open file picker:', error);
      return {
        success: false,
        message: 'Failed to open file picker',
        error: String(error)
      };
    }
  });

  ipcMain.handle('open-audio-file-picker', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Select Audio File',
        filters: [
          { name: 'Audio Files', extensions: ['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile']
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      return {
        success: true,
        path: result.filePaths[0]
      };
    } catch (error) {
      console.error('Failed to open audio file picker:', error);
      return {
        success: false,
        message: 'Failed to open audio file picker',
        error: String(error)
      };
    }
  });

  ipcMain.handle('open-whisper-executable-picker', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Select Whisper Executable',
        filters: [
          { name: 'Executables', extensions: process.platform === 'win32' ? ['exe', 'cmd', 'bat'] : ['*'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile'],
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true }
      }

      return { success: true, path: result.filePaths[0] }
    } catch (error) {
      console.error('Failed to open Whisper executable picker:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('open-whisper-model-picker', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Select Whisper Model',
        filters: [
          { name: 'Whisper Models', extensions: ['bin'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile'],
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true }
      }

      return { success: true, path: result.filePaths[0] }
    } catch (error) {
      console.error('Failed to open Whisper model picker:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('get-whisper-small-model-status', async () => {
    try {
      return await getWhisperSmallModelStatus()
    } catch (error) {
      return { success: false, exists: false, path: null, error: String(error) }
    }
  })

  ipcMain.handle('download-whisper-small-model', async (event) => {
    try {
      const existing = await getWhisperSmallModelStatus()
      if (existing.exists) {
        sendWhisperModelDownloadProgress(event.sender, {
          status: 'downloaded',
          progress: 100,
          path: existing.path,
        })
        return { success: true, path: existing.path, alreadyDownloaded: true }
      }

      const modelPath = await downloadWhisperSmallModel(event.sender)
      return { success: true, path: modelPath }
    } catch (error) {
      console.error('Failed to download Whisper small model:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('delete-whisper-small-model', async (event) => {
    try {
      await deleteWhisperSmallModel()
      sendWhisperModelDownloadProgress(event.sender, {
        status: 'idle',
        progress: 0,
        path: null,
      })
      return { success: true }
    } catch (error) {
      console.error('Failed to delete Whisper small model:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('generate-auto-captions', async (_, options: {
    videoPath: string
    whisperExecutablePath: string
    whisperModelPath: string
    language?: string
  }) => {
    try {
      const result = await generateAutoCaptionsFromVideo(options)
      return {
        success: true,
        cues: result.cues,
        message: result.audioSourceLabel === 'recording'
          ? `Generated ${result.cues.length} caption cues.`
          : `Generated ${result.cues.length} caption cues from the ${result.audioSourceLabel}.`,
      }
    } catch (error) {
      console.error('Failed to generate auto captions:', error)
      return {
        success: false,
        error: String(error),
        message: 'Failed to generate auto captions',
      }
    }
  })

  ipcMain.handle('reveal-in-folder', async (_, filePath: string) => {
    try {
      // shell.showItemInFolder doesn't return a value, it throws on error
      shell.showItemInFolder(filePath);
      return { success: true };
    } catch (error) {
      console.error(`Error revealing item in folder: ${filePath}`, error);
      // Fallback to open the directory if revealing the item fails
      // This might happen if the file was moved or deleted after export,
      // or if the path is somehow invalid for showItemInFolder
      try {
        const openPathResult = await shell.openPath(path.dirname(filePath));
        if (openPathResult) {
          // openPath returned an error message
          return { success: false, error: openPathResult };
        }
        return { success: true, message: 'Could not reveal item, but opened directory.' };
      } catch (openError) {
        console.error(`Error opening directory: ${path.dirname(filePath)}`, openError);
        return { success: false, error: String(error) };
      }
    }
  });

  ipcMain.handle('open-recordings-folder', async () => {
    try {
      const recordingsDir = await getRecordingsDir();
      const openPathResult = await shell.openPath(recordingsDir);
      if (openPathResult) {
        return { success: false, error: openPathResult, message: 'Failed to open recordings folder.' };
      }

      return { success: true };
    } catch (error) {
      console.error('Failed to open recordings folder:', error);
      return { success: false, error: String(error), message: 'Failed to open recordings folder.' };
    }
  });

  ipcMain.handle('get-recordings-directory', async () => {
    try {
      const recordingsDir = await getRecordingsDir()
      return {
        success: true,
        path: recordingsDir,
        isDefault: recordingsDir === RECORDINGS_DIR,
      }
    } catch (error) {
      return {
        success: false,
        path: RECORDINGS_DIR,
        isDefault: true,
        error: String(error),
      }
    }
  })

  ipcMain.handle('choose-recordings-directory', async () => {
    try {
      const current = await getRecordingsDir()
      const result = await dialog.showOpenDialog({
        title: 'Choose recordings folder',
        defaultPath: current,
        properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true, path: current }
      }

      const selectedPath = path.resolve(result.filePaths[0])
      await fs.mkdir(selectedPath, { recursive: true })
      await fs.access(selectedPath, fsConstants.W_OK)
      await persistRecordingsDirectorySetting(selectedPath)

      return { success: true, path: selectedPath, isDefault: selectedPath === RECORDINGS_DIR }
    } catch (error) {
      return { success: false, error: String(error), message: 'Failed to set recordings folder' }
    }
  })

  ipcMain.handle('save-project-file', async (_, projectData: unknown, suggestedName?: string, existingProjectPath?: string, thumbnailDataUrl?: string | null) => {
    try {
      const projectsDir = await getProjectsDir()
      const trustedExistingProjectPath = isTrustedProjectPath(existingProjectPath)
        ? existingProjectPath
        : null

      if (trustedExistingProjectPath) {
        await fs.writeFile(trustedExistingProjectPath, JSON.stringify(projectData, null, 2), 'utf-8')
        currentProjectPath = trustedExistingProjectPath
        await saveProjectThumbnail(trustedExistingProjectPath, thumbnailDataUrl)
        await rememberRecentProject(trustedExistingProjectPath)
        return {
          success: true,
          path: trustedExistingProjectPath,
          message: 'Project saved successfully'
        }
      }

      const safeName = (suggestedName || `project-${Date.now()}`).replace(/[^a-zA-Z0-9-_]/g, '_')
      const defaultName = safeName.endsWith(`.${PROJECT_FILE_EXTENSION}`)
        ? safeName
        : `${safeName}.${PROJECT_FILE_EXTENSION}`

      const result = await dialog.showSaveDialog({
        title: 'Save Recordly Project',
        defaultPath: path.join(projectsDir, defaultName),
        filters: [
          { name: 'Recordly Project', extensions: [PROJECT_FILE_EXTENSION] },
          { name: 'JSON', extensions: ['json'] }
        ],
        properties: ['createDirectory', 'showOverwriteConfirmation']
      })

      if (result.canceled || !result.filePath) {
        return {
          success: false,
          canceled: true,
          message: 'Save project canceled'
        }
      }

      await fs.writeFile(result.filePath, JSON.stringify(projectData, null, 2), 'utf-8')
      currentProjectPath = result.filePath
      await saveProjectThumbnail(result.filePath, thumbnailDataUrl)
      await rememberRecentProject(result.filePath)

      return {
        success: true,
        path: result.filePath,
        message: 'Project saved successfully'
      }
    } catch (error) {
      console.error('Failed to save project file:', error)
      return {
        success: false,
        message: 'Failed to save project file',
        error: String(error)
      }
    }
  })

  ipcMain.handle('load-project-file', async () => {
    try {
      const projectsDir = await getProjectsDir()
      const result = await dialog.showOpenDialog({
        title: 'Open Recordly Project',
        defaultPath: projectsDir,
        filters: [
          { name: 'Recordly Project', extensions: [PROJECT_FILE_EXTENSION, ...LEGACY_PROJECT_FILE_EXTENSIONS] },
          { name: 'JSON', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile']
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true, message: 'Open project canceled' }
      }

      return await loadProjectFromPath(result.filePaths[0])
    } catch (error) {
      console.error('Failed to load project file:', error)
      return {
        success: false,
        message: 'Failed to load project file',
        error: String(error)
      }
    }
  })

  ipcMain.handle('load-current-project-file', async () => {
    try {
      if (!currentProjectPath) {
        return { success: false, message: 'No active project' }
      }

      return await loadProjectFromPath(currentProjectPath)
    } catch (error) {
      console.error('Failed to load current project file:', error)
      return {
        success: false,
        message: 'Failed to load current project file',
        error: String(error),
      }
    }
  })

  ipcMain.handle('get-projects-directory', async () => {
    try {
      return {
        success: true,
        path: await getProjectsDir(),
      }
    } catch (error) {
      return {
        success: false,
        error: String(error),
      }
    }
  })

  ipcMain.handle('list-project-files', async () => {
    try {
      const library = await listProjectLibraryEntries()
      return {
        success: true,
        projectsDir: library.projectsDir,
        entries: library.entries,
      }
    } catch (error) {
      return {
        success: false,
        projectsDir: null,
        entries: [],
        error: String(error),
      }
    }
  })

  ipcMain.handle('open-project-file-at-path', async (_, filePath: string) => {
    try {
      return await loadProjectFromPath(filePath)
    } catch (error) {
      console.error('Failed to open project file at path:', error)
      return {
        success: false,
        message: 'Failed to open project file',
        error: String(error),
      }
    }
  })

  ipcMain.handle('open-projects-directory', async () => {
    try {
      const projectsDir = await getProjectsDir()
      const openPathResult = await shell.openPath(projectsDir)
      if (openPathResult) {
        return { success: false, error: openPathResult, message: 'Failed to open projects folder.' }
      }

      return { success: true, path: projectsDir }
    } catch (error) {
      console.error('Failed to open projects folder:', error)
      return { success: false, error: String(error), message: 'Failed to open projects folder.' }
    }
  })
  ipcMain.handle('set-current-video-path', async (_, path: string) => {
    currentVideoPath = normalizeVideoSourcePath(path) ?? path
    const resolvedSession = await resolveRecordingSession(currentVideoPath)
      ?? {
        videoPath: currentVideoPath,
        webcamPath: null,
        timeOffsetMs: 0,
      }

    currentRecordingSession = resolvedSession

    if (resolvedSession.webcamPath) {
      await persistRecordingSessionManifest(resolvedSession)
    }

    currentProjectPath = null
    return { success: true, webcamPath: resolvedSession.webcamPath ?? null }
  })

  ipcMain.handle('set-current-recording-session', async (_, session: { videoPath: string; webcamPath?: string | null; timeOffsetMs?: number }) => {
    const normalizedVideoPath = normalizeVideoSourcePath(session.videoPath) ?? session.videoPath
    currentVideoPath = normalizedVideoPath
    currentRecordingSession = {
      videoPath: normalizedVideoPath,
      webcamPath: normalizeVideoSourcePath(session.webcamPath ?? null),
      timeOffsetMs: normalizeRecordingTimeOffsetMs(session.timeOffsetMs),
    }
    currentProjectPath = null
    await persistRecordingSessionManifest(currentRecordingSession)
    return { success: true }
  })

  ipcMain.handle('get-current-recording-session', () => {
    if (!currentRecordingSession) {
      return { success: false }
    }

    return {
      success: true,
      session: currentRecordingSession,
    }
  })

  ipcMain.handle('get-current-video-path', () => {
    return currentVideoPath ? { success: true, path: currentVideoPath } : { success: false };
  });

  ipcMain.handle('clear-current-video-path', () => {
    currentVideoPath = null;
    currentRecordingSession = null;
    return { success: true };
  });

  ipcMain.handle('delete-recording-file', async (_, filePath: string) => {
    try {
      if (!filePath || !isAutoRecordingPath(filePath)) {
        return { success: false, error: 'Only auto-generated recordings can be deleted' };
      }
      await fs.unlink(filePath);
      // Also delete the cursor telemetry sidecar if it exists
      const telemetryPath = getTelemetryPathForVideo(filePath);
      await fs.unlink(telemetryPath).catch(() => {});
      if (currentVideoPath === filePath) {
        currentVideoPath = null;
        currentRecordingSession = null;
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('app:getVersion', () => {
    return app.getVersion()
  })

  ipcMain.handle('get-platform', () => {
    return process.platform;
  });

  // ---------------------------------------------------------------------------
  // Cursor hiding for the browser-capture fallback.
  // The IPC promise resolves only after the cursor hide attempt completes.
  // ---------------------------------------------------------------------------
  ipcMain.handle('hide-cursor', () => {
    if (process.platform !== 'win32') {
      return { success: true }
    }

    return { success: hideCursor() }
  })

  ipcMain.handle('get-shortcuts', async () => {
    try {
      const data = await fs.readFile(SHORTCUTS_FILE, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  });

  ipcMain.handle('save-shortcuts', async (_, shortcuts: unknown) => {
    try {
      await fs.writeFile(SHORTCUTS_FILE, JSON.stringify(shortcuts, null, 2), 'utf-8');
      return { success: true };
    } catch (error) {
      console.error('Failed to save shortcuts:', error);
      return { success: false, error: String(error) };
    }
  });

  // ---------------------------------------------------------------------------
  // Countdown timer before recording
  // ---------------------------------------------------------------------------
    ipcMain.handle('get-recording-preferences', async () => {
      try {
        const content = await fs.readFile(RECORDINGS_SETTINGS_FILE, 'utf-8')
        const parsed = JSON.parse(content) as Record<string, unknown>
        return {
          success: true,
          microphoneEnabled: parsed.microphoneEnabled === true,
          microphoneDeviceId: typeof parsed.microphoneDeviceId === 'string' ? parsed.microphoneDeviceId : undefined,
          systemAudioEnabled: parsed.systemAudioEnabled !== false,
        }
      } catch {
        return { success: true, microphoneEnabled: false, microphoneDeviceId: undefined, systemAudioEnabled: true }
      }
    })

    ipcMain.handle('set-recording-preferences', async (_, prefs: { microphoneEnabled?: boolean; microphoneDeviceId?: string; systemAudioEnabled?: boolean }) => {
      try {
        let existing: Record<string, unknown> = {}
        try {
          const content = await fs.readFile(RECORDINGS_SETTINGS_FILE, 'utf-8')
          existing = JSON.parse(content) as Record<string, unknown>
        } catch {
          // file doesn't exist yet
        }
        const merged = { ...existing, ...prefs }
        await fs.writeFile(RECORDINGS_SETTINGS_FILE, JSON.stringify(merged, null, 2), 'utf-8')
        return { success: true }
      } catch (error) {
        console.error('Failed to save recording preferences:', error)
        return { success: false, error: String(error) }
      }
    })

  ipcMain.handle('get-countdown-delay', async () => {
    try {
      const content = await fs.readFile(COUNTDOWN_SETTINGS_FILE, 'utf-8')
      const parsed = JSON.parse(content) as { delay?: number }
      return { success: true, delay: parsed.delay ?? 3 }
    } catch {
      return { success: true, delay: 3 }
    }
  })

  ipcMain.handle('set-countdown-delay', async (_, delay: number) => {
    try {
      await fs.writeFile(COUNTDOWN_SETTINGS_FILE, JSON.stringify({ delay }, null, 2), 'utf-8')
      return { success: true }
    } catch (error) {
      console.error('Failed to save countdown delay:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('start-countdown', async (_, seconds: number) => {
    if (countdownInProgress) {
      return { success: false, error: 'Countdown already in progress' }
    }

    countdownInProgress = true
    countdownCancelled = false
    countdownRemaining = seconds

    // Calculate where to show the countdown based on what we are recording
    let countdownTargetBounds: { x: number; y: number; width: number; height: number } | undefined;
    
    if (selectedSource?.id === 'area:custom' && selectedArea) {
      // If recording a custom area, center countdown in that area
      countdownTargetBounds = selectedArea;
    } else if (selectedSource?.id?.startsWith('screen:')) {
      // If recording a screen, center countdown in that screen
      // Import screen inside or use global if available
      const displays = screen.getAllDisplays();
      const targetDisplay = displays.find(d => String(d.id) === selectedSource?.display_id);
      if (targetDisplay) {
        countdownTargetBounds = targetDisplay.bounds;
      }
    }

    const countdownWin = createCountdownWindow(countdownTargetBounds)

    if (selectedArea && selectedSource?.id === 'area:custom') {
      areaHighlightWindow = createAreaHighlightWindow(selectedArea)
    }

    if (countdownWin.webContents.isLoadingMainFrame()) {
      await new Promise<void>((resolve) => {
        countdownWin.webContents.once('did-finish-load', () => {
          resolve()
        })
      })
    }

    return new Promise<{ success: boolean; cancelled?: boolean }>((resolve) => {
      countdownResolve = resolve
      let remaining = seconds
      countdownRemaining = remaining

      countdownWin.webContents.send('countdown-tick', remaining)

      countdownTimer = setInterval(() => {
        if (countdownCancelled) {
          stopCountdown({ success: false, cancelled: true })
          return
        }

        remaining--
        countdownRemaining = remaining

        if (remaining <= 0) {
          stopCountdown({ success: true })
        } else {
          const win = getCountdownWindow()
          if (win && !win.isDestroyed()) {
            win.webContents.send('countdown-tick', remaining)
          }
        }
      }, 1000)
    })
  })

  ipcMain.handle('cancel-countdown', () => {
    countdownCancelled = true
    stopCountdown({ success: false, cancelled: true })
    return { success: true }
  })

  ipcMain.handle('get-active-countdown', () => {
    return {
      success: true,
      seconds: countdownInProgress ? countdownRemaining : null,
    }
  })
}
