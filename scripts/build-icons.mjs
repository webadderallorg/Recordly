import { spawnSync } from 'node:child_process';
import { access, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const sourceIconPath = path.join(repoRoot, 'branding', 'source-assets', 'open-recorder-brand-image.png');
const iconBuilderEntryPath = path.join(repoRoot, 'node_modules', 'electron-icon-builder', 'index.js');

const generatedPngDir = path.join(repoRoot, 'icons', 'icons', 'png');

const publicIconSizes = [16, 32, 64, 128, 256, 512, 1024];
const brandAssetSizes = [16, 32, 64, 128, 256, 512, 1024];

async function ensureFileExists(filePath) {
  await access(filePath);
}

async function copyWithParents(from, to) {
  await mkdir(path.dirname(to), { recursive: true });
  await copyFile(from, to);
}

function runIconBuilder() {
  const result = spawnSync(
    process.execPath,
    [iconBuilderEntryPath, '--input', sourceIconPath, '--output', 'icons'],
    {
      cwd: repoRoot,
      stdio: 'inherit',
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`electron-icon-builder failed with exit code ${result.status ?? 'unknown'}`);
  }
}

async function syncGeneratedAssets() {
  const copyJobs = [];

  for (const size of publicIconSizes) {
    copyJobs.push(
      copyWithParents(
        path.join(generatedPngDir, `${size}x${size}.png`),
        path.join(repoRoot, 'public', 'app-icons', `open-recorder-${size}.png`),
      ),
    );
  }

  for (const size of brandAssetSizes) {
    copyJobs.push(
      copyWithParents(
        path.join(generatedPngDir, `${size}x${size}.png`),
        path.join(repoRoot, 'branding', 'source-assets', `${size}-mac.png`),
      ),
    );
  }

  copyJobs.push(
    copyWithParents(
      path.join(generatedPngDir, '64x64.png'),
      path.join(repoRoot, 'public', 'rec-button.png'),
    ),
  );

  copyJobs.push(
    copyWithParents(
      path.join(generatedPngDir, '1024x1024.png'),
      path.join(repoRoot, 'public', 'openscreen.png'),
    ),
  );

  await Promise.all(copyJobs);
}

async function main() {
  await ensureFileExists(sourceIconPath);
  await ensureFileExists(iconBuilderEntryPath);
  runIconBuilder();
  await syncGeneratedAssets();
  console.log('Brand icons regenerated from branding/source-assets/open-recorder-brand-image.png');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
