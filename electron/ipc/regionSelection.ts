import { BrowserWindow, type Display } from "electron";
import {
	normalizeCaptureRegion,
	type Rectangle,
	toPixelCaptureRegion,
} from "./regionSelectionGeometry";
import type { CaptureRegion, SelectedSource } from "./types";
import { getScreen } from "./utils";

const MIN_USER_CAPTURE_SIZE = 64;
let activeRegionSelection: Promise<SelectedSource | null> | null = null;

function buildInitialRegion(display: Display): Rectangle {
	const scaleFactor = Math.max(1, display.scaleFactor || 1);
	const targetWidth = Math.min(display.bounds.width * 0.8, 1280 / scaleFactor);
	const targetHeight = Math.min(display.bounds.height * 0.8, 720 / scaleFactor);
	return {
		x: Math.round((display.bounds.width - targetWidth) / 2),
		y: Math.round((display.bounds.height - targetHeight) / 2),
		width: Math.round(targetWidth),
		height: Math.round(targetHeight),
	};
}

function buildSelectionHtml(display: Display, initialRegion: Rectangle) {
	const initial = JSON.stringify(initialRegion).replace(/</g, "\\u003c");
	const scaleFactor = Math.max(1, display.scaleFactor || 1);
	return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root { color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  * { box-sizing: border-box; }
  html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; user-select: none; }
  body { cursor: crosshair; background: rgba(8, 9, 13, .48); }
  #hint { position: fixed; top: 26px; left: 50%; transform: translateX(-50%); padding: 9px 14px;
    border: 1px solid rgba(255,255,255,.16); border-radius: 10px; background: rgba(24,24,29,.88);
    box-shadow: 0 8px 28px rgba(0,0,0,.32); color: rgba(255,255,255,.88); font-size: 13px;
    letter-spacing: -.01em; pointer-events: none; backdrop-filter: blur(18px); }
  #selection { position: absolute; border: 2px solid white; border-radius: 5px; cursor: move;
    box-shadow: 0 0 0 9999px rgba(7,8,12,.60), 0 0 0 1px rgba(0,0,0,.32), 0 10px 30px rgba(0,0,0,.20); }
  #selection::before { content: ""; position: absolute; inset: -1px; border-radius: 4px;
    box-shadow: inset 0 0 0 1px rgba(99,102,241,.9); pointer-events: none; }
  #dimensions { position: absolute; top: -35px; left: 50%; transform: translateX(-50%); white-space: nowrap;
    padding: 5px 9px; border-radius: 7px; background: rgba(18,18,22,.94); color: white; font-size: 12px;
    font-variant-numeric: tabular-nums; box-shadow: 0 5px 18px rgba(0,0,0,.28); pointer-events: none; }
  .handle { position: absolute; width: 12px; height: 12px; border: 2px solid white; border-radius: 50%;
    background: #6366f1; box-shadow: 0 1px 5px rgba(0,0,0,.5); }
  [data-handle=nw]{left:-7px;top:-7px;cursor:nwse-resize}[data-handle=n]{left:50%;top:-7px;transform:translateX(-50%);cursor:ns-resize}
  [data-handle=ne]{right:-7px;top:-7px;cursor:nesw-resize}[data-handle=e]{right:-7px;top:50%;transform:translateY(-50%);cursor:ew-resize}
  [data-handle=se]{right:-7px;bottom:-7px;cursor:nwse-resize}[data-handle=s]{left:50%;bottom:-7px;transform:translateX(-50%);cursor:ns-resize}
  [data-handle=sw]{left:-7px;bottom:-7px;cursor:nesw-resize}[data-handle=w]{left:-7px;top:50%;transform:translateY(-50%);cursor:ew-resize}
  #toolbar { position: fixed; display: flex; align-items: center; gap: 8px; height: 46px; padding: 6px;
    border: 1px solid rgba(255,255,255,.14); border-radius: 13px; background: rgba(24,24,29,.94);
    box-shadow: 0 12px 36px rgba(0,0,0,.38); backdrop-filter: blur(22px); cursor: default; }
  .dimension-input { width: 70px; height: 32px; padding: 0 8px; border: 1px solid rgba(255,255,255,.12);
    border-radius: 8px; outline: none; background: rgba(255,255,255,.07); color: white; font-size: 12px;
    text-align: center; font-variant-numeric: tabular-nums; user-select: text; }
  .dimension-input:focus { border-color: #7779f4; box-shadow: 0 0 0 2px rgba(99,102,241,.2); }
  .times { color: rgba(255,255,255,.48); font-size: 12px; }
  button { height: 32px; border: 0; border-radius: 8px; padding: 0 12px; color: white; font-weight: 600;
    font-size: 12px; cursor: pointer; }
  #cancel { background: rgba(255,255,255,.08); } #cancel:hover { background: rgba(255,255,255,.13); }
  #confirm { background: #6366f1; } #confirm:hover { background: #7477f8; }
</style>
</head>
<body>
  <div id="hint">Drag to select an area · Enter to confirm · Esc to cancel</div>
  <div id="selection">
    <div id="dimensions"></div>
    <i class="handle" data-handle="nw"></i><i class="handle" data-handle="n"></i><i class="handle" data-handle="ne"></i>
    <i class="handle" data-handle="e"></i><i class="handle" data-handle="se"></i><i class="handle" data-handle="s"></i>
    <i class="handle" data-handle="sw"></i><i class="handle" data-handle="w"></i>
  </div>
  <div id="toolbar" data-control="true">
    <input id="width" class="dimension-input" type="number" min="${MIN_USER_CAPTURE_SIZE}" aria-label="Width">
    <span class="times">×</span>
    <input id="height" class="dimension-input" type="number" min="${MIN_USER_CAPTURE_SIZE}" aria-label="Height">
    <button id="cancel" type="button">Cancel</button>
    <button id="confirm" type="button">Select Area</button>
  </div>
<script>
(() => {
  const scale = ${scaleFactor};
  const minSize = ${MIN_USER_CAPTURE_SIZE} / scale;
  const selection = document.getElementById('selection');
  const dimensions = document.getElementById('dimensions');
  const toolbar = document.getElementById('toolbar');
  const widthInput = document.getElementById('width');
  const heightInput = document.getElementById('height');
  let rect = ${initial};
  let interaction = null;

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const normalize = value => ({
    x: clamp(value.x, 0, Math.max(0, innerWidth - minSize)),
    y: clamp(value.y, 0, Math.max(0, innerHeight - minSize)),
    width: clamp(value.width, minSize, Math.max(minSize, innerWidth - clamp(value.x, 0, innerWidth))),
    height: clamp(value.height, minSize, Math.max(minSize, innerHeight - clamp(value.y, 0, innerHeight)))
  });
  const render = () => {
    rect = normalize(rect);
    selection.style.left = rect.x + 'px'; selection.style.top = rect.y + 'px';
    selection.style.width = rect.width + 'px'; selection.style.height = rect.height + 'px';
    const pixelWidth = Math.round(rect.width * scale); const pixelHeight = Math.round(rect.height * scale);
    dimensions.textContent = pixelWidth + ' × ' + pixelHeight;
    if (document.activeElement !== widthInput) widthInput.value = pixelWidth;
    if (document.activeElement !== heightInput) heightInput.value = pixelHeight;
    const toolbarWidth = 330; const toolbarHeight = 46; const gap = 14;
    const left = clamp(rect.x + rect.width / 2 - toolbarWidth / 2, 12, innerWidth - toolbarWidth - 12);
    const preferredTop = rect.y + rect.height + gap;
    const top = preferredTop + toolbarHeight <= innerHeight - 12
      ? preferredTop : Math.max(12, rect.y - toolbarHeight - gap);
    toolbar.style.left = left + 'px'; toolbar.style.top = top + 'px';
  };
  const submit = action => {
    const params = new URLSearchParams({ x: String(rect.x), y: String(rect.y), width: String(rect.width), height: String(rect.height) });
    location.href = 'recordly-region://' + action + '?' + params.toString();
  };
  const updateDimension = () => {
    const width = Number(widthInput.value) / scale; const height = Number(heightInput.value) / scale;
    if (Number.isFinite(width) && width >= minSize) rect.width = Math.min(width, innerWidth - rect.x);
    if (Number.isFinite(height) && height >= minSize) rect.height = Math.min(height, innerHeight - rect.y);
    render();
  };

  document.addEventListener('pointerdown', event => {
    if (event.target.closest('[data-control=true]')) return;
    const handle = event.target.dataset.handle;
    const inside = event.target.closest('#selection');
    interaction = { mode: handle ? 'resize' : inside ? 'move' : 'draw', handle, startX: event.clientX,
      startY: event.clientY, start: {...rect} };
    if (interaction.mode === 'draw') rect = { x: event.clientX, y: event.clientY, width: minSize, height: minSize };
    document.body.setPointerCapture?.(event.pointerId); render(); event.preventDefault();
  });
  document.addEventListener('pointermove', event => {
    if (!interaction) return;
    const dx = event.clientX - interaction.startX; const dy = event.clientY - interaction.startY;
    if (interaction.mode === 'move') {
      rect.x = clamp(interaction.start.x + dx, 0, innerWidth - rect.width);
      rect.y = clamp(interaction.start.y + dy, 0, innerHeight - rect.height);
    } else if (interaction.mode === 'draw') {
      rect.x = Math.min(interaction.startX, event.clientX); rect.y = Math.min(interaction.startY, event.clientY);
      rect.width = Math.max(minSize, Math.abs(dx)); rect.height = Math.max(minSize, Math.abs(dy));
    } else {
      const h = interaction.handle; const start = interaction.start;
      if (h.includes('w')) { const right = start.x + start.width; rect.x = clamp(start.x + dx, 0, right - minSize); rect.width = right - rect.x; }
      if (h.includes('e')) rect.width = clamp(start.width + dx, minSize, innerWidth - start.x);
      if (h.includes('n')) { const bottom = start.y + start.height; rect.y = clamp(start.y + dy, 0, bottom - minSize); rect.height = bottom - rect.y; }
      if (h.includes('s')) rect.height = clamp(start.height + dy, minSize, innerHeight - start.y);
    }
    render(); event.preventDefault();
  });
  document.addEventListener('pointerup', () => { interaction = null; });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); submit('cancel'); }
    if (event.key === 'Enter' && document.activeElement !== widthInput && document.activeElement !== heightInput) {
      event.preventDefault(); submit('confirm');
    }
  });
  selection.addEventListener('dblclick', () => submit('confirm'));
  widthInput.addEventListener('change', updateDimension); heightInput.addEventListener('change', updateDimension);
  document.getElementById('cancel').addEventListener('click', () => submit('cancel'));
  document.getElementById('confirm').addEventListener('click', () => submit('confirm'));
  addEventListener('resize', render); render();
})();
</script>
</body>
</html>`;
}

async function runRegionSelection(): Promise<SelectedSource | null> {
	const screen = getScreen();
	const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
	const initialRegion = buildInitialRegion(display);

	return await new Promise((resolve) => {
		let settled = false;
		const selectionWindow = new BrowserWindow({
			...display.bounds,
			frame: false,
			transparent: true,
			alwaysOnTop: true,
			skipTaskbar: true,
			hasShadow: false,
			resizable: false,
			movable: false,
			fullscreenable: false,
			show: false,
			webPreferences: {
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
			},
		});

		const finish = (result: SelectedSource | null) => {
			if (settled) return;
			settled = true;
			if (!selectionWindow.isDestroyed()) selectionWindow.close();
			resolve(result);
		};

		selectionWindow.setAlwaysOnTop(true, "screen-saver");
		selectionWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
		selectionWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
		selectionWindow.webContents.on("will-navigate", (event, targetUrl) => {
			if (!targetUrl.startsWith("recordly-region://")) return;
			event.preventDefault();
			const url = new URL(targetUrl);
			if (url.hostname === "cancel") {
				finish(null);
				return;
			}
			if (url.hostname !== "confirm") return;

			const rawRegion = {
				x: Number(url.searchParams.get("x")),
				y: Number(url.searchParams.get("y")),
				width: Number(url.searchParams.get("width")),
				height: Number(url.searchParams.get("height")),
			};
			if (!Object.values(rawRegion).every(Number.isFinite)) return;
			const region = normalizeCaptureRegion(rawRegion, display.bounds);
			const pixels = toPixelCaptureRegion(region, display.bounds, display.scaleFactor);
			if (pixels.width < MIN_USER_CAPTURE_SIZE || pixels.height < MIN_USER_CAPTURE_SIZE)
				return;

			const captureRegion: CaptureRegion = {
				...region,
				displayBounds: { ...display.bounds },
				scaleFactor: pixels.scaleFactor,
				pixelX: pixels.x,
				pixelY: pixels.y,
				pixelWidth: pixels.width,
				pixelHeight: pixels.height,
			};
			finish({
				id: `screen:region:${display.id}`,
				name: `Area ${pixels.width} × ${pixels.height}`,
				display_id: String(display.id),
				sourceType: "region",
				captureRegion,
			});
		});
		selectionWindow.once("closed", () => finish(null));
		selectionWindow
			.loadURL(
				`data:text/html;charset=utf-8,${encodeURIComponent(buildSelectionHtml(display, initialRegion))}`,
			)
			.then(() => {
				if (!selectionWindow.isDestroyed()) {
					selectionWindow.show();
					selectionWindow.focus();
				}
			})
			.catch((error) => {
				console.error("Failed to open capture region selector:", error);
				finish(null);
			});
	});
}

export function selectCaptureRegion() {
	if (!activeRegionSelection) {
		activeRegionSelection = runRegionSelection().finally(() => {
			activeRegionSelection = null;
		});
	}
	return activeRegionSelection;
}
