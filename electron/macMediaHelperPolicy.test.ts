import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { prepareElectronDevRuntime } from "../scripts/electronDevRuntime";

it.skipIf(process.platform !== "darwin")(
	"keeps macOS media helpers out of the Dock while camera and microphone still work",
	() => {
		const directory = mkdtempSync(path.join(tmpdir(), "recordly-media-policy-"));
		try {
			const require = createRequire(import.meta.url);
			const electron = require("electron") as string;
			prepareElectronDevRuntime(process.cwd());
			writeFileSync(
				path.join(directory, "index.html"),
				"<!doctype html><title>Local media test</title>",
			);
			const script = path.join(directory, "main.cjs");
			writeFileSync(
				script,
				`
const {app, BrowserWindow, session} = require('electron');
const {execFileSync} = require('node:child_process');
const path = require('node:path');
app.setPath('userData', path.join(__dirname, 'profile'));
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('disable-features', 'AudioServiceOutOfProcess,MacCatapLoopbackAudioForScreenShare');
setTimeout(() => app.exit(2), 15000);
app.whenReady().then(async () => {
 try {
  await app.dock.show();
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'media'));
  const win = new BrowserWindow({show: false, webPreferences: {sandbox: true}});
  await win.loadFile(path.join(__dirname, 'index.html'));
  const media = await win.webContents.executeJavaScript(
   \`(async () => {
    await navigator.mediaDevices.enumerateDevices();
    const stream = await navigator.mediaDevices.getUserMedia({audio: true, video: true});
    const video = document.createElement('video');
    video.muted = true; video.srcObject = stream; await video.play();
    const result = {video: stream.getVideoTracks().length, audio: stream.getAudioTracks().length, width: video.videoWidth};
    stream.getTracks().forEach(track => track.stop());
    return result;
   })()\`);
  await new Promise(resolve => setTimeout(resolve, 500));
  const applications = execFileSync('lsappinfo', ['list'], {encoding: 'utf8'}).split(/(?=^\\d+\\))/m);
  const metrics = app.getAppMetrics();
  const helpers = metrics.filter(metric => metric.type === 'Utility').map(metric => ({
   name: metric.name,
   foreground: applications.some(entry => entry.includes('pid = ' + metric.pid + ' ') && entry.includes('type="Foreground"'))
  }));
  console.log('RESULT:' + JSON.stringify({media, dockVisible: app.dock.isVisible(), helpers}));
  win.destroy(); app.exit(0);
 } catch (error) { console.error(error); app.exit(1); }
});
`,
			);
			const result = spawnSync(electron, [script], { encoding: "utf8", timeout: 20_000 });
			expect(result.status, result.stderr).toBe(0);
			const line = result.stdout.split("\n").find((value) => value.startsWith("RESULT:"));
			expect(line).toBeDefined();
			const observed = JSON.parse(line!.slice("RESULT:".length));
			expect(observed.dockVisible).toBe(true);
			expect(observed.media.audio).toBe(1);
			expect(observed.media.video).toBe(1);
			expect(observed.media.width).toBeGreaterThan(0);
			expect(
				observed.helpers.some(
					(helper: { name: string }) => helper.name === "Video Capture",
				),
			).toBe(true);
			expect(
				observed.helpers.every((helper: { foreground: boolean }) => !helper.foreground),
			).toBe(true);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	},
	25_000,
);
