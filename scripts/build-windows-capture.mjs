import { execSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const sourceDir = path.join(projectRoot, 'electron', 'native', 'wgc-capture');
const buildDir = path.join(sourceDir, 'build');

if (process.platform !== 'win32') {
  console.log('[build-windows-capture] Skipping native Windows capture build: host platform is not Windows.');
  process.exit(0);
}

if (!existsSync(path.join(sourceDir, 'CMakeLists.txt'))) {
  console.error('[build-windows-capture] CMakeLists.txt not found at', sourceDir);
  process.exit(1);
}

function findCmake() {
  // Check PATH first
  try {
    execSync('cmake --version', { stdio: 'pipe' });
    return 'cmake';
  } catch {
    // not on PATH
  }

  // VS 2022 bundled CMake
  const vsEditions = ['Community', 'Professional', 'Enterprise', 'BuildTools'];
  for (const edition of vsEditions) {
    const cmakePath = path.join(
      'C:', 'Program Files', 'Microsoft Visual Studio', '2022', edition,
      'Common7', 'IDE', 'CommonExtensions', 'Microsoft', 'CMake', 'CMake', 'bin', 'cmake.exe'
    );
    if (existsSync(cmakePath)) {
      return `"${cmakePath}"`;
    }
  }

  return null;
}

const cmake = findCmake();
if (!cmake) {
  console.error('[build-windows-capture] CMake not found. Install Visual Studio with C++ CMake tools or standalone CMake.');
  process.exit(1);
}

mkdirSync(buildDir, { recursive: true });

console.log('[build-windows-capture] Configuring CMake...');
try {
  execSync(`${cmake} .. -G "Visual Studio 17 2022" -A x64`, {
    cwd: buildDir,
    stdio: 'inherit',
    timeout: 120000,
  });
} catch {
  console.log('[build-windows-capture] VS 2022 generator not found, trying VS 2019...');
  try {
    execSync(`${cmake} .. -G "Visual Studio 16 2019" -A x64`, {
      cwd: buildDir,
      stdio: 'inherit',
      timeout: 120000,
    });
  } catch (innerError) {
    console.error('[build-windows-capture] CMake configure failed:', innerError.message);
    process.exit(1);
  }
}

console.log('[build-windows-capture] Building native Windows capture helper...');
try {
  execSync(`${cmake} --build . --config Release`, {
    cwd: buildDir,
    stdio: 'inherit',
    timeout: 300000,
  });
} catch (error) {
  console.error('[build-windows-capture] Build failed:', error.message);
  process.exit(1);
}

const exePath = path.join(buildDir, 'Release', 'wgc-capture.exe');
if (existsSync(exePath)) {
  console.log(`[build-windows-capture] Built successfully: ${exePath}`);
} else {
  console.error('[build-windows-capture] Expected exe not found at', exePath);
  process.exit(1);
}
