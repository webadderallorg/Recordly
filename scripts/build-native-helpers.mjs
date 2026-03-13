import { spawnSync } from 'node:child_process';
import { chmod, mkdir } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const nativeRoot = path.join(projectRoot, 'electron', 'native');

if (process.platform !== 'darwin') {
  console.log('[build-native-helpers] Skipping: host platform is not macOS.');
  process.exit(0);
}

const archTag = process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
const outputDir = path.join(nativeRoot, 'bin', archTag);

const helpers = [
  {
    source: 'ScreenCaptureKitRecorder.swift',
    output: 'openscreen-screencapturekit-helper',
  },
  {
    source: 'ScreenCaptureKitWindowList.swift',
    output: 'openscreen-window-list',
  },
  {
    source: 'SystemCursorAssets.swift',
    output: 'openscreen-system-cursors',
  },
  {
    source: 'NativeCursorMonitor.swift',
    output: 'openscreen-native-cursor-monitor',
  },
];

const swiftcCheck = spawnSync('swiftc', ['--version'], { encoding: 'utf8' });
if (swiftcCheck.status !== 0) {
  const details = [swiftcCheck.stderr, swiftcCheck.stdout].filter(Boolean).join('\n').trim();
  throw new Error(details || 'swiftc is unavailable; install Xcode Command Line Tools.');
}

await mkdir(outputDir, { recursive: true });

for (const helper of helpers) {
  const sourcePath = path.join(nativeRoot, helper.source);
  const outputPath = path.join(outputDir, helper.output);

  const result = spawnSync('swiftc', ['-O', sourcePath, '-o', outputPath], {
    encoding: 'utf8',
    timeout: 120000,
  });

  if (result.status !== 0) {
    const details = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(details || `Failed to compile ${helper.source}`);
  }

  await chmod(outputPath, 0o755);
  console.log(`[build-native-helpers] Built ${helper.output} -> ${outputPath}`);
}
