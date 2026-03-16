export type FacecamShape = 'circle' | 'square'

export interface FacecamSettings {
  enabled: boolean
  shape: FacecamShape
  size: number
  cornerRadius: number
  borderWidth: number
  borderColor: string
  margin: number
}

export interface RecordingSession {
  screenVideoPath: string
  facecamVideoPath?: string
  facecamOffsetMs?: number
  facecamSettings?: FacecamSettings
}

export interface PersistedRecordingSession extends RecordingSession {
  version: number
}

export const RECORDING_SESSION_VERSION = 1
export const DEFAULT_FACECAM_BORDER_COLOR = '#FFFFFF'

export function createDefaultFacecamSettings(enabled = false): FacecamSettings {
  return {
    enabled,
    shape: 'circle',
    size: 22,
    cornerRadius: 24,
    borderWidth: 4,
    borderColor: DEFAULT_FACECAM_BORDER_COLOR,
    margin: 4,
  }
}

export function clampFacecamSetting(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min
  }

  return Math.min(max, Math.max(min, value))
}

export function normalizeFacecamSettings(
  candidate: Partial<FacecamSettings> | null | undefined,
  options: { defaultEnabled?: boolean } = {},
): FacecamSettings {
  const fallback = createDefaultFacecamSettings(options.defaultEnabled ?? false)

  return {
    enabled: typeof candidate?.enabled === 'boolean' ? candidate.enabled : fallback.enabled,
    shape: candidate?.shape === 'square' ? 'square' : fallback.shape,
    size: clampFacecamSetting(
      typeof candidate?.size === 'number' ? candidate.size : fallback.size,
      12,
      40,
    ),
    cornerRadius: clampFacecamSetting(
      typeof candidate?.cornerRadius === 'number' ? candidate.cornerRadius : fallback.cornerRadius,
      0,
      50,
    ),
    borderWidth: clampFacecamSetting(
      typeof candidate?.borderWidth === 'number' ? candidate.borderWidth : fallback.borderWidth,
      0,
      16,
    ),
    borderColor:
      typeof candidate?.borderColor === 'string' && candidate.borderColor.trim()
        ? candidate.borderColor
        : fallback.borderColor,
    margin: clampFacecamSetting(
      typeof candidate?.margin === 'number' ? candidate.margin : fallback.margin,
      0,
      12,
    ),
  }
}

export function normalizeRecordingSession(
  candidate: Partial<RecordingSession> | null | undefined,
): RecordingSession | null {
  if (!candidate || typeof candidate.screenVideoPath !== 'string' || !candidate.screenVideoPath.trim()) {
    return null
  }

  const facecamVideoPath =
    typeof candidate.facecamVideoPath === 'string' && candidate.facecamVideoPath.trim()
      ? candidate.facecamVideoPath
      : undefined
  const facecamOffsetMs =
    typeof candidate.facecamOffsetMs === 'number' && Number.isFinite(candidate.facecamOffsetMs)
      ? candidate.facecamOffsetMs
      : undefined

  return {
    screenVideoPath: candidate.screenVideoPath,
    facecamVideoPath,
    facecamOffsetMs,
    facecamSettings: normalizeFacecamSettings(candidate.facecamSettings, {
      defaultEnabled: Boolean(facecamVideoPath),
    }),
  }
}

export function createPersistedRecordingSession(
  session: RecordingSession,
): PersistedRecordingSession {
  return {
    version: RECORDING_SESSION_VERSION,
    ...session,
  }
}

export function getFacecamLayout(
  stageWidth: number,
  stageHeight: number,
  settings: FacecamSettings,
) {
  const minDimension = Math.min(stageWidth, stageHeight)
  const size = minDimension * (settings.size / 100)
  const margin = minDimension * (settings.margin / 100)
  const x = Math.max(0, stageWidth - size - margin)
  const y = Math.max(0, stageHeight - size - margin)
  const borderRadius = settings.shape === 'circle'
    ? size / 2
    : Math.min(size / 2, size * (settings.cornerRadius / 100))

  return {
    x,
    y,
    size,
    borderRadius,
  }
}
