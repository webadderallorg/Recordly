import { createMcpHandler } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./remoteControl", () => ({ MAX_COUNTDOWN_SECONDS: 10 }));

import type { AgentControl } from "./agentControl";
import type { OpenFileTools } from "./openFile";
import type { RemoteControl } from "./remoteControl";
import type { RemoteEditor } from "./remoteEditor";
import type { RemoteExport } from "./remoteExport";
import type { RemoteRecordings } from "./remoteRecordings";
import type { RemoteReview } from "./reviewRecording";
import { buildRecordlyMcpServer, type CaptureControls } from "./tools";

function setup(
	state = "idle",
	{
		controlEnabled = true,
		platform = "darwin",
		wayland = false,
		sourceId = "window:421:0",
	}: {
		controlEnabled?: boolean;
		platform?: NodeJS.Platform;
		wayland?: boolean;
		sourceId?: string;
	} = {},
) {
	const remote = {
		getStatus: () => ({
			state,
			lastRecordingPath: "/rec/recording-1.mp4",
			selectedSource: { id: sourceId, name: "Numbers" },
		}),
		selectSource: vi.fn(async ({ id }: { id?: string }) => ({ id, type: "screen" })),
		startRecording: vi.fn(async () => {
			throw new Error("No capture source is selected.");
		}),
	} as unknown as RemoteControl;
	const remoteExport = {
		getStatus: () => ({ state: "idle", progress: null, outputPath: null, error: null }),
		exportVideo: vi.fn(async (_args, opts?: { onProgress?: (pct: number) => void }) => {
			opts?.onProgress?.(50);
			return { status: "done" as const, path: "/out/demo.mp4" };
		}),
	} as unknown as RemoteExport;
	const agent = {
		perform: vi.fn(async (steps: unknown[]) => ({ performed: steps.length })),
		openUrl: vi.fn(async (url: string) => ({ url, source: { id: "window:9:0" } })),
		screenshot: vi.fn(async () => ({
			data: "aGk=",
			mimeType: "image/jpeg",
			width: 1568,
			height: 980,
			scale: 0.5,
			originX: 0,
			originY: 0,
		})),
		findElements: vi.fn(async () => ({ elements: [], truncated: false })),
		chooseWindow: vi.fn(async (id: string) => ({ id, type: "window", control: true })),
		setWindowBounds: vi.fn(async (args: { width: number; height: number }) => ({
			windowId: 421,
			frame: { x: 0, y: 0, width: args.width, height: args.height },
			adjusted: false,
		})),
		undoLastInput: vi.fn(async () => ({ sent: "Cmd+Z", app: "Numbers", note: "best effort" })),
		setInputPolicy: vi.fn((policy: unknown) => policy),
	} as unknown as AgentControl & Record<string, ReturnType<typeof vi.fn>>;
	const review = {
		reviewRecording: vi.fn(async () => ({
			image: { data: "aGk=", mimeType: "image/jpeg" as const, width: 900, height: 600 },
			summary: {
				videoPath: "/rec/recording-1.mp4",
				rawDurationMs: 76_000,
				finalDurationMs: 52_000,
			},
		})),
	} as unknown as RemoteReview & Record<string, ReturnType<typeof vi.fn>>;
	const editor = {
		requestEditor: vi.fn(async (op: string) => ({ op })),
		requestLong: vi.fn(async (op: string) => ({ status: "done", data: { op } })),
		runningOp: vi.fn(() => null),
		sampleFrames: vi.fn(async () => ({
			image: { data: "aGk=", mimeType: "image/jpeg" as const, width: 900, height: 600 },
			cols: 3,
			rows: 2,
			source: "edited" as const,
			frames: [{ atMs: 0, sourceMs: 0 }],
		})),
		getState: vi.fn(async () => ({
			videoPath: "/rec/recording-1.mp4",
			durationMs: 52_000,
			sourceDurationMs: 76_000,
			clips: [],
			zooms: [],
			annotations: [],
			audio: [],
			captions: [],
		})),
		getFrame: vi.fn(async ({ atMs }: { atMs: number }) => ({
			dataUrl: "data:image/png;base64,aGk=",
			atMs,
			source: "edited" as const,
			sourceMs: atMs + 1_000,
		})),
	} as unknown as RemoteEditor & Record<string, ReturnType<typeof vi.fn>>;
	const recordings = {
		recoverRecording: vi.fn(async (path: string) => ({ path, telemetrySaved: false })),
		listRecordings: vi.fn(async () => ({ recordings: [] })),
		deleteRecording: vi.fn(async (path: string) => ({ path, removed: true })),
		restoreRecording: vi.fn(async (path: string) => ({ path, removed: false })),
	} as unknown as RemoteRecordings & Record<string, ReturnType<typeof vi.fn>>;
	const files = {
		openFile: vi.fn(async ({ path }: { path: string }) => ({ path })),
		waitForDownload: vi.fn(async ({ glob }: { glob: string }) => ({
			path: glob.replace("*", "book"),
			sizeBytes: 12,
		})),
	} as unknown as OpenFileTools & Record<string, ReturnType<typeof vi.fn>>;
	const capture = {
		setOverlay: vi.fn(async () => ({ windowOpen: true, hidden: false })),
		waitUntilQuiet: vi.fn(async () => ({ quiet: true, waitedMs: 1_200 })),
		setDoNotDisturb: vi.fn(async (enabled: boolean) => ({
			ok: true,
			enabled,
			message: "Done.",
		})),
		setHideCursor: vi.fn(),
		rememberScenes: vi.fn(),
		getHideCursor: vi.fn(() => false),
	} as unknown as CaptureControls & Record<string, ReturnType<typeof vi.fn>>;
	const handler = createMcpHandler(() =>
		buildRecordlyMcpServer(remote, remoteExport, "1.0.0", {
			agent,
			isControlEnabled: () => controlEnabled,
			platform,
			support: wayland ? { supported: false, reason: "Needs X11." } : { supported: true },
			review,
			editor,
			recordings,
			files,
			capture,
		}),
	);

	async function call(method: string, params?: Record<string, unknown>) {
		const response = await handler.fetch(
			new Request("http://127.0.0.1/mcp", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					accept: "application/json, text/event-stream",
					"mcp-protocol-version": "2025-11-25",
				},
				body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
			}),
		);
		const text = await response.text();
		const messages = response.headers.get("content-type")?.includes("text/event-stream")
			? text
					.split("\n")
					.filter((line) => line.startsWith("data:"))
					.map((line) => JSON.parse(line.slice("data:".length)))
			: [JSON.parse(text)];
		return { result: messages.at(-1).result, messages };
	}

	return { remote, remoteExport, agent, review, editor, recordings, files, capture, call };
}

