// Drives recordly-agent-input.exe against Notepad on a Windows desktop: preflight, window lookup,
// raise, find, real input, takeover detection and held-input release on exit.
// Usage: node scripts/smoke-agent-input-windows.mjs [path/to/recordly-agent-input.exe]
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

const TAG = "[smoke-agent-input-windows]";

if (process.platform !== "win32") {
	console.log(`${TAG} Skipping: host platform is not Windows.`);
	process.exit(0);
}

const exePath =
	process.argv[2] ??
	path.join(
		process.cwd(),
		"electron",
		"native",
		"bin",
		process.arch === "arm64" ? "win32-arm64" : "win32-x64",
		"recordly-agent-input.exe",
	);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function check(condition, message) {
	if (!condition) throw new Error(`check failed: ${message}`);
	console.log(`${TAG} ok: ${message}`);
}

function powershell(script) {
	return execFileSync(
		"powershell.exe",
		[
			"-NoProfile",
			"-NonInteractive",
			"-EncodedCommand",
			Buffer.from(script, "utf16le").toString("base64"),
		],
		{ encoding: "utf8", timeout: 60_000 },
	).trim();
}

// Untagged injected input, as another automation tool would send it: it must count as the user.
const USER32 =
	"Add-Type -Name U -Namespace R -MemberDefinition '" +
	'[DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, UIntPtr e);' +
	'[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint f, UIntPtr e);' +
	"'";
const injectUserMove = () =>
	powershell(`${USER32}; [R.U]::mouse_event(1, 60, 0, 0, [UIntPtr]::Zero)`);
const injectUserEscape = () =>
	powershell(
		`${USER32}; [R.U]::keybd_event(0x1B, 0, 0, [UIntPtr]::Zero); [R.U]::keybd_event(0x1B, 0, 2, [UIntPtr]::Zero)`,
	);
const inputState = () =>
	powershell(
		"Add-Type -AssemblyName System.Windows.Forms; " +
			'"$([System.Windows.Forms.Control]::MouseButtons)|$([System.Windows.Forms.Control]::ModifierKeys)"',
	);

function startHelper() {
	const child = spawn(exePath, [], { stdio: ["pipe", "pipe", "inherit"], windowsHide: true });
	const pending = new Map();
	const lines = [];
	let nextId = 0;
	createInterface({ input: child.stdout }).on("line", (line) => {
		const message = JSON.parse(line);
		lines.push(message);
		if (message.event) return;
		const entry = pending.get(message.id);
		if (!entry) return;
		pending.delete(message.id);
		if (message.ok) entry.resolve(message);
		else entry.reject(new Error(message.error));
	});
	const exited = new Promise((resolve) =>
		child.on("exit", (code) => {
			for (const entry of pending.values()) entry.reject(new Error("helper exited"));
			pending.clear();
			resolve(code);
		}),
	);
	function request(command, timeoutMs = 30_000) {
		const id = ++nextId;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error(`${command.cmd} timed out`)),
				timeoutMs,
			);
			pending.set(id, {
				resolve: (value) => {
					clearTimeout(timer);
					resolve(value);
				},
				reject: (error) => {
					clearTimeout(timer);
					reject(error);
				},
			});
			child.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
		});
	}
	return { child, request, lines, exited };
}

async function rejection(promise) {
	try {
		await promise;
	} catch (error) {
		return error.message;
	}
	return null;
}

async function waitForWindow(processName, titlePattern = "*") {
	for (let attempt = 0; attempt < 40; attempt++) {
		const found = powershell(
			`Get-Process ${processName} -ErrorAction SilentlyContinue | ` +
				`Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like '${titlePattern}' } | ` +
				'Select-Object -First 1 | ForEach-Object { "$($_.Id) $($_.MainWindowHandle.ToInt64())" }',
		);
		if (found) {
			const [pid, windowId] = found.split(" ").map(Number);
			return { pid, windowId };
		}
		await sleep(500);
	}
	throw new Error(`no ${processName} window appeared`);
}

const center = (frame) => ({
	x: Math.round(frame.x + frame.width / 2),
	y: Math.round(frame.y + frame.height / 2),
});

async function takeover(request, lines, inject, expect) {
	await request({ cmd: "arm" });
	const target = await request({ cmd: "cursor" });
	const moving = rejection(
		request({ cmd: "move", x: target.x + 300, y: target.y + 200, ms: 20_000 }, 40_000),
	);
	await sleep(500);
	inject();
	const error = await moving;
	check(error === "user-input", `${expect.label} aborts the running action`);
	const replyIndex = lines.findLastIndex(
		(line) => line.ok === false && line.error === "user-input",
	);
	const eventIndex = lines.findLastIndex(
		(line) =>
			line.event === "user-input" &&
			line.kind === expect.kind &&
			line.escape === expect.escape,
	);
	check(
		eventIndex >= 0 && eventIndex < replyIndex,
		`${expect.label} is reported before the aborted reply`,
	);
	await request({ cmd: "disarm" });
}

