export interface BuiltInWallpaper {
  id: string;
  label: string;
  relativePath: string;
  publicPath: string;
}

const IMAGE_FILE_PATTERN = /\.(avif|gif|jpe?g|png|svg|webp)$/i;
const VIDEO_FILE_PATTERN = /\.(avi|m4v|mkv|mov|mp4|webm)$/i;

export const BUILT_IN_WALLPAPERS: BuiltInWallpaper[] = [
  { id: 'wallpaper-1', label: 'Wallpaper 1', relativePath: 'wallpapers/wallpaper1.jpg', publicPath: '/wallpapers/wallpaper1.jpg' },
  { id: 'wallpaper-2', label: 'Wallpaper 2', relativePath: 'wallpapers/wallpaper2.jpg', publicPath: '/wallpapers/wallpaper2.jpg' },
  { id: 'wallpaper-3', label: 'Wallpaper 3', relativePath: 'wallpapers/wallpaper3.jpg', publicPath: '/wallpapers/wallpaper3.jpg' },
  { id: 'wallpaper-4', label: 'Wallpaper 4', relativePath: 'wallpapers/wallpaper4.jpg', publicPath: '/wallpapers/wallpaper4.jpg' },
  { id: 'wallpaper-5', label: 'Wallpaper 5', relativePath: 'wallpapers/wallpaper5.jpg', publicPath: '/wallpapers/wallpaper5.jpg' },
  { id: 'wallpaper-6', label: 'Wallpaper 6', relativePath: 'wallpapers/wallpaper6.jpg', publicPath: '/wallpapers/wallpaper6.jpg' },
  { id: 'wallpaper-7', label: 'Wallpaper 7', relativePath: 'wallpapers/wallpaper7.jpg', publicPath: '/wallpapers/wallpaper7.jpg' },
  { id: 'wallpaper-8', label: 'Wallpaper 8', relativePath: 'wallpapers/wallpaper8.jpg', publicPath: '/wallpapers/wallpaper8.jpg' },
  { id: 'wallpaper-9', label: 'Wallpaper 9', relativePath: 'wallpapers/wallpaper9.jpg', publicPath: '/wallpapers/wallpaper9.jpg' },
  { id: 'wallpaper-10', label: 'Wallpaper 10', relativePath: 'wallpapers/wallpaper10.jpg', publicPath: '/wallpapers/wallpaper10.jpg' },
  { id: 'wallpaper-11', label: 'Wallpaper 11', relativePath: 'wallpapers/wallpaper11.jpg', publicPath: '/wallpapers/wallpaper11.jpg' },
  { id: 'wallpaper-12', label: 'Wallpaper 12', relativePath: 'wallpapers/wallpaper12.jpg', publicPath: '/wallpapers/wallpaper12.jpg' },
  { id: 'wallpaper-13', label: 'Wallpaper 13', relativePath: 'wallpapers/wallpaper13.jpg', publicPath: '/wallpapers/wallpaper13.jpg' },
  { id: 'wallpaper-14', label: 'Wallpaper 14', relativePath: 'wallpapers/wallpaper14.jpg', publicPath: '/wallpapers/wallpaper14.jpg' },
  { id: 'wallpaper-15', label: 'Wallpaper 15', relativePath: 'wallpapers/wallpaper15.jpg', publicPath: '/wallpapers/wallpaper15.jpg' },
  { id: 'wallpaper-16', label: 'Wallpaper 16', relativePath: 'wallpapers/wallpaper16.jpg', publicPath: '/wallpapers/wallpaper16.jpg' },
  { id: 'wallpaper-17', label: 'Wallpaper 17', relativePath: 'wallpapers/wallpaper17.jpg', publicPath: '/wallpapers/wallpaper17.jpg' },
  { id: 'wallpaper-18', label: 'Wallpaper 18', relativePath: 'wallpapers/wallpaper18.jpg', publicPath: '/wallpapers/wallpaper18.jpg' },
  { id: 'cityscape', label: 'Cityscape', relativePath: 'wallpapers/cityscape.jpg', publicPath: '/wallpapers/cityscape.jpg' },
  { id: 'farmvalley', label: 'Farm Valley', relativePath: 'wallpapers/farmvalley.jpg', publicPath: '/wallpapers/farmvalley.jpg' },
  { id: 'levels', label: 'Levels', relativePath: 'wallpapers/levels.jpg', publicPath: '/wallpapers/levels.jpg' },
  { id: 'mountaintrees', label: 'Mountain Trees', relativePath: 'wallpapers/mountaintrees.jpg', publicPath: '/wallpapers/mountaintrees.jpg' },
  { id: 'luisdelrio', label: 'Luis Del Rio', relativePath: 'wallpapers/luisdelrio.jpg', publicPath: '/wallpapers/luisdelrio.jpg' },
];

export const WALLPAPER_PATHS = BUILT_IN_WALLPAPERS.map((wallpaper) => wallpaper.publicPath);
export const WALLPAPER_RELATIVE_PATHS = BUILT_IN_WALLPAPERS.map((wallpaper) => wallpaper.relativePath);
export const DEFAULT_WALLPAPER_PATH = '/wallpapers/wallpaper2.jpg';
export const DEFAULT_WALLPAPER_RELATIVE_PATH = 'wallpapers/wallpaper2.jpg';

export function isVideoWallpaperSource(value: string): boolean {
  if (!value) {
    return false;
  }

  if (value.startsWith("blob:")) {
    return true;
  }

  const normalizedValue = value.split("?")[0]?.toLowerCase() ?? value.toLowerCase();
  return VIDEO_FILE_PATTERN.test(normalizedValue);
}

function toWallpaperId(fileName: string) {
  return fileName
    .replace(/\.[^.]+$/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toWallpaperLabel(fileName: string) {
  const baseName = fileName.replace(/\.[^.]+$/, "").trim();
  if (!baseName) {
    return "Wallpaper";
  }

  return baseName
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function createWallpaperEntry(fileName: string): BuiltInWallpaper {
  const encodedFileName = encodeURIComponent(fileName);
  return {
    id: toWallpaperId(fileName) || `wallpaper-${encodedFileName.toLowerCase()}`,
    label: toWallpaperLabel(fileName),
    relativePath: `wallpapers/${fileName}`,
    publicPath: `/wallpapers/${encodedFileName}`,
  };
}

function sortWallpaperFiles(fileNames: string[]) {
  return [...fileNames].sort(
    new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare,
  );
}

export async function getAvailableWallpapers(): Promise<BuiltInWallpaper[]> {
  const fallbackWallpapers = BUILT_IN_WALLPAPERS;

  if (typeof window === "undefined" || !window.electronAPI?.listAssetDirectory) {
    return fallbackWallpapers;
  }

  try {
    const result = await window.electronAPI.listAssetDirectory("wallpapers");
    if (!result.success || !result.files?.length) {
      return fallbackWallpapers;
    }

    const discoveredFiles = sortWallpaperFiles(
      result.files.filter((fileName) => IMAGE_FILE_PATTERN.test(fileName)),
    );

    if (discoveredFiles.length === 0) {
      return fallbackWallpapers;
    }

    return discoveredFiles.map(createWallpaperEntry);
  } catch {
    return fallbackWallpapers;
  }
}
