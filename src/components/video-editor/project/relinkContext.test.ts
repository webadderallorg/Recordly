import { afterEach, beforeEach, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
	refs: [] as { current: unknown }[],
	index: 0,
	effects: [] as (() => void | (() => void))[],
}));
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useRef: (value: unknown) => {
		const index = hooks.index++;
		hooks.refs[index] ??= { current: value };
		return hooks.refs[index];
	},
	useCallback: (callback: unknown) => callback,
	useEffect: (effect: () => void | (() => void)) => hooks.effects.push(effect),
}));
vi.mock("@/components/ui/toast", () => ({
	toast: { warning: vi.fn(), error: vi.fn(), dismiss: vi.fn(), success: vi.fn() },
}));
vi.mock("@/i18n/runtime", () => ({ translate: (_key: string, fallback: string) => fallback }));
vi.mock("../projectPersistence", async () => ({
	fromFileUrl: (await import("../projectMediaPaths")).fromFileUrl,
	resolveVideoUrl: vi.fn(),
}));

import { toast } from "@/components/ui/toast";
import { useProjectOpenActions } from "./useProjectOpenActions";

const target = "/projects/reconnect.recordly";
const source = "/recordings/original.mp4";
const url = (port: number, file = source) =>
	`http://127.0.0.1:${port}/video?path=${encodeURIComponent(file)}&token=fixture-${port}`;
const result = {
	success: true,
	path: target,
	project: { videoPath: "/recordings/replacement.mp4" },
};

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

const initialProject = () => ({
	currentProjectPath: "/projects/current.recordly",
	videoSourcePath: source as string | null,
	videoPath: url(12345),
	setError: vi.fn(),
	setProjectBrowserOpen: vi.fn(),
});

function render(
	project: ReturnType<typeof initialProject>,
	applyLoadedProject = vi.fn().mockResolvedValue(true),
	override: Partial<Parameters<typeof useProjectOpenActions>[0]> = {},
) {
	hooks.index = 0;
	const actions = useProjectOpenActions({
		project,
		applyLoadedProject,
		hasUnsavedChanges: false,
		refreshProjectLibrary: vi.fn().mockResolvedValue(undefined),
		...override,
	} as unknown as Parameters<typeof useProjectOpenActions>[0]);
	return { ...actions, applyLoadedProject };
}

beforeEach(() => {
	vi.clearAllMocks();
	hooks.refs = [];
	hooks.index = 0;
	hooks.effects = [];
});
afterEach(() => vi.unstubAllGlobals());

it.each([
	false,
	true,
])("accepts a same-source URL refresh during relink, raw source absent=%s", async (absent) => {
	const pending = deferred<typeof result>();
	const relink = vi.fn(() => pending.promise);
	vi.stubGlobal("window", { electronAPI: { relinkProjectRecording: relink } });
	const project = initialProject();
	if (absent) project.videoSourcePath = null;
	const actions = render(project);
	const request = actions.handleRelinkProjectRecording(target);
	await vi.waitFor(() => expect(relink).toHaveBeenCalledWith(target));
	// Only delivery capabilities change: the main process and logical editor remain
	// on the same project/source, so the completed authorized repair must be applied.
	render({ ...project, videoPath: url(23456) });
	pending.resolve(result);
	expect(await request).toBe(true);
	expect(actions.applyLoadedProject).toHaveBeenCalledWith(
		result.project,
		target,
		expect.any(Function),
	);
	expect(project.setError).toHaveBeenCalledWith(null);
});

it("compares the canonical source rather than file URL spelling", async () => {
	const pending = deferred<typeof result>();
	vi.stubGlobal("window", { electronAPI: { relinkProjectRecording: () => pending.promise } });
	const project = initialProject();
	const actions = render(project);
	const request = actions.handleRelinkProjectRecording(target);
	await Promise.resolve();
	render({ ...project, videoSourcePath: `file://${source}`, videoPath: url(23456) });
	pending.resolve(result);
	expect(await request).toBe(true);
});

it.each([
	"project",
	"source",
	"fallback-source",
])("rejects a true %s switch while relinking", async (kind) => {
	const pending = deferred<typeof result>();
	const relink = vi.fn(() => pending.promise);
	vi.stubGlobal("window", { electronAPI: { relinkProjectRecording: relink } });
	const project = initialProject();
	if (kind === "fallback-source") project.videoSourcePath = null;
	const actions = render(project);
	const request = actions.handleRelinkProjectRecording(target);
	await vi.waitFor(() => expect(relink).toHaveBeenCalled());
	render({
		...project,
		...(kind === "project"
			? { currentProjectPath: "/projects/new.recordly" }
			: kind === "source"
				? { videoSourcePath: "/recordings/new.mp4" }
				: { videoPath: url(23456, "/recordings/new.mp4") }),
	});
	pending.resolve(result);
	expect(await request).toBe(false);
	expect(actions.applyLoadedProject).not.toHaveBeenCalled();
	expect(project.setError).not.toHaveBeenCalled();
});

it("does not revive a request after switching away and back to the same identity", async () => {
	const pending = deferred<typeof result>();
	const relink = vi.fn(() => pending.promise);
	vi.stubGlobal("window", { electronAPI: { relinkProjectRecording: relink } });
	const project = initialProject();
	const actions = render(project);
	const request = actions.handleRelinkProjectRecording(target);
	await vi.waitFor(() => expect(relink).toHaveBeenCalled());
	render({ ...project, currentProjectPath: "/projects/other.recordly" });
	render(project);
	pending.resolve(result);
	expect(await request).toBe(false);
	expect(actions.applyLoadedProject).not.toHaveBeenCalled();
});

it("does not invoke native relink after a context switch during the unsaved-change save", async () => {
	const saving = deferred<boolean>();
	const relink = vi.fn();
	vi.stubGlobal("window", { electronAPI: { relinkProjectRecording: relink } });
	const project = initialProject();
	const actions = render(project, undefined, {
		hasUnsavedChanges: true,
		saveProject: () => saving.promise,
	});
	const request = actions.handleRelinkProjectRecording(target);
	render({ ...project, videoSourcePath: "/recordings/new.mp4" });
	saving.resolve(true);
	expect(await request).toBe(false);
	expect(relink).not.toHaveBeenCalled();
});

it.each([false, true])("ignores completion after unmount, native failure=%s", async (failed) => {
	const pending = deferred<typeof result>();
	const relink = vi.fn(() => pending.promise);
	vi.stubGlobal("window", { electronAPI: { relinkProjectRecording: relink } });
	const actions = render(initialProject());
	const cleanup = hooks.effects[0]();
	const request = actions.handleRelinkProjectRecording(target);
	await vi.waitFor(() => expect(relink).toHaveBeenCalled());
	cleanup?.();
	if (failed) pending.reject(new Error("native error"));
	else pending.resolve(result);
	expect(await request).toBe(false);
	expect(actions.applyLoadedProject).not.toHaveBeenCalled();
	expect(toast.error).not.toHaveBeenCalled();
});