async function probeChromium(request) {
	const edge = ["ProgramFiles(x86)", "ProgramFiles"]
		.map(
			(name) =>
				process.env[name] &&
				path.join(process.env[name], "Microsoft", "Edge", "Application", "msedge.exe"),
		)
		.find((candidate) => candidate && existsSync(candidate));
	if (!edge) return console.log(`${TAG} chromium probe skipped: Edge not installed`);
	const page = `data:text/html,${encodeURIComponent(
		"<title>Recordly Probe</title><button>Recordly Probe Button</button>" +
			'<div style="height:120px;overflow:auto"><div style="height:3000px"></div><button>Recordly Hidden Button</button></div>',
	)}`;
	const profile = mkdtempSync(path.join(os.tmpdir(), "recordly-edge-"));
	spawn(
		edge,
		[
			`--user-data-dir=${profile}`,
			"--no-first-run",
			"--no-default-browser-check",
			"--new-window",
			page,
		],
		{
			detached: true,
			stdio: "ignore",
		},
	).unref();
	// Chromium's UIA behaviour is what this probes, so a miss is a warning, not a failure.
	try {
		const browser = await waitForWindow("msedge", "*Recordly Probe*");
		const { window } = await request({ cmd: "window_info", windowId: browser.windowId });
		const target = {
			pid: window.pid,
			windowId: window.windowId,
			frame: window.frame,
			limit: 5,
		};
		const started = Date.now();
		const shown = (await request({ cmd: "find", ...target, text: "Recordly Probe Button" }))
			.elements;
		const hidden = (
			await request({
				cmd: "find",
				...target,
				text: "Recordly Hidden Button",
				offscreen: true,
			})
		).elements;
		const without = (await request({ cmd: "find", ...target, text: "Recordly Hidden Button" }))
			.elements;
		console.log(
			`${TAG} chromium probe (${Date.now() - started} ms): ${JSON.stringify({ shown, hidden, without })}`,
		);
		const passed =
			shown[0]?.web === true &&
			shown[0].visible !== false &&
			hidden[0]?.web === true &&
			hidden[0].visible === false &&
			hidden[0].container?.height > 0 &&
			without.length === 0;
		console.log(
			passed
				? `${TAG} ok: chromium web, visible and container fields`
				: "::warning::chromium probe failed",
		);
	} catch (error) {
		console.log(`::warning::chromium probe failed: ${error.message}`);
	} finally {
		spawnSyncQuiet("taskkill", ["/F", "/T", "/IM", "msedge.exe"]);
	}
}

function spawnSyncQuiet(command, args) {
	try {
		execFileSync(command, args, { stdio: "ignore" });
	} catch {
		// already gone
	}
}

