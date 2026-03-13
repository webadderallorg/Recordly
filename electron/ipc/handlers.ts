import { ipcMain, desktopCapturer, BrowserWindow, shell, app, dialog, systemPreferences } from 'electron'
import { execFile, spawn, spawnSync } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import fs from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { promisify } from 'node:util'
import { RECORDINGS_DIR } from '../main'

const execFileAsync = promisify(execFile)
const nodeRequire = createRequire(import.meta.url)

const PROJECT_FILE_EXTENSION = 'recordly'
const LEGACY_PROJECT_FILE_EXTENSIONS = ['openscreen']
const SHORTCUTS_FILE = path.join(app.getPath('userData'), 'shortcuts.json')
const AUTO_RECORDING_PREFIX = 'recording-'
const AUTO_RECORDING_RETENTION_COUNT = 20
const AUTO_RECORDING_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000
const ALLOW_RECORDLY_WINDOW_CAPTURE = Boolean(process.env['VITE_DEV_SERVER_URL'])

function getScreen() {
  return nodeRequire('electron').screen as typeof import('electron').screen
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
}

type WindowBounds = {
  x: number
  y: number
  width: number
  height: number
}

let selectedSource: SelectedSource | null = null
let currentProjectPath: string | null = null
let nativeScreenRecordingActive = false
let currentVideoPath: string | null = null
let nativeCaptureProcess: ChildProcessWithoutNullStreams | null = null
let nativeCaptureOutputBuffer = ''
let nativeCaptureTargetPath: string | null = null
let nativeCaptureStopRequested = false
let nativeCaptureMicrophonePath: string | null = null
let nativeCursorMonitorProcess: ChildProcessWithoutNullStreams | null = null
let nativeCursorMonitorOutputBuffer = ''
let ffmpegScreenRecordingActive = false
let ffmpegCaptureProcess: ChildProcessWithoutNullStreams | null = null
let ffmpegCaptureOutputBuffer = ''
let ffmpegCaptureTargetPath: string | null = null
let cachedSystemCursorAssets: Record<string, SystemCursorAsset> | null = null
let cachedSystemCursorAssetsSourceMtimeMs: number | null = null

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

function getMacPrivacySettingsUrl(pane: 'screen' | 'accessibility') {
  return pane === 'screen'
    ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
    : 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
}

function isAutoRecordingPath(filePath: string) {
  return path.basename(filePath).startsWith(AUTO_RECORDING_PREFIX)
}

