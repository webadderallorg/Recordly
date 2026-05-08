const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const drawHeight = 256;
const padding = 2;
const cursorTypes = [
  "arrow",
  "text",
  "pointer",
  "crosshair",
  "open-hand",
  "closed-hand",
  "resize-ew",
  "resize-ns",
  "not-allowed",
];
const tahoeAssets = {
  arrow: ["pointer-1__14-6.svg", 0.14, 0.06],
  text: ["ibeam-1__50-44.svg", 0.5, 0.44],
  pointer: ["pointinghand-1__40-10.svg", 0.4, 0.1],
  crosshair: ["crosshair-1__50-50.svg", 0.5, 0.5],
  "open-hand": ["openhand-1__55-57.svg", 0.55, 0.57],
  "closed-hand": ["closedhand-1__50-46.svg", 0.5, 0.46],
  "resize-ew": ["resizeeastwest-1__50-50.svg", 0.5, 0.5],
  "resize-ns": ["resizenorthsouth-1__50-49.svg", 0.5, 0.49],
  "not-allowed": ["notallowed-1__23-0.svg", 0.23, 0],
};

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

const repoRoot = arg("--repo-root");
const atlasRgbaPath = arg("--output-rgba");
const atlasMetadataPath = arg("--output-metadata");

if (!repoRoot || !atlasRgbaPath || !atlasMetadataPath) {
  console.error("Usage: electron render-tahoe-cursor-atlas.cjs --repo-root <repo> --output-rgba <raw> --output-metadata <tsv>");
  process.exit(1);
}

const assets = cursorTypes.map((type, index) => {
  const [fileName, anchorX, anchorY] = tahoeAssets[type];
  return {
    type,
    index,
    filePath: path.join(repoRoot, "src", "assets", "cursors", "tahoe", fileName),
    anchorX,
    anchorY,
  };
});

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
    },
  });

  ipcMain.once("atlas-ready", (_event, result) => {
    console.log(JSON.stringify(result));
    app.quit();
  });

  const html = `
<!doctype html>
<meta charset="utf-8">
<script>
const { ipcRenderer } = require("electron");
const fs = require("node:fs");
const assets = ${JSON.stringify(assets)};
const atlasRgbaPath = ${JSON.stringify(atlasRgbaPath)};
const atlasMetadataPath = ${JSON.stringify(atlasMetadataPath)};
const drawHeight = ${drawHeight};
const padding = ${padding};

function loadImage(asset) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ asset, image });
    image.onerror = () => reject(new Error("Failed to load cursor SVG: " + asset.filePath));
    const svg = fs.readFileSync(asset.filePath, "utf8");
    image.src = "data:image/svg+xml;base64," + Buffer.from(svg, "utf8").toString("base64");
  });
}

(async () => {
  const loaded = await Promise.all(assets.map(loadImage));
  const packed = loaded.map(({ asset, image }) => {
    const aspectRatio = image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : 1;
    return {
      asset,
      image,
      width: Math.max(1, Math.round(drawHeight * aspectRatio)),
      height: drawHeight,
      aspectRatio,
    };
  });
  const atlasWidth = packed.reduce((sum, item) => sum + item.width + padding, padding);
  const atlasHeight = drawHeight + padding * 2;
  const canvas = document.createElement("canvas");
  canvas.width = atlasWidth;
  canvas.height = atlasHeight;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, atlasWidth, atlasHeight);

  let x = padding;
  const rows = [];
  for (const item of packed) {
    const y = padding;
    ctx.drawImage(item.image, x, y, item.width, item.height);
    rows.push([
      item.asset.index,
      x,
      y,
      item.width,
      item.height,
      item.asset.anchorX,
      item.asset.anchorY,
      item.aspectRatio,
    ].join("\\t"));
    x += item.width + padding;
  }

  const imageData = ctx.getImageData(0, 0, atlasWidth, atlasHeight).data;
  fs.writeFileSync(atlasRgbaPath, Buffer.from(imageData.buffer));
  fs.writeFileSync(atlasMetadataPath, rows.join("\\n") + "\\n");
  ipcRenderer.send("atlas-ready", { width: atlasWidth, height: atlasHeight, entries: rows.length });
})().catch((error) => {
  ipcRenderer.send("atlas-ready", { error: error.message });
});
</script>`;

  await window.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
});
