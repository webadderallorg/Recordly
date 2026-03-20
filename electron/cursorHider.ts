import { spawnSync } from 'node:child_process'

const PY_HIDE_WIN = `
import ctypes, sys

class POINT(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]

class CURSORINFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", ctypes.c_uint),
        ("flags", ctypes.c_uint),
        ("hCursor", ctypes.c_void_p),
        ("ptScreenPos", POINT),
    ]

user32 = ctypes.windll.user32
CURSOR_SHOWING = 0x00000001

for _ in range(32):
    info = CURSORINFO()
    info.cbSize = ctypes.sizeof(CURSORINFO)
    if user32.GetCursorInfo(ctypes.byref(info)) and not (info.flags & CURSOR_SHOWING):
        sys.exit(0)
    user32.ShowCursor(False)

sys.exit(0)
`.trim()

const PY_SHOW_WIN = `
import ctypes, sys

class POINT(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]

class CURSORINFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", ctypes.c_uint),
        ("flags", ctypes.c_uint),
        ("hCursor", ctypes.c_void_p),
        ("ptScreenPos", POINT),
    ]

user32 = ctypes.windll.user32
CURSOR_SHOWING = 0x00000001

for _ in range(32):
    info = CURSORINFO()
    info.cbSize = ctypes.sizeof(CURSORINFO)
    if user32.GetCursorInfo(ctypes.byref(info)) and (info.flags & CURSOR_SHOWING):
        sys.exit(0)
    user32.ShowCursor(True)

sys.exit(0)
`.trim()

function getPowerShellCommand(show: boolean) {
  const desiredFlag = show ? 1 : 0
  const showLiteral = show ? '$true' : '$false'

  return [
    '$signature = @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public struct POINT { public int X; public int Y; }',
    'public struct CURSORINFO { public int cbSize; public int flags; public IntPtr hCursor; public POINT ptScreenPos; }',
    'public static class CursorNative {',
    '  [DllImport("user32.dll")] public static extern int ShowCursor(bool show);',
    '  [DllImport("user32.dll")] public static extern bool GetCursorInfo(ref CURSORINFO info);',
    '}',
    '"@;',
    'Add-Type -TypeDefinition $signature -Language CSharp -ErrorAction SilentlyContinue | Out-Null;',
    '$info = New-Object CURSORINFO;',
    '$info.cbSize = [Runtime.InteropServices.Marshal]::SizeOf([type]CURSORINFO);',
    'for ($i = 0; $i -lt 32; $i++) {',
    '  if ([CursorNative]::GetCursorInfo([ref]$info) -and (($info.flags -band 1) -eq ' + desiredFlag + ')) { exit 0 }',
    '  [CursorNative]::ShowCursor(' + showLiteral + ') | Out-Null;',
    '}',
    'exit 0',
  ].join(' ')
}

function runPythonSnippet(code: string) {
  for (const executable of ['python', 'python3', 'py']) {
    const result = spawnSync(executable, ['-c', code], { timeout: 5000 })
    if (!result.error && result.status === 0) {
      return true
    }
  }

  return false
}

function runPowerShellSnippet(command: string) {
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', command],
    { timeout: 8000 },
  )

  return !result.error && result.status === 0
}

let cursorHidden = false

export function hideCursor() {
  if (process.platform !== 'win32' || cursorHidden) {
    return false
  }

  try {
    const didHide = runPythonSnippet(PY_HIDE_WIN)
      || runPowerShellSnippet(getPowerShellCommand(false))

    if (didHide) {
      cursorHidden = true
    }

    return didHide
  } catch (error) {
    console.error('[cursorHider] Failed to hide Windows cursor:', error)
    return false
  }
}

export function showCursor() {
  if (process.platform !== 'win32' || !cursorHidden) {
    return false
  }

  try {
    const didShow = runPythonSnippet(PY_SHOW_WIN)
      || runPowerShellSnippet(getPowerShellCommand(true))
    return didShow
  } catch (error) {
    console.error('[cursorHider] Failed to show Windows cursor:', error)
    return false
  } finally {
    cursorHidden = false
  }
}