function getTelemetryPathForVideo(videoPath: string) {
  return `${videoPath}.cursor.json`
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
  const exempt = new Set(
    [currentVideoPath, ...exemptPaths]
      .filter((value): value is string => Boolean(value))
      .map((value) => normalizePath(value)),
  )

  const entries = await fs.readdir(RECORDINGS_DIR, { withFileTypes: true })
  const autoRecordingStats = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && /^recording-.*\.(mp4|mov|webm)$/i.test(entry.name))
      .map(async (entry) => {
        const filePath = path.join(RECORDINGS_DIR, entry.name)
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
  return process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64'
}

function getPrebundledNativeHelperPath(binaryName: string) {
  return resolveUnpackedAppPath('electron', 'native', 'bin', getNativeArchTag(), binaryName)
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
  return (moduleExports as any)?.uIOhook ?? (moduleExports as any)?.default ?? moduleExports
}

function getFfmpegBinaryPath() {
  const ffmpegStatic = loadFfmpegStatic()
  if (!ffmpegStatic || typeof ffmpegStatic !== 'string') {
    throw new Error('FFmpeg binary is unavailable. Install ffmpeg-static for this platform.')
  }

  if (app.isPackaged) {
    return ffmpegStatic.replace('.asar/', '.asar.unpacked/')
  }

  return ffmpegStatic
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
  const sourceDisplayId = Number(source?.display_id)
  if (Number.isFinite(sourceDisplayId)) {
    const matched = getScreen().getAllDisplays().find((display) => display.id === sourceDisplayId)
    if (matched) {
      return matched.bounds
    }
  }

  return getScreen().getPrimaryDisplay().bounds
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

async function mixNativeMacAudioTracks(videoPath: string, microphonePath: string) {
  const ffmpegPath = getFfmpegBinaryPath()
  const mixedOutputPath = `${videoPath}.mixed.mp4`

  await execFileAsync(
    ffmpegPath,
    [
      '-y',
      '-i', videoPath,
      '-i', microphonePath,
      '-filter_complex', '[0:a][1:a]amix=inputs=2:duration=longest:normalize=0[aout]',
      '-map', '0:v:0',
      '-map', '[aout]',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest',
      mixedOutputPath,
    ],
    { timeout: 120000, maxBuffer: 10 * 1024 * 1024 },
  )

  await moveFileWithOverwrite(mixedOutputPath, videoPath)
  await fs.rm(microphonePath, { force: true })
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

  pushCursorSample(point.cx, point.cy, Date.now() - cursorCaptureStartTimeMs, 'move', cursorType)
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

async function startNativeCursorMonitor() {
  stopNativeCursorMonitor()

  if (process.platform !== 'darwin') {
    currentCursorVisualType = undefined
    return
  }

  try {
    const helperPath = await ensureNativeCursorMonitorBinary()
    nativeCursorMonitorOutputBuffer = ''
    currentCursorVisualType = undefined
    nativeCursorMonitorProcess = spawn(helperPath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    nativeCursorMonitorProcess.stdout.on('data', (chunk: Buffer) => {
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
    })

    nativeCursorMonitorProcess.once('close', () => {
      nativeCursorMonitorProcess = null
      nativeCursorMonitorOutputBuffer = ''
      currentCursorVisualType = undefined
    })
  } catch (error) {
    console.warn('Failed to start native cursor monitor:', error)
    nativeCursorMonitorProcess = null
    nativeCursorMonitorOutputBuffer = ''
    currentCursorVisualType = undefined
  }
}

function stopNativeCursorMonitor() {
  currentCursorVisualType = undefined

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
let selectedWindowBounds: WindowBounds | null = null
let windowBoundsCaptureInterval: NodeJS.Timeout | null = null

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
  if (process.platform !== 'darwin' || !selectedSource?.id?.startsWith('window:')) {
    selectedWindowBounds = null
    return
  }

  const bounds = await resolveMacWindowBounds(selectedSource)
  if (bounds) {
    selectedWindowBounds = bounds
  }
}

function startWindowBoundsCapture() {
  stopWindowBoundsCapture()

  if (process.platform !== 'darwin' || !selectedSource?.id?.startsWith('window:')) {
    return
  }

  void refreshSelectedWindowBounds()
  windowBoundsCaptureInterval = setInterval(() => {
    void refreshSelectedWindowBounds()
  }, 250)
}

function getNormalizedCursorPoint() {
  const cursor = getScreen().getCursorScreenPoint()
  const windowBounds = selectedSource?.id?.startsWith('window:') ? selectedWindowBounds : null
  if (windowBounds) {
    const width = Math.max(1, windowBounds.width)
    const height = Math.max(1, windowBounds.height)

    return {
      cx: clamp((cursor.x - windowBounds.x) / width, 0, 1),
      cy: clamp((cursor.y - windowBounds.y) / height, 0, 1),
    }
  }

  const sourceDisplayId = Number(selectedSource?.display_id)
  const sourceDisplay = Number.isFinite(sourceDisplayId)
    ? getScreen().getAllDisplays().find((display) => display.id === sourceDisplayId) ?? null
    : null
  const display = sourceDisplay ?? getScreen().getDisplayNearestPoint(cursor)
  const bounds = display.bounds
  const width = Math.max(1, bounds.width)
  const height = Math.max(1, bounds.height)

  const cx = clamp((cursor.x - bounds.x) / width, 0, 1)
  const cy = clamp((cursor.y - bounds.y) / height, 0, 1)
  return { cx, cy }
}

function pushCursorSample(
  cx: number,
  cy: number,
  timeMs: number,
  interactionType: CursorInteractionType = 'move',
  cursorType?: CursorVisualType,
) {
  activeCursorSamples.push({
    timeMs: Math.max(0, timeMs),
    cx,
    cy,
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

  pushCursorSample(point.cx, point.cy, Date.now() - cursorCaptureStartTimeMs, 'move')
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
  snapshotCursorTelemetryForPersistence()
  currentVideoPath = videoPath
  currentProjectPath = null
  await persistPendingCursorTelemetry(videoPath)
  if (isAutoRecordingPath(videoPath)) {
    await pruneAutoRecordings([videoPath])
  }

  return {
    success: true,
    path: videoPath,
    message: 'Video stored successfully'
  }
}

async function startInteractionCapture() {
  if (!isCursorCaptureActive) {
    return
  }

  if (!['darwin', 'win32'].includes(process.platform)) {
    return
  }

  try {
    const hook = loadUiohookModule()
    if (!isCursorCaptureActive) {
      return
    }

    if (!hook || typeof hook.on !== 'function' || typeof hook.start !== 'function') {
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
      const button = typeof event?.button === 'number' ? event.button : 1
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

      pushCursorSample(point.cx, point.cy, timeMs, interactionType)
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
      pushCursorSample(point.cx, point.cy, timeMs, 'mouseup')
    }

    hook.on('mousedown', onMouseDown)
    hook.on('mouseup', onMouseUp)
    hook.start()

    interactionCaptureCleanup = () => {
      try {
        if (typeof hook.off === 'function') {
          hook.off('mousedown', onMouseDown)
          hook.off('mouseup', onMouseUp)
        } else if (typeof hook.removeListener === 'function') {
          hook.removeListener('mousedown', onMouseDown)
          hook.removeListener('mouseup', onMouseUp)
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

export function registerIpcHandlers(
  createEditorWindow: () => void,
  createSourceSelectorWindow: () => BrowserWindow,
  getMainWindow: () => BrowserWindow | null,
  getSourceSelectorWindow: () => BrowserWindow | null,
  onRecordingStateChange?: (recording: boolean, sourceName: string) => void
) {
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

    const screenSources = electronSources
      .filter((source) => source.id.startsWith('screen:'))
      .map((source) => ({
        id: source.id,
        name: source.name,
        display_id: source.display_id,
        thumbnail: source.thumbnail ? source.thumbnail.toDataURL() : null,
        appIcon: source.appIcon ? source.appIcon.toDataURL() : null,
      }))

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
          display_id: source.display_id,
          thumbnail: source.thumbnail ? source.thumbnail.toDataURL() : null,
          appIcon: source.appIcon ? source.appIcon.toDataURL() : null,
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
            display_id: source.display_id ?? electronWindowSource?.display_id ?? '',
            thumbnail: electronWindowSource?.thumbnail ? electronWindowSource.thumbnail.toDataURL() : null,
            appIcon: source.appIcon ?? (electronWindowSource?.appIcon ? electronWindowSource.appIcon.toDataURL() : null),
            appName: source.appName,
            windowTitle: source.windowTitle,
          }
        })
        .filter((source) => Boolean(source.thumbnail))

      return [...screenSources, ...mergedWindowSources]
    } catch (error) {
      console.warn('Falling back to Electron window enumeration on macOS:', error)

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
            if (normalizedName === ownName || normalizedName.includes(ownName) || ownName.includes(normalizedName)) {
              return false
            }
          }

          return true
        })
        .map((source) => ({
          id: source.id,
          name: source.name,
          display_id: source.display_id,
          thumbnail: source.thumbnail ? source.thumbnail.toDataURL() : null,
          appIcon: source.appIcon ? source.appIcon.toDataURL() : null,
        }))

      return [...screenSources, ...windowSources]
    }
  })

  ipcMain.handle('select-source', (_, source: SelectedSource) => {
    selectedSource = source
    stopWindowBoundsCapture()
    const sourceSelectorWin = getSourceSelectorWindow()
    if (sourceSelectorWin) {
      sourceSelectorWin.close()
    }
    return selectedSource
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
    const mainWin = getMainWindow()
    if (mainWin) {
      mainWin.close()
    }
    createEditorWindow()
  })

  ipcMain.handle('start-native-screen-recording', async (_, source: SelectedSource, options?: NativeMacRecordingOptions) => {
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
      const outputPath = path.join(RECORDINGS_DIR, `recording-${Date.now()}.mp4`)
      const capturesSystemAudio = Boolean(options?.capturesSystemAudio)
      const capturesMicrophone = Boolean(options?.capturesMicrophone)
      const microphoneOutputPath = capturesSystemAudio && capturesMicrophone
        ? path.join(RECORDINGS_DIR, `recording-${Date.now()}.mic.m4a`)
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

      nativeCaptureOutputBuffer = ''
      nativeCaptureTargetPath = outputPath
      nativeCaptureMicrophonePath = microphoneOutputPath
      nativeCaptureStopRequested = false
      nativeCaptureProcess = spawn(helperPath, [JSON.stringify(config)], {
        cwd: RECORDINGS_DIR,
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
      return { success: true }
    } catch (error) {
      console.error('Failed to start native ScreenCaptureKit recording:', error)
      try {
        nativeCaptureProcess?.kill()
      } catch {
        // ignore cleanup failures
      }
      nativeScreenRecordingActive = false
      nativeCaptureProcess = null
      nativeCaptureTargetPath = null
      nativeCaptureMicrophonePath = null
      nativeCaptureStopRequested = false
      return {
        success: false,
        message: 'Failed to start native ScreenCaptureKit recording',
        error: String(error),
      }
    }
  })

  ipcMain.handle('stop-native-screen-recording', async () => {
    if (process.platform !== 'darwin') {
      return { success: false, message: 'Native screen recording is only available on macOS.' }
    }

    if (!nativeScreenRecordingActive) {
      return { success: false, message: 'No native screen recording is active.' }
    }

    try {
      if (!nativeCaptureProcess) {
        throw new Error('Native capture helper process is not running')
      }

      const process = nativeCaptureProcess
      const preferredVideoPath = nativeCaptureTargetPath
      const preferredMicrophonePath = nativeCaptureMicrophonePath
      nativeCaptureStopRequested = true
      process.stdin.write('stop\n')
      const tempVideoPath = await waitForNativeCaptureStop(process)
      nativeCaptureProcess = null
      nativeScreenRecordingActive = false
      nativeCaptureTargetPath = null
      nativeCaptureMicrophonePath = null
      nativeCaptureStopRequested = false

      const finalVideoPath = preferredVideoPath ?? tempVideoPath
      if (tempVideoPath !== finalVideoPath) {
        await moveFileWithOverwrite(tempVideoPath, finalVideoPath)
      }

      if (preferredMicrophonePath) {
        try {
          await fs.access(preferredMicrophonePath)
          await mixNativeMacAudioTracks(finalVideoPath, preferredMicrophonePath)
        } catch (error) {
          console.warn('Failed to mix native macOS microphone audio into capture:', error)
        }
      }

      return await finalizeStoredVideo(finalVideoPath)
    } catch (error) {
      console.error('Failed to stop native ScreenCaptureKit recording:', error)
      const fallbackPath = nativeCaptureTargetPath
      nativeScreenRecordingActive = false
      nativeCaptureProcess = null
      nativeCaptureTargetPath = null
      nativeCaptureMicrophonePath = null
      nativeCaptureStopRequested = false

      // Try to recover: if the target file exists on disk, finalize with it
      if (fallbackPath) {
        try {
          await fs.access(fallbackPath)
          console.log('[stop-native-screen-recording] Recovering with fallback path:', fallbackPath)
          return await finalizeStoredVideo(fallbackPath)
        } catch {
          // File doesn't exist or isn't accessible
        }
      }

      return {
        success: false,
        message: 'Failed to stop native ScreenCaptureKit recording',
        error: String(error),
      }
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

  ipcMain.handle('start-ffmpeg-recording', async (_, source: SelectedSource) => {
    if (ffmpegCaptureProcess) {
      return { success: false, message: 'An FFmpeg recording is already active.' }
    }

    try {
      const ffmpegPath = getFfmpegBinaryPath()
      const outputPath = path.join(RECORDINGS_DIR, `recording-${Date.now()}.mp4`)
      const args = await buildFfmpegCaptureArgs(source, outputPath)

      ffmpegCaptureOutputBuffer = ''
      ffmpegCaptureTargetPath = outputPath
      ffmpegCaptureProcess = spawn(ffmpegPath, args, {
        cwd: RECORDINGS_DIR,
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
      const videoPath = path.join(RECORDINGS_DIR, fileName)
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
      const files = await fs.readdir(RECORDINGS_DIR)
      const videoFiles = files.filter(file => /\.(webm|mov|mp4)$/i.test(file))
      
      if (videoFiles.length === 0) {
        return { success: false, message: 'No recorded video found' }
      }
      
      const latestVideo = videoFiles.sort().reverse()[0]
      const videoPath = path.join(RECORDINGS_DIR, latestVideo)
      
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
    const targetVideoPath = videoPath ?? currentVideoPath
    if (!targetVideoPath) {
      return { success: true, samples: [] }
    }

    const telemetryPath = `${targetVideoPath}.cursor.json`
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
      if (app.isPackaged) {
        return path.join(process.resourcesPath, 'assets')
      }
      return path.join(app.getAppPath(), 'public')
    } catch (err) {
      console.error('Failed to resolve asset base path:', err)
      return null
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

  ipcMain.handle('save-exported-video', async (_, videoData: ArrayBuffer, fileName: string) => {
    try {
      // Determine file type from extension
      const isGif = fileName.toLowerCase().endsWith('.gif');
      const filters = isGif 
        ? [{ name: 'GIF Image', extensions: ['gif'] }]
        : [{ name: 'MP4 Video', extensions: ['mp4'] }];

      const result = await dialog.showSaveDialog({
        title: isGif ? 'Save Exported GIF' : 'Save Exported Video',
        defaultPath: path.join(app.getPath('downloads'), fileName),
        filters,
        properties: ['createDirectory', 'showOverwriteConfirmation']
      });

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
      const result = await dialog.showOpenDialog({
        title: 'Select Video File',
        defaultPath: RECORDINGS_DIR,
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
      await fs.mkdir(RECORDINGS_DIR, { recursive: true });
      const openPathResult = await shell.openPath(RECORDINGS_DIR);
      if (openPathResult) {
        return { success: false, error: openPathResult, message: 'Failed to open recordings folder.' };
      }

      return { success: true };
    } catch (error) {
      console.error('Failed to open recordings folder:', error);
      return { success: false, error: String(error), message: 'Failed to open recordings folder.' };
    }
  });

  ipcMain.handle('save-project-file', async (_, projectData: unknown, suggestedName?: string, existingProjectPath?: string) => {
    try {
      const trustedExistingProjectPath = isTrustedProjectPath(existingProjectPath)
        ? existingProjectPath
        : null

      if (trustedExistingProjectPath) {
        await fs.writeFile(trustedExistingProjectPath, JSON.stringify(projectData, null, 2), 'utf-8')
        currentProjectPath = trustedExistingProjectPath
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
        defaultPath: path.join(RECORDINGS_DIR, defaultName),
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
      const result = await dialog.showOpenDialog({
        title: 'Open Recordly Project',
        defaultPath: RECORDINGS_DIR,
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

      const filePath = result.filePaths[0]
      const content = await fs.readFile(filePath, 'utf-8')
      const project = JSON.parse(content)
      currentProjectPath = filePath
      if (project && typeof project === 'object' && typeof project.videoPath === 'string') {
        currentVideoPath = project.videoPath
      }

      return {
        success: true,
        path: filePath,
        project
      }
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

      const content = await fs.readFile(currentProjectPath, 'utf-8')
      const project = JSON.parse(content)
      if (project && typeof project === 'object' && typeof project.videoPath === 'string') {
        currentVideoPath = project.videoPath
      }
      return {
        success: true,
        path: currentProjectPath,
        project,
      }
    } catch (error) {
      console.error('Failed to load current project file:', error)
      return {
        success: false,
        message: 'Failed to load current project file',
        error: String(error),
      }
    }
  })
  ipcMain.handle('set-current-video-path', (_, path: string) => {
    currentVideoPath = path;
    currentProjectPath = null
    return { success: true };
  });

  ipcMain.handle('get-current-video-path', () => {
    return currentVideoPath ? { success: true, path: currentVideoPath } : { success: false };
  });

  ipcMain.handle('clear-current-video-path', () => {
    currentVideoPath = null;
    return { success: true };
  });

  ipcMain.handle('get-platform', () => {
    return process.platform;
  });

  // ---------------------------------------------------------------------------
  // Cursor hiding for the browser-capture fallback.
  // The IPC promise resolves only after the cursor hide attempt completes.
  // ---------------------------------------------------------------------------
  ipcMain.handle('hide-cursor', () => {
    // No-op: macOS uses native ScreenCaptureKit (cursor excluded at capture
    // level), and Win/Linux use Electron desktopCapturer where cursor hiding
    // is not reliably supported.
    return { success: true }
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
}