function collectSchemaWords(node: unknown, into: Set<string>) {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (const item of node) collectSchemaWords(item, into);
		return;
	}
	for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
		if (key === "properties" && value && typeof value === "object") {
			for (const name of Object.keys(value as Record<string, unknown>)) into.add(name);
		}
		if (key === "enum" && Array.isArray(value)) {
			for (const option of value) if (typeof option === "string") into.add(option);
		}
		collectSchemaWords(value, into);
	}
}

const PROTOCOL_INSTRUCTIONS = [
	"Never record a flow you have not already run",
	"Plan, rehearse, take:",
	"dryRun: true (one page only)",
	"cancel_recording, re-plan, rehearse, re-take",
	"Never retry blindly or patch a ruined take",
];

const PROTOCOL_PROMPT = [
	"Never record a flow you have not already run end to end",
	"Do not call start_recording until the rehearsal has passed",
	"PHASE 1 - PLAN",
	"PHASE 2 - REHEARSE",
	"PHASE 3 - TAKE",
	"4b. Pre-mortem",
	"Use index only when no combination of role and text is unique",
	"SELF-CHECK",
	"Any no means do not record.",
	"start_recording with scenes set to the rehearsed scene list",
	"find_elements",
	"origin + pixel x scale",
	"dryRun probes only the page you are on",
	"candidates > 1 means ambiguous, not missing",
	"cancel_recording and take it again",
	"Never call start_recording before a clean rehearsal of the whole flow",
	"Never export a take you have not checked with review_recording",
];

const PERMISSIVE_WORDING = [
	"Check the first scene",
	"screenshot and continue",
	"or once for a whole flow",
];

const REPLACE_ANCHORS = [
	"On macOS it drives the recorded window",
	"Coordinates are window-relative points; (0,0) is the window's top-left.",
	"or list_sources → select_source for an app. Keep the window landscape (at least 1.2 × as wide " +
		"as tall) so zooms work, and uncovered. Two apps in one take: select a screen, then " +
		"select_source with a window id picks the window you drive, switchable mid-take.",
	"\n\nErrors:",
];

const INITIALIZE = {
	protocolVersion: "2025-11-25",
	capabilities: {},
	clientInfo: { name: "test", version: "1" },
};

