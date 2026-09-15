#!/usr/bin/env node
// Proves the Wayland-only HUD gates leave X11 behavior identical to main:
// the HUD is created at the compact 160 DIP fallback height and the "−"
// control still decides minimize() (not hide()).
//
// Runs the real Electron binary under Xvfb with an X11 session env and
// exercises the real modules (hudOverlaySession, hudOverlayBounds,
// hudOverlayWindowActions) plus a real frameless BrowserWindow.
//
// Usage:
//   node scripts/smoke-hud-x11.mjs        (or: npm run smoke:hud-x11)
//
// Requires xvfb-run on PATH (Debian/Ubuntu: sudo apt install xvfb).
// Nothing is installed globally by this script.
//
// The same file plays two roles: as the node launcher it bundles itself
// (CJS, electron external) and spawns Electron under Xvfb; as the Electron
// entry it runs the assertions below. Kept CJS-safe on purpose: no
// import.meta and no top-level await.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const XDG_SESSION_TYPE = "x11";
const XVFB_SERVER_ARGS = "-screen 0 1920x1080x24";

function log(message) {
	process.stdout.write(`SMOKE hud-x11: ${message}\n`);
}

function fail(message) {
	process.stderr.write(`ERROR hud-x11: ${message}\n`);
	process.exit(1);
}

if (process.versions.electron) {
	// Inside the Electron main process (bundled by esbuild): run assertions
	// against the real modules and a real BrowserWindow under X11.
	const { app, BrowserWindow, screen } = require("electron");
	const { isWaylandSession } = require("../electron/hudOverlaySession");
	const {
		getHudOverlayStaticBounds,
		getHudOverlayWindowBounds,
		shouldExpandHudOverlayFallback,
	} = require("../electron/hudOverlayBounds");
	const { hideHudOverlayWindow } = require("../electron/hudOverlayWindowActions");

	function assert(condition, message) {
		if (!condition) {
			throw new Error(`assertion failed: ${message}`);
		}
		log(`ok — ${message}`);
	}

	async function run() {
		await app.whenReady();

		assert(
			isWaylandSession() === false,
			"session env is X11 (XDG_SESSION_TYPE=x11, no WAYLAND_DISPLAY)",
		);
		assert(
			isWaylandSession({ WAYLAND_DISPLAY: "wayland-0" }) === true,
			"detector still flags Wayland when WAYLAND_DISPLAY is set (gate is live, not hardcoded false)",
		);

		const { workArea } = screen.getPrimaryDisplay();
		assert(
			workArea.width >= 860 && workArea.height >= 540,
			`Xvfb work area is large enough for the HUD fallback (${workArea.width}x${workArea.height})`,
		);

		// Creation bounds X11 actually takes: the static entry with the live
		// session flag must equal main's compact creation fallback.
		const staticBounds = getHudOverlayStaticBounds(workArea, false, isWaylandSession());
		const dynamicCreation = getHudOverlayWindowBounds(
			workArea,
			false,
			shouldExpandHudOverlayFallback({
				fallbackExpanded: false,
				recordingActive: false,
				webcamPreviewVisible: false,
			}),
		);
		assert(
			staticBounds.height === 160,
			`static bounds stay compact on X11 (height ${staticBounds.height})`,
		);
		assert(
			JSON.stringify(staticBounds) === JSON.stringify(dynamicCreation),
			"static bounds on X11 equal main's dynamic creation bounds",
		);

		// Real window: X11 honors programmatic bounds, so the compact height
		// must survive a real setBounds/getBounds round-trip.
		const win = new BrowserWindow({
			x: staticBounds.x,
			y: staticBounds.y,
			width: staticBounds.width,
			height: staticBounds.height,
			frame: false,
			show: false,
		});
		try {
			const applied = win.getBounds();
			assert(
				applied.height === 160,
				`real BrowserWindow keeps the compact height (got ${applied.height})`,
			);
			assert(
				applied.width === 860,
				`real BrowserWindow keeps the fallback width (got ${applied.width})`,
			);

			// Hide decision: minimize (main behavior), never hide, on X11.
			// Spied via duck-typing — hideHudOverlayWindow only needs the
			// hide/minimize pair, so the spy sees the real decision without
			// depending on Xvfb having a window manager for iconic state.
			const calls = { hide: 0, minimize: 0 };
			const target = {
				hide: () => {
					calls.hide += 1;
				},
				minimize: () => {
					calls.minimize += 1;
				},
			};
			hideHudOverlayWindow(target, process.platform, isWaylandSession());
			assert(
				calls.minimize === 1 && calls.hide === 0,
				`hide control decides minimize() on X11 (hide=${calls.hide}, minimize=${calls.minimize})`,
			);
		} finally {
			win.destroy();
		}

		log("X11 HUD smoke passed");
		app.exit(0);
	}

	run().catch((error) => {
		process.stderr.write(`ERROR hud-x11: ${error?.stack ?? error}\n`);
		app.exit(1);
	});
} else {
	main().catch((error) => fail(error?.stack ?? String(error)));
}

// Launcher (plain node): bundle this script with the real TS modules and
// spawn it under Xvfb with an X11 session environment.
async function main() {
	const scriptPath = path.resolve(process.argv[1]);
	const repoRoot = path.resolve(scriptPath, "..", "..");

	const xvfbCheck = spawnSync("xvfb-run", ["--version"], { encoding: "utf8" });
	if (xvfbCheck.error || xvfbCheck.status !== 0) {
		fail(
			"xvfb-run not found on PATH — install it first (Debian/Ubuntu: sudo apt install xvfb)",
		);
	}

	const esbuild = await import("esbuild");
	const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "recordly-hud-x11-"));
	const outFile = path.join(outDir, "smoke-hud-x11.cjs");
	await esbuild.build({
		entryPoints: [scriptPath],
		outfile: outFile,
		bundle: true,
		platform: "node",
		format: "cjs",
		target: "node20",
		external: ["electron", "esbuild"],
		logLevel: "silent",
	});

	const electronBin = path.join(repoRoot, "node_modules", ".bin", "electron");
	if (!fs.existsSync(electronBin)) {
		fail(`electron binary not found at ${electronBin}`);
	}

	const childEnv = { ...process.env };
	childEnv.XDG_SESSION_TYPE = XDG_SESSION_TYPE;
	delete childEnv.WAYLAND_DISPLAY;
	childEnv.ELECTRON_DISABLE_SECURITY_WARNINGS = "1";

	const result = spawnSync("xvfb-run", ["-a", "-s", XVFB_SERVER_ARGS, electronBin, outFile], {
		env: childEnv,
		encoding: "utf8",
		timeout: 120_000,
	});
	fs.rmSync(outDir, { recursive: true, force: true });

	const lines = `${result.stdout ?? ""}${result.stderr ?? ""}`.split("\n");
	for (const line of lines) {
		if (/^(SMOKE|ERROR) hud-x11:/.test(line)) {
			process.stdout.write(`${line}\n`);
		}
	}

	if (result.status === 0) {
		return;
	}
	const tail = lines
		.filter((line) => line.trim().length > 0)
		.slice(-10)
		.join("\n");
	fail(`smoke exited with status ${result.status ?? `signal ${result.signal}`}\n${tail}`);
}