async function main() {
	check(existsSync(exePath), `helper exists at ${exePath}`);
	const { child, request, lines, exited } = startHelper();

	const preflight = await request({ cmd: "preflight" });
	check(
		preflight.postEvents && preflight.accessibility,
		"preflight reports input and UI Automation access",
	);
	const cursor = await request({ cmd: "cursor" });
	check(Number.isFinite(cursor.x) && Number.isFinite(cursor.y), "cursor returns a position");
	check(
		(await rejection(request({ cmd: "nope" }))) === "unknown command: nope",
		"unknown commands fail",
	);
	check(
		(await rejection(request({ cmd: "key", key: "notakey" })))?.startsWith("unknown key"),
		"unknown keys fail",
	);
	check(
		(await request({ cmd: "window_info", windowId: 1 })).window === null,
		"window_info returns null for a bad HWND",
	);

	spawn("notepad.exe", [], { detached: true, stdio: "ignore" }).unref();
	const notepad = await waitForWindow("notepad");
	try {
		const { window } = await request({ cmd: "window_info", windowId: notepad.windowId });
		check(
			window?.pid === notepad.pid && window.frame.width > 0 && window.visible === true,
			"window_info describes Notepad",
		);

		const { raised } = await request({
			cmd: "raise",
			pid: notepad.pid,
			windowId: notepad.windowId,
			frame: window.frame,
		});
		const front = (await request({ cmd: "frontmost_window" })).window;
		check(
			raised && front?.pid === notepad.pid && front.windowId === notepad.windowId,
			"raise brings Notepad to the front",
		);

		const target = { pid: notepad.pid, windowId: notepad.windowId, frame: window.frame };
		const menus = (await request({ cmd: "find", ...target, text: "File", limit: 10 })).elements;
		check(
			menus.length > 0 && menus.every((each) => each.visible !== false && !each.web),
			`find by text returns ${JSON.stringify(menus[0])}`,
		);
		const probe = await request({ cmd: "at", pid: notepad.pid, ...center(menus[0]) });
		const sameBox = (a, b) =>
			["x", "y", "width", "height"].every((key) => Math.abs(a[key] - b[key]) <= 1);
		check(
			probe.hit?.role === menus[0].role &&
				probe.hit.label === menus[0].label &&
				sameBox(probe.hit, menus[0]),
			`at returns the menu item find reported: ${JSON.stringify(probe.hit)}`,
		);
		check(
			probe.parent !== null && typeof probe.parent.role === "string",
			`at returns the parent ${JSON.stringify(probe.parent)}`,
		);
		const nowhere = await request({ cmd: "at", pid: notepad.pid, x: -30000, y: -30000 });
		check(
			nowhere.hit === null && nowhere.parent === null,
			"at returns nulls for a point over nothing",
		);
		// Same code path as a point that has drifted onto another app's window.
		const foreign = await request({ cmd: "at", pid: process.pid, ...center(menus[0]) });
		check(
			foreign.hit === null && foreign.parent === null,
			"at returns nulls when the point belongs to another process",
		);

		let editor;
		for (const role of ["edit", "document"]) {
			editor ??= (await request({ cmd: "find", ...target, role, limit: 5 })).elements[0];
		}
		check(editor, `find by role returns the editor ${JSON.stringify(editor)}`);

		powershell("Set-Clipboard -Value 'clipboard-before'");
		const typed = "Recordly smoke 42";
		const field = center(editor);
		await request({ cmd: "arm" });
		await request({ cmd: "move", ...field, ms: 300 });
		await request({ cmd: "click", ...field, ms: 0, button: "left", count: 1, modifiers: [] });
		await request({ cmd: "type", text: typed, cps: 40 });
		await request({ cmd: "key", key: "a", modifiers: ["ctrl"], repeat: 1 });
		await request({ cmd: "key", key: "c", modifiers: ["ctrl"], repeat: 1 });
		await sleep(300);
		check(
			powershell("Get-Clipboard -Raw") === typed,
			"typed text reaches Notepad (read back via ctrl+a, ctrl+c)",
		);
		const typedMatches = (await request({ cmd: "find", ...target, text: typed, limit: 5 }))
			.elements;
		console.log(
			`${TAG} UI Automation sees the typed text in ${typedMatches.length} element(s)`,
		);
		await request({ cmd: "key", key: "end", modifiers: ["ctrl"], repeat: 1 });
		await request({ cmd: "type", text: "\n".repeat(60), cps: 200 });
		await request({ cmd: "scroll", ...field, ms: 300, dx: 0, dy: -400, modifiers: [] });
		await request({ cmd: "scroll", ...field, ms: 300, dx: 40, dy: 200, modifiers: [] });
		console.log(`${TAG} ok: move, click, type, key and scroll complete`);
		await request({ cmd: "disarm" });

		await takeover(request, lines, injectUserMove, {
			label: "an untagged mouse move",
			kind: "move",
			escape: false,
		});
		await takeover(request, lines, injectUserEscape, {
			label: "an untagged Esc",
			kind: "key",
			escape: true,
		});

		await probeChromium(request);

		await request({ cmd: "raise", ...target });
		await request({ cmd: "arm" });
		const dragging = rejection(
			request({
				cmd: "drag",
				fromX: field.x,
				fromY: field.y,
				toX: field.x + 120,
				toY: field.y,
				ms: 20_000,
				button: "left",
				modifiers: ["shift"],
			}),
		);
		await sleep(1500);
		check(inputState() === "Left|Shift", "drag holds the left button and Shift");
		child.stdin.end();
		check((await exited) === 0, "helper exits cleanly when stdin closes");
		check(inputState() === "None|None", "exit releases the held button and Shift");
		await dragging;
	} finally {
		spawnSyncQuiet("taskkill", ["/F", "/PID", String(notepad.pid)]);
		child.kill();
	}
	console.log(`${TAG} passed`);
}

main().catch((error) => {
	console.error(`${TAG} ${error.stack ?? error.message}`);
	process.exit(1);
});