describe("buildRecordlyMcpServer", () => {
	it("exposes the full recording and export tool set", async () => {
		const { call } = setup();
		const { result } = await call("tools/list");
		expect(result.tools.map((tool: { name: string }) => tool.name).sort()).toEqual([
			"add_card",
			"annotate",
			"arm_recording",
			"cancel_recording",
			"check_edits",
			"click",
			"delete_recording",
			"drag",
			"edit_audio",
			"edit_captions",
			"edit_project",
			"edit_timeline",
			"edit_zoom",
			"export_video",
			"find_elements",
			"get_editor_state",
			"get_frame",
			"get_status",
			"history",
			"list_recordings",
			"list_sources",
			"move_pointer",
			"open_editor",
			"open_file",
			"open_url",
			"pause_recording",
			"perform",
			"polish_recording",
			"press_key",
			"recover_recording",
			"render_preview",
			"restore_recording",
			"resume_recording",
			"review_recording",
			"sample_frames",
			"screenshot",
			"scroll",
			"select_source",
			"set_cursor",
			"set_do_not_disturb",
			"set_input_policy",
			"set_look",
			"set_overlay",
			"set_window_bounds",
			"start_recording",
			"stop_recording",
			"thumbnail",
			"type_text",
			"undo_last_input",
			"verify_export",
			"wait_for",
			"wait_for_download",
		]);
	});

	it("returns the contact sheet and summary from review_recording", async () => {
		const { call, review } = setup();
		const { result } = await call("tools/call", { name: "review_recording", arguments: {} });
		expect(result.isError).toBeFalsy();
		expect(result.content[0]).toMatchObject({
			type: "image",
			mimeType: "image/jpeg",
			data: "aGk=",
		});
		expect(JSON.parse(result.content[1].text)).toMatchObject({ finalDurationMs: 52_000 });
		expect(review.reviewRecording).toHaveBeenCalledWith({ signal: expect.anything() });
	});

	it("returns one frame as an image, with the source time it came from", async () => {
		const { call, editor } = setup();
		const { result } = await call("tools/call", {
			name: "get_frame",
			arguments: { atMs: 48_000 },
		});
		expect(result.isError).toBeFalsy();
		expect(result.content[0]).toMatchObject({
			type: "image",
			mimeType: "image/png",
			data: "aGk=",
		});
		expect(JSON.parse(result.content[1].text)).toMatchObject({
			atMs: 48_000,
			source: "edited",
			sourceMs: 49_000,
		});
		expect(editor.getFrame).toHaveBeenCalledWith(
			{ atMs: 48_000 },
			{ signal: expect.anything() },
		);
	});

	it("reports what the editor is about to export", async () => {
		const { call } = setup();
		const { result } = await call("tools/call", { name: "get_editor_state", arguments: {} });
		expect(result.isError).toBeFalsy();
		expect(JSON.parse(result.content[0].text)).toMatchObject({
			videoPath: "/rec/recording-1.mp4",
			durationMs: 52_000,
			sourceDurationMs: 76_000,
		});
	});

	it("remembers the rehearsed scene list so the scenes get their names", async () => {
		const { call, capture, remote } = setup();
		const scenes = ["Open payroll", "Review and pay"];
		await call("tools/call", { name: "start_recording", arguments: { scenes } });
		expect(capture.rememberScenes).toHaveBeenCalledWith(scenes);
		expect(remote.startRecording).toHaveBeenCalled();
		const bare = setup();
		await bare.call("tools/call", { name: "start_recording", arguments: {} });
		expect(bare.capture.rememberScenes).not.toHaveBeenCalled();
	});

	it("routes every editing tool to its editor op", async () => {
		const { call, editor } = setup();
		const cases: [string, Record<string, unknown>, string][] = [
			["annotate", { op: "add", kind: "blur", startMs: 0, endMs: 1 }, "annotate.add"],
			["history", { op: "undo" }, "history.undo"],
			["edit_timeline", { op: "split", timeMs: 500 }, "timeline.split"],
			["edit_zoom", { op: "clear" }, "zoom.clear"],
			["set_look", { op: "set", fields: { padding: 10 } }, "look.set"],
			["edit_captions", { op: "generate", from: "scenes" }, "captions.generate"],
			["edit_audio", { op: "mute_source", muted: true }, "audio.mute_source"],
		];
		for (const [name, args, op] of cases) {
			const { result } = await call("tools/call", { name, arguments: args });
			expect(result.isError, `${name} errored`).toBeFalsy();
			expect(editor.requestEditor).toHaveBeenCalledWith(op, expect.anything(), {
				signal: expect.anything(),
			});
		}
		expect(editor.requestEditor).toHaveBeenCalledTimes(cases.length);
	});

	it("tells an agent a long join is still running instead of reporting a failure", async () => {
		const { call, editor } = setup();
		editor.requestLong.mockResolvedValueOnce({
			status: "still-running",
			op: "timeline.join",
			waitedMs: 61_000,
		});
		const { result } = await call("tools/call", {
			name: "edit_timeline",
			arguments: { op: "join", path: "/videos/second.mp4" },
		});
		expect(result.isError).toBeFalsy();
		const body = JSON.parse(result.content[0].text);
		expect(body.status).toBe("still-running");
		expect(body.note).toMatch(/Do NOT call join again/);
		expect(body.note).toMatch(/twice/);
		expect(editor.requestEditor).not.toHaveBeenCalled();
	});

	it("reports which editor operation is running, so a long one can be polled", async () => {
		const { call, editor } = setup();
		editor.runningOp.mockReturnValueOnce({ op: "timeline.join", forMs: 73_000 });
		const { result } = await call("tools/call", { name: "get_status", arguments: {} });
		expect(JSON.parse(result.content[0].text).editor).toEqual({
			running: { op: "timeline.join", forMs: 73_000 },
		});
	});

	it("sweeps the whole video as a contact sheet", async () => {
		const { call, editor } = setup();
		const { result } = await call("tools/call", {
			name: "sample_frames",
			arguments: { count: 6 },
		});
		expect(result.isError).toBeFalsy();
		expect(result.content[0]).toMatchObject({ type: "image", mimeType: "image/jpeg" });
		expect(JSON.parse(result.content[1].text)).toMatchObject({ cols: 3, rows: 2 });
		expect(editor.sampleFrames).toHaveBeenCalledWith(
			{ count: 6 },
			{ signal: expect.anything() },
		);
	});

	it("refuses to move the window being recorded, but moves another one", async () => {
		const recording = setup("recording");
		const blocked = await recording.call("tools/call", {
			name: "set_window_bounds",
			arguments: { x: 0, y: 0, width: 1600, height: 1000 },
		});
		expect(blocked.result.isError).toBe(true);
		expect(blocked.result.content[0].text).toContain("would wreck the framing");
		expect(recording.agent.setWindowBounds).not.toHaveBeenCalled();

		const sameWindow = await recording.call("tools/call", {
			name: "set_window_bounds",
			arguments: { source: "421", x: 0, y: 0, width: 1600, height: 1000 },
		});
		expect(sameWindow.result.isError).toBe(true);

		const other = await recording.call("tools/call", {
			name: "set_window_bounds",
			arguments: { source: "window:77:0", x: 0, y: 0, width: 1600, height: 1000 },
		});
		expect(other.result.isError).toBeFalsy();

		const idle = setup("idle");
		const allowed = await idle.call("tools/call", {
			name: "set_window_bounds",
			arguments: { x: 0, y: 0, width: 1600, height: 1000 },
		});
		expect(allowed.result.isError).toBeFalsy();
		expect(idle.agent.setWindowBounds).toHaveBeenCalled();
	});

	it("picks the window to drive, not the source, while a whole screen is recorded", async () => {
		const screen = setup("idle", { sourceId: "screen:1:0" });
		const drive = await screen.call("tools/call", {
			name: "select_source",
			arguments: { id: "window:77:0" },
		});
		expect(drive.result.isError).toBeFalsy();
		expect(screen.agent.chooseWindow).toHaveBeenCalledWith("window:77:0");
		expect(screen.remote.selectSource).not.toHaveBeenCalled();

		const otherScreen = await screen.call("tools/call", {
			name: "select_source",
			arguments: { id: "screen:2:0" },
		});
		expect(otherScreen.result.isError).toBeFalsy();
		expect(screen.remote.selectSource).toHaveBeenCalledWith({ id: "screen:2:0" });

		const window = setup("idle", { sourceId: "window:421:0" });
		await window.call("tools/call", {
			name: "select_source",
			arguments: { id: "window:77:0" },
		});
		expect(window.agent.chooseWindow).not.toHaveBeenCalled();
		expect(window.remote.selectSource).toHaveBeenCalledWith({ id: "window:77:0" });
	});

	it("opens a file mid-take while a screen records, but not while a window does", async () => {
		const recording = setup("recording");
		const blocked = await recording.call("tools/call", {
			name: "open_file",
			arguments: { path: "/Users/me/Downloads/book.xlsx", then_select_source: true },
		});
		expect(blocked.result.isError).toBe(true);
		expect(blocked.result.content[0].text).toContain("end the take");
		expect(recording.files.openFile).not.toHaveBeenCalled();

		const onScreen = setup("recording", { sourceId: "screen:1:0" });
		const midTake = await onScreen.call("tools/call", {
			name: "open_file",
			arguments: { path: "/Users/me/Downloads/book.xlsx", then_select_source: true },
		});
		expect(midTake.result.isError).toBeFalsy();
		expect(onScreen.files.openFile).toHaveBeenCalled();

		const idle = setup("idle");
		const allowed = await idle.call("tools/call", {
			name: "open_file",
			arguments: { path: "/Users/me/Downloads/book.xlsx" },
		});
		expect(allowed.result.isError).toBeFalsy();
		expect(idle.files.openFile).toHaveBeenCalled();
	});

	it("returns controller refusals as tool errors the agent can read", async () => {
		const { call } = setup();
		const { result } = await call("tools/call", {
			name: "start_recording",
			arguments: { scenes: ["Open the project list", "Create a project"] },
		});
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("No capture source is selected.");
	});

	it("refuses to record without the rehearsed scene list while control is on", async () => {
		const { call, remote } = setup();
		const { result } = await call("tools/call", { name: "start_recording", arguments: {} });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("scenes");
		expect(result.content[0].text).toContain("Rehearse the flow unrecorded first");
		expect(remote.startRecording).not.toHaveBeenCalled();
		const scenes = ["Open the project list"];
		await call("tools/call", { name: "start_recording", arguments: { scenes } });
		expect(remote.startRecording).toHaveBeenCalledWith({ scenes, hideCursor: false });
		for (const bad of [[], Array.from({ length: 13 }, () => "scene"), [" "]]) {
			const { result: refused } = await call("tools/call", {
				name: "start_recording",
				arguments: { scenes: bad },
			});
			expect(refused.isError).toBe(true);
		}
		expect(remote.startRecording).toHaveBeenCalledTimes(1);
	});

	it("records without a scene list when the mouse and keyboard switch is off", async () => {
		const { call, remote } = setup("idle", { controlEnabled: false });
		const { result } = await call("tools/call", { name: "start_recording", arguments: {} });
		expect(result.content[0].text).toContain("No capture source is selected.");
		expect(remote.startRecording).toHaveBeenCalledWith({ hideCursor: false });
	});

	it("rejects an out-of-range countdown before reaching the controller", async () => {
		const { call, remote } = setup();
		const { result } = await call("tools/call", {
			name: "start_recording",
			arguments: { countdownSeconds: 60 },
		});
		expect(result.isError).toBe(true);
		expect(remote.startRecording).not.toHaveBeenCalled();
	});

	it("exports the last recording and streams progress when asked", async () => {
		const { call, remoteExport } = setup();
		const { result, messages } = await call("tools/call", {
			name: "export_video",
			arguments: { outputPath: "/out/demo.mp4" },
			_meta: { progressToken: "p1" },
		});
		expect(JSON.parse(result.content[0].text)).toEqual({
			status: "done",
			path: "/out/demo.mp4",
		});
		expect(remoteExport.exportVideo).toHaveBeenCalledWith(
			{ outputPath: "/out/demo.mp4", videoPath: "/rec/recording-1.mp4" },
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
		expect(messages).toContainEqual(
			expect.objectContaining({
				method: "notifications/progress",
				params: { progressToken: "p1", progress: 50, total: 100 },
			}),
		);
	});

	it.each([
		"recording",
		"paused",
		"stopping",
	])("refuses to export while the recorder is %s", async (state) => {
		const { call, remoteExport } = setup(state);
		const { result } = await call("tools/call", { name: "export_video", arguments: {} });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("stop_recording");
		expect(remoteExport.exportVideo).not.toHaveBeenCalled();
	});

	it("includes export progress in get_status", async () => {
		const { call } = setup();
		const { result } = await call("tools/call", { name: "get_status", arguments: {} });
		expect(JSON.parse(result.content[0].text)).toMatchObject({
			state: "idle",
			export: { state: "idle" },
		});
	});

	it.each([
		["open_url", { url: "https://example.com" }],
		["click", { x: 1, y: 2 }],
		["drag", { fromX: 1, fromY: 2, toX: 3, toY: 4 }],
		["move_pointer", { x: 1, y: 2 }],
		["scroll", { x: 1, y: 2, deltaY: 100 }],
		["type_text", { text: "hi" }],
		["press_key", { key: "enter" }],
		["perform", { steps: [{ action: "wait", ms: 10 }] }],
	])("refuses %s while the mouse and keyboard switch is off", async (name, args) => {
		const { call, agent } = setup("idle", { controlEnabled: false });
		const { result } = await call("tools/call", { name, arguments: args });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Let agents use the mouse and keyboard");
		expect(agent.perform).not.toHaveBeenCalled();
		expect(agent.openUrl).not.toHaveBeenCalled();
	});

	it("serves screenshot and find_elements with only the main switch", async () => {
		const { call, agent } = setup("idle", { controlEnabled: false });
		const { result } = await call("tools/call", { name: "screenshot", arguments: {} });
		expect(result.content[0]).toEqual({ type: "image", data: "aGk=", mimeType: "image/jpeg" });
		expect(JSON.parse(result.content[1].text)).toMatchObject({
			width: 1568,
			height: 980,
			scale: 0.5,
			hint: expect.stringContaining("scale"),
		});
		const found = await call("tools/call", {
			name: "find_elements",
			arguments: { text: "Save" },
		});
		expect(found.result.isError).toBeFalsy();
		expect(agent.findElements).toHaveBeenCalledWith({ text: "Save" });
	});

	it("keeps the whole-window screenshot output unchanged", async () => {
		const { call, agent } = setup();
		const { result } = await call("tools/call", { name: "screenshot", arguments: {} });
		expect(agent.screenshot).toHaveBeenCalledWith(undefined, undefined);
		expect(JSON.parse(result.content[1].text)).toEqual({
			width: 1568,
			height: 980,
			scale: 0.5,
			hint: "Window point = image pixel × scale. Pass window points to click, drag, move_pointer, scroll and perform.",
		});
	});

	it("zooms into a region and returns its origin", async () => {
		const { call, agent } = setup();
		agent.screenshot.mockResolvedValueOnce({
			data: "aGk=",
			mimeType: "image/jpeg",
			width: 600,
			height: 400,
			scale: 0.5,
			originX: 200,
			originY: 100,
		});
		const region = { x: 200, y: 100, width: 300, height: 200 };
		const { result } = await call("tools/call", { name: "screenshot", arguments: { region } });
		expect(agent.screenshot).toHaveBeenCalledWith(region, undefined);
		expect(JSON.parse(result.content[1].text)).toEqual({
			width: 600,
			height: 400,
			scale: 0.5,
			originX: 200,
			originY: 100,
			hint: "Only the region is shown. Window point = (originX + pixel x × scale, originY + pixel y × scale).",
		});
		const { description } = (await call("tools/list")).result.tools.find(
			(tool: { name: string }) => tool.name === "screenshot",
		);
		expect(description).toContain("point = origin + pixel × scale");
	});

	it.each([
		{ x: 0, y: 0, width: 0, height: 10 },
		{ x: 0, y: 0, width: 10 },
	])("refuses a bad screenshot region %o before reaching the agent", async (region) => {
		const { call, agent } = setup();
		const { result } = await call("tools/call", { name: "screenshot", arguments: { region } });
		expect(result.isError).toBe(true);
		expect(agent.screenshot).not.toHaveBeenCalled();
	});

	it("turns single-action tools into one-step perform calls", async () => {
		const { call, agent } = setup();
		const calls: [string, Record<string, unknown>][] = [
			["click", { x: 5, y: 6, count: 3, button: "right", modifiers: ["command", "shift"] }],
			[
				"drag",
				{ fromX: 1, fromY: 2, toX: 30, toY: 40, modifiers: ["option"], durationMs: 900 },
			],
			["scroll", { x: 5, y: 6, deltaY: -200, deltaX: 10, modifiers: ["shift"] }],
			["press_key", { key: "a", modifiers: ["cmd"] }],
			["press_key", { key: "right", repeat: 5 }],
			["press_key", { key: "?" }],
			["type_text", { text: "héllo 👋\n\t" }],
		];
		for (const [name, args] of calls) {
			const { result } = await call("tools/call", { name, arguments: args });
			expect(result.isError).toBeFalsy();
		}
		const actions: Record<string, string> = {
			click: "click",
			drag: "drag",
			scroll: "scroll",
			press_key: "key",
			type_text: "type",
		};
		calls.forEach(([name, args], index) => {
			expect(agent.perform).toHaveBeenNthCalledWith(
				index + 1,
				[{ action: actions[name], ...args }],
				undefined,
			);
		});
	});

	it("accepts every step shape in perform", async () => {
		const { call, agent } = setup();
		const steps = [
			{ action: "move", x: 1, y: 1, durationMs: 500 },
			{ action: "click", x: 2, y: 2, count: 2, modifiers: ["cmd"] },
			{ action: "drag", fromX: 0, fromY: 0, toX: 9, toY: 9, button: "left" },
			{ action: "scroll", x: 3, y: 3, deltaY: 400, modifiers: ["ctrl"] },
			{ action: "type", text: "Hello" },
			{ action: "key", key: "z", modifiers: ["cmd", "shift"], repeat: 2 },
			{ action: "wait", ms: 30_000 },
		];
		const { result } = await call("tools/call", { name: "perform", arguments: { steps } });
		expect(result.isError).toBeFalsy();
		expect(agent.perform).toHaveBeenCalledWith(steps, undefined);
	});

	it("passes a trimmed scene title to perform and refuses an empty or long one", async () => {
		const { call, agent } = setup();
		const steps = [{ action: "wait", ms: 1 }];
		await call("tools/call", {
			name: "perform",
			arguments: { steps, title: "  Open settings " },
		});
		expect(agent.perform).toHaveBeenCalledWith(steps, { title: "Open settings" });
		for (const title of ["   ", "x".repeat(81)]) {
			const { result } = await call("tools/call", {
				name: "perform",
				arguments: { steps, title },
			});
			expect(result.isError).toBe(true);
		}
		expect(agent.perform).toHaveBeenCalledTimes(1);
	});

	it("aims single tools at targets and refuses a point and a target together", async () => {
		const { call, agent } = setup();
		const { result: listed } = await call("tools/list");
		const click = listed.tools.find((tool: { name: string }) => tool.name === "click");
		expect(Object.keys(click.inputSchema.properties)).toEqual(
			expect.arrayContaining(["x", "y", "target"]),
		);
		const target = { text: "Save", role: "button" };
		await call("tools/call", { name: "click", arguments: { target } });
		await call("tools/call", { name: "type_text", arguments: { text: "hi", into: target } });
		await call("tools/call", {
			name: "wait_for",
			arguments: { text: "Saved", timeoutMs: 5000 },
		});
		expect(agent.perform).toHaveBeenNthCalledWith(1, [{ action: "click", target }], undefined);
		expect(agent.perform).toHaveBeenNthCalledWith(
			2,
			[{ action: "type", text: "hi", into: target }],
			undefined,
		);
		expect(agent.perform).toHaveBeenNthCalledWith(
			3,
			[{ action: "waitFor", text: "Saved", timeoutMs: 5000 }],
			undefined,
		);
		for (const [name, args] of [
			["click", {}],
			["click", { x: 1, y: 1, target }],
			["move_pointer", { x: 1 }],
			["scroll", { deltaY: 10 }],
			["drag", { from: target }],
			["wait_for", {}],
			["wait_for", { settled: true, text: "Saved" }],
		] as const) {
			const { result } = await call("tools/call", { name, arguments: args });
			expect(result.isError).toBe(true);
		}
		expect(agent.perform).toHaveBeenCalledTimes(3);
	});

	it("accepts every step the controller accepts", async () => {
		const { call, agent } = setup();
		const steps = [
			{ action: "waitFor", settled: true, gone: false },
			{ action: "waitFor", text: "Saved", timeoutMs: 50 },
			{ action: "click", target: { text: "Row", index: 150 } },
		];
		const { result } = await call("tools/call", { name: "perform", arguments: { steps } });
		expect(result.isError).toBeFalsy();
		expect(agent.perform).toHaveBeenCalledWith(steps, undefined);
		const { result: blank } = await call("tools/call", {
			name: "wait_for",
			arguments: { role: "  " },
		});
		expect(blank.isError).toBe(true);
	});

	it("passes perform options through only when given", async () => {
		const { call, agent } = setup();
		const steps = [{ action: "click", target: { text: "Next" } }];
		await call("tools/call", {
			name: "perform",
			arguments: { steps, pace: "brisk", dryRun: true, then: "elements" },
		});
		expect(agent.perform).toHaveBeenCalledWith(
			steps,
			expect.objectContaining({ pace: "brisk", dryRun: true, then: "elements" }),
		);
		const { result } = await call("tools/call", {
			name: "perform",
			arguments: { steps, pace: "fast" },
		});
		expect(result.isError).toBe(true);
	});

	it("validates perform steps before reaching the controller", async () => {
		const { call, agent } = setup();
		for (const steps of [
			[{ action: "wait", ms: 30_001 }],
			[{ action: "click", x: 0, y: 0, count: 4 }],
			[{ action: "key", key: "a", repeat: 101 }],
			[{ action: "key", key: "a", repeat: 0 }],
			[{ action: "key", key: "" }],
			[{ action: "key", key: "x".repeat(33) }],
			[{ action: "key", key: "a", modifiers: ["cmd", "shift", "alt", "ctrl", "fn", "cmd"] }],
			[{ action: "click", x: 0, y: 0, modifiers: [""] }],
			[{ action: "click", x: -1, y: 0 }],
			[{ action: "drag", fromX: 0, fromY: 0, toX: -5, toY: 0 }],
			[{ action: "drag", fromX: 0, fromY: 0 }],
			[{ action: "click" }],
			[{ action: "click", x: 1 }],
			[{ action: "click", x: 1, y: 1, target: { text: "Save" } }],
			[{ action: "move", target: { text: "" } }],
			[{ action: "drag", from: { text: "A" }, toX: 1 }],
			[{ action: "waitFor", timeoutMs: 30_001, settled: true }],
			[{ action: "waitFor" }],
			[{ action: "waitFor", text: "Saved", settled: true }],
			[{ action: "waitFor", settled: true, gone: true }],
			[{ action: "click", target: { text: "Save", index: -1 } }],
			[{ action: "scroll", x: 0, y: 0, deltaY: 1_000_000 }],
			[{ action: "type", text: "" }],
			[{ action: "hover", x: 0, y: 0 }],
			[],
			Array.from({ length: 201 }, () => ({ action: "wait", ms: 0 })),
		]) {
			const { result } = await call("tools/call", { name: "perform", arguments: { steps } });
			expect(result.isError).toBe(true);
		}
		expect(agent.perform).not.toHaveBeenCalled();
	});

	it("teaches a generic workflow, key reference and recovery on macOS", async () => {
		const { call } = setup();
		const init = await call("initialize", {
			protocolVersion: "2025-11-25",
			capabilities: {},
			clientInfo: { name: "test", version: "1" },
		});
		const instructions: string = init.result.instructions;
		for (const needle of [
			"open_url",
			"list_sources → select_source",
			"screenshot",
			"start_recording",
			"perform",
			"stop_recording",
			"export_video",
			"landscape",
			"the user took over",
			"Let agents use the mouse and keyboard",
		]) {
			expect(instructions).toContain(needle);
		}
		const { result } = await call("tools/list");
		const pressKey = result.tools.find((tool: { name: string }) => tool.name === "press_key");
		for (const needle of [
			"enter (return)",
			"cmd (command/meta/super/win/windows)",
			"alt (option/opt)",
			"fn",
			"repeat",
			"forward delete",
		]) {
			expect(pressKey.description).toContain(needle);
		}
		expect(JSON.stringify(result.tools) + instructions).not.toMatch(
			/Auditor|Configuration|Onboarding|stanch|Chrome/,
		);
		const tooLong = [
			["instructions", instructions],
			...result.tools.map((tool: { name: string; description: string }) => [
				tool.name,
				tool.description,
			]),
		].filter(([, text]) => text.length > 2048);
		expect(tooLong.map(([name, text]) => `${name}: ${text.length}`)).toEqual([]);
	});

	it.each([
		["darwin", false, "open_url with https://example.com", "perform"],
		["win32", false, "ctrl", "perform"],
		["linux", false, "ACCESSIBILITY_ENABLED=1", "perform"],
		["linux", true, "share dialog", "user performs the demo"],
	] as const)("serves the record_demo prompt on %s (Wayland: %s)", async (platform, wayland, expected, flow) => {
		const { call } = setup("idle", { platform, wayland });
		const listed = await call("prompts/list");
		expect(listed.result.prompts).toEqual([
			expect.objectContaining({
				name: "record_demo",
				arguments: expect.arrayContaining([
					expect.objectContaining({ name: "goal", required: true }),
					expect.objectContaining({ name: "url" }),
					expect.objectContaining({ name: "app" }),
					expect.objectContaining({ name: "output_path" }),
				]),
			}),
		]);
		const { result } = await call("prompts/get", {
			name: "record_demo",
			arguments: {
				goal: "creating a project",
				url: "https://example.com",
				output_path: "/out/demo.mp4",
			},
		});
		const text: string = result.messages[0].content.text;
		expect(text).toContain("creating a project");
		expect(text).toContain(expected);
		expect(text).toContain(flow);
		expect(text).toContain('outputPath "/out/demo.mp4"');
		if (wayland) expect(text).not.toContain("open_url");
		if (platform === "darwin") expect(text).not.toContain("ctrl");
	});

	it("requires a goal for record_demo", async () => {
		const { call } = setup();
		const { result, messages } = await call("prompts/get", {
			name: "record_demo",
			arguments: {},
		});
		expect(result).toBeUndefined();
		expect(messages.at(-1).error).toBeDefined();
	});

	it("offers only the recording tools and their flow on Linux with Wayland", async () => {
		const { call } = setup("idle", { platform: "linux", wayland: true });
		const { result } = await call("tools/list");
		expect(result.tools.map((tool: { name: string }) => tool.name).sort()).toEqual([
			"add_card",
			"annotate",
			"arm_recording",
			"cancel_recording",
			"check_edits",
			"delete_recording",
			"edit_audio",
			"edit_captions",
			"edit_project",
			"edit_timeline",
			"edit_zoom",
			"export_video",
			"get_editor_state",
			"get_frame",
			"get_status",
			"history",
			"list_recordings",
			"list_sources",
			"open_editor",
			"pause_recording",
			"polish_recording",
			"recover_recording",
			"render_preview",
			"restore_recording",
			"resume_recording",
			"review_recording",
			"sample_frames",
			"select_source",
			"set_cursor",
			"set_do_not_disturb",
			"set_look",
			"set_overlay",
			"start_recording",
			"stop_recording",
			"thumbnail",
			"verify_export",
			"wait_for_download",
		]);
		const descriptions = JSON.stringify(result.tools);
		expect(descriptions).not.toContain("Raises the window");
		expect(descriptions).not.toContain("pid");
		const init = await call("initialize", {
			protocolVersion: "2025-11-25",
			capabilities: {},
			clientInfo: { name: "test", version: "1" },
		});
		expect(init.result.instructions).not.toContain("open_url");
		expect(init.result.instructions).toContain("list_sources → select_source");
		const tooLong = [
			init.result.instructions,
			...result.tools.map((tool: { description: string }) => tool.description),
		].filter((text: string) => text.length > 2048);
		expect(tooLong).toEqual([]);
	});

	it.each([
		["win32", "Windows key"],
		["linux", "Super key"],
	] as const)("offers the control tools on %s with its own guidance", async (platform, key) => {
		const { call } = setup("idle", { platform });
		const { result } = await call("tools/list");
		const names = result.tools.map((tool: { name: string }) => tool.name);
		expect(names).toEqual(expect.arrayContaining(["open_url", "perform", "find_elements"]));
		const init = await call("initialize", {
			protocolVersion: "2025-11-25",
			capabilities: {},
			clientInfo: { name: "test", version: "1" },
		});
		const instructions: string = init.result.instructions;
		expect(instructions).toContain(`Shortcuts use ctrl (cmd is the ${key})`);
		expect(instructions).not.toContain("System Settings");
		expect(instructions).not.toContain("macOS");
		if (platform === "linux") {
			expect(instructions).toContain("whole screen");
			expect(instructions).toContain("even mid-take");
			const findElements = result.tools.find(
				(tool: { name: string }) => tool.name === "find_elements",
			);
			expect(findElements.description).toContain("ACCESSIBILITY_ENABLED=1");
		}
		const tooLong = [
			instructions,
			...result.tools.map((tool: { description: string }) => tool.description),
		].filter((text: string) => text.length > 2048);
		expect(tooLong).toEqual([]);
	});

	it.each([
		"darwin",
		"win32",
		"linux",
	] as const)("says a takeover ends the scene, not the take, on %s", async (platform) => {
		const { call } = setup("idle", { platform });
		const init = await call("initialize", INITIALIZE);
		expect(init.result.instructions).toContain("cuts only that scene");
		expect(init.result.instructions).not.toContain("stop and ask the user");
		const prompt = await call("prompts/get", {
			name: "record_demo",
			arguments: { goal: "creating a project" },
		});
		const text = JSON.stringify(prompt.result);
		expect(text).toContain("ends the scene, not the recording");
		expect(text).not.toContain("Stop and ask the user");
	});

	it("passes set_input_policy to the agent and states the pacing levers in perform", async () => {
		const { call, agent } = setup("idle", { platform: "darwin" });
		const { result } = await call("tools/call", {
			name: "set_input_policy",
			arguments: { onTakeover: "pause", tolerancePx: 30, autoResumeAfterMs: 1500 },
		});
		expect(result.isError).toBeFalsy();
		expect(agent.setInputPolicy).toHaveBeenCalledWith({
			onTakeover: "pause",
			tolerancePx: 30,
			autoResumeAfterMs: 1500,
		});
		const bad = await call("tools/call", {
			name: "set_input_policy",
			arguments: { onTakeover: "sulk" },
		});
		expect(bad.result.isError).toBe(true);
		const list = await call("tools/list", {});
		const perform = list.result.tools.find((tool: { name: string }) => tool.name === "perform");
		expect(perform.description).toContain("hold {ms} (same as wait {ms}) is kept");
	});

	it("chooses the control window on Linux without changing what is recorded", async () => {
		const { call, agent, remote } = setup("idle", { platform: "linux" });
		await call("tools/call", { name: "select_source", arguments: { id: "window:7:0" } });
		expect(agent.chooseWindow).toHaveBeenCalledWith("window:7:0");
		expect(remote.selectSource).not.toHaveBeenCalled();
		await call("tools/call", {
			name: "select_source",
			arguments: { id: "screen:linux-portal" },
		});
		expect(remote.selectSource).toHaveBeenCalledWith({ id: "screen:linux-portal" });
		const mac = setup("idle", { platform: "darwin" });
		await mac.call("tools/call", { name: "select_source", arguments: { id: "window:7:0" } });
		expect(mac.agent.chooseWindow).not.toHaveBeenCalled();
	});
	it.each([
		"darwin",
		"win32",
		"linux",
	] as const)("teaches plan, rehearse, take in the %s instructions and record_demo prompt", async (platform) => {
		const { call } = setup("idle", { platform });
		const init = await call("initialize", INITIALIZE);
		const instructions: string = init.result.instructions;
		for (const needle of PROTOCOL_INSTRUCTIONS) expect(instructions).toContain(needle);
		expect(instructions.indexOf("2. Plan.")).toBeLessThan(instructions.indexOf("3. Rehearse"));
		expect(instructions.indexOf("3. Rehearse")).toBeLessThan(
			instructions.indexOf("start_recording"),
		);
		const { result } = await call("prompts/get", {
			name: "record_demo",
			arguments: { goal: "creating a project", url: "https://example.com" },
		});
		const text: string = result.messages[0].content.text;
		for (const needle of PROTOCOL_PROMPT) expect(text).toContain(needle);
		expect(text.indexOf("PHASE 1 - PLAN")).toBeLessThan(text.indexOf("PHASE 2 - REHEARSE"));
		expect(text.indexOf("PHASE 2 - REHEARSE")).toBeLessThan(text.indexOf("PHASE 3 - TAKE"));
		const tools = JSON.stringify((await call("tools/list")).result.tools);
		expect(tools).toContain("validated at run time");
		expect(tools).toContain("ambiguous, not missing");
		expect(tools).toContain("page, a signature to compare between the rehearsal and the take");
		for (const phrase of PERMISSIVE_WORDING) {
			expect(instructions).not.toContain(phrase);
			expect(text).not.toContain(phrase);
			expect(tools).not.toContain(phrase);
		}
	});

	it("keeps the permissive wording out of the Wayland instructions and prompt", async () => {
		const { call } = setup("idle", { platform: "linux", wayland: true });
		const init = await call("initialize", INITIALIZE);
		const { result } = await call("prompts/get", {
			name: "record_demo",
			arguments: { goal: "creating a project" },
		});
		const text: string = result.messages[0].content.text;
		expect(text).toContain("user performs the demo");
		const tools = JSON.stringify((await call("tools/list")).result.tools);
		for (const phrase of PERMISSIVE_WORDING) {
			expect(init.result.instructions).not.toContain(phrase);
			expect(text).not.toContain(phrase);
			expect(tools).not.toContain(phrase);
		}
	});

	it("keeps each substring controlInstructions replaces unique in the macOS text", async () => {
		const { call } = setup();
		const init = await call("initialize", INITIALIZE);
		const instructions: string = init.result.instructions;
		for (const anchor of REPLACE_ANCHORS) {
			expect(instructions.split(anchor)).toHaveLength(2);
		}
	});

	it.each([
		["darwin", false],
		["win32", false],
		["linux", false],
		["linux", true],
	] as const)("only ever names tools that exist on %s (wayland: %s)", async (platform, wayland) => {
		const { call } = setup("idle", { platform, wayland });
		const init = await call("initialize", INITIALIZE);
		const { result } = await call("tools/list");
		const tools = result.tools as { name: string; description: string }[];
		const offered = new Set(tools.map((tool) => tool.name));
		const schemaWords = new Set<string>();
		for (const tool of tools) collectSchemaWords(tool, schemaWords);
		const prompt = await call("prompts/get", {
			name: "record_demo",
			arguments: { goal: "creating a project", url: "https://example.com" },
		});
		const texts: [string, string][] = [
			["instructions", init.result.instructions as string],
			["record_demo", prompt.result.messages[0].content.text as string],
			...tools.map((tool) => [tool.name, tool.description] as [string, string]),
		];
		const missing: string[] = [];
		for (const [where, text] of texts) {
			for (const mentioned of new Set(text.match(/\b[a-z][a-z_]{3,}_[a-z]+\b/g) ?? [])) {
				if (offered.has(mentioned) || schemaWords.has(mentioned)) continue;
				missing.push(`${where} names ${mentioned}`);
			}
		}
		expect(missing).toEqual([]);
	});

	it.each([
		"darwin",
		"win32",
		"linux",
	] as const)("keeps every %s description and the instructions within 2048 characters", async (platform) => {
		const { call } = setup("idle", { platform });
		const init = await call("initialize", INITIALIZE);
		const { result } = await call("tools/list");
		const tooLong = [
			["instructions", init.result.instructions as string] as const,
			...result.tools.map(
				(tool: { name: string; description: string }) =>
					[tool.name, tool.description] as const,
			),
		].filter(([, text]) => text.length > 2048);
		expect(tooLong.map(([name, text]) => `${name}: ${text.length}`)).toEqual([]);
	});
});
