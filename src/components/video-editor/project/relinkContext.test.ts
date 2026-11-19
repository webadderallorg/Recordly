import { afterEach, beforeEach, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
	refs: [] as { current: unknown }[],
	index: 0,
	effects: [] as (() => void)[],
	effectSlots: [] as { deps: readonly unknown[]; cleanup?: void | (() => void) }[],
	effectIndex: 0,
}));
function scheduleEffect(effect: () => void | (() => void), deps: readonly unknown[]) {
	const index = hooks.effectIndex++;
	const previous = hooks.effectSlots[index];
	if (
		previous &&
		previous.deps.length === deps.length &&
		previous.deps.every((value, i) => Object.is(value, deps[i]))
	)
		return;
	hooks.effects.push(() => {
		previous?.cleanup?.();
		hooks.effectSlots[index] = { deps, cleanup: effect() };
	});
}
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useRef: (value: unknown) => {
		const index = hooks.index++;
		hooks.refs[index] ??= { current: value };
		return hooks.refs[index];
	},
	useCallback: (callback: unknown) => callback,
	useEffect: scheduleEffect,
	useLayoutEffect: scheduleEffect,
}));
vi.mock("@/components/ui/toast", () => ({
	toast: { warning: vi.fn(), error: vi.fn(), dismiss: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock("@/i18n/runtime", () => ({
	translate: vi.fn((_key: string, fallback: string) => fallback),
}));
vi.mock("../projectPersistence", async () => ({
	fromFileUrl: (await import("../projectMediaPaths")).fromFileUrl,
	resolveVideoUrl: vi.fn(),
}));

import { toast } from "@/components/ui/toast";
import { translate } from "@/i18n/runtime";
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

function bridge(electronAPI: Record<string, unknown>) {
	vi.stubGlobal("window", {
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		electronAPI: {
			onMenuLoadProject: vi.fn(),
			onMenuSaveProject: vi.fn(),
			onMenuSaveProjectAs: vi.fn(),
			...electronAPI,
		},
	});
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
	commit = true,
) {
	hooks.index = 0;
	hooks.effectIndex = 0;
	hooks.effects = [];
	const actions = useProjectOpenActions({
		project,
		applyLoadedProject,
		hasUnsavedChanges: false,
		refreshProjectLibrary: vi.fn().mockResolvedValue(undefined),
		...override,
	} as unknown as Parameters<typeof useProjectOpenActions>[0]);
	if (commit) for (const effect of hooks.effects.splice(0)) effect();
	return { ...actions, applyLoadedProject };
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal("localStorage", { getItem: () => null, removeItem: vi.fn() });
	hooks.refs = [];
	hooks.index = 0;
	hooks.effects = [];
	hooks.effectSlots = [];
	hooks.effectIndex = 0;
});
afterEach(() => vi.unstubAllGlobals());

it.each([
	false,
	true,
])("accepts a same-source URL refresh during relink, raw source absent=%s", async (absent) => {
	const pending = deferred<typeof result>();
	const relink = vi.fn(() => pending.promise);
	bridge({ relinkProjectRecording: relink });
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
	bridge({ relinkProjectRecording: () => pending.promise });
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
	bridge({ relinkProjectRecording: relink });
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
	bridge({ relinkProjectRecording: relink });
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
	bridge({ relinkProjectRecording: relink });
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
	bridge({ relinkProjectRecording: relink });
	const actions = render(initialProject());
	const request = actions.handleRelinkProjectRecording(target);
	await vi.waitFor(() => expect(relink).toHaveBeenCalled());
	for (const slot of hooks.effectSlots) slot.cleanup?.();
	if (failed) pending.reject(new Error("native error"));
	else pending.resolve(result);
	expect(await request).toBe(false);
	expect(actions.applyLoadedProject).not.toHaveBeenCalled();
	expect(toast.error).not.toHaveBeenCalled();
});

it("does not invalidate an active relink for a discarded render of another project", async () => {
	const pending = deferred<typeof result>();
	const relink = vi.fn(() => pending.promise);
	bridge({ relinkProjectRecording: relink });
	const project = initialProject();
	const actions = render(project);
	const request = actions.handleRelinkProjectRecording(target);
	await vi.waitFor(() => expect(relink).toHaveBeenCalled());
	// React began work for a different identity, but discarded it before commit.
	render(
		{ ...project, currentProjectPath: "/projects/uncommitted.recordly" },
		undefined,
		{},
		false,
	);
	pending.resolve(result);
	expect(await request).toBe(true);
	expect(actions.applyLoadedProject).toHaveBeenCalledWith(
		result.project,
		target,
		expect.any(Function),
	);
});

it.each([
	false,
	true,
])("keeps toast retry on committed handlers after discarded render, missing recording=%s", async (missing) => {
	const open = vi
		.fn()
		.mockResolvedValueOnce({
			success: false,
			error: missing
				? "Project video file not found: missing.mp4"
				: "Project temporarily busy",
		})
		.mockResolvedValue({ success: true, project: result.project, path: target });
	const relink = vi.fn().mockResolvedValue(result);
	bridge({ openProjectFileAtPath: open, relinkProjectRecording: relink });
	const project = initialProject();
	const applyCommitted = vi.fn().mockResolvedValue(true);
	const actions = render(project, applyCommitted);
	await actions.handleOpenProjectFromLibrary(target);
	const retry = vi.mocked(toast.error).mock.calls.at(-1)?.[1]?.action?.onClick;
	expect(retry).toBeTypeOf("function");
	const saveDiscarded = vi.fn().mockResolvedValue(false);
	render(
		{ ...project, currentProjectPath: "/projects/discarded.recordly" },
		vi.fn(),
		{ hasUnsavedChanges: true, saveProject: saveDiscarded },
		false,
	);
	retry?.();
	await vi.waitFor(() =>
		expect(applyCommitted).toHaveBeenCalledWith(
			result.project,
			target,
			...(missing ? [expect.any(Function)] : []),
		),
	);
	expect(saveDiscarded).not.toHaveBeenCalled();
	expect(missing ? relink : open).toHaveBeenCalledTimes(missing ? 1 : 2);
	// The same persistent toast action must adopt a later committed handler.
	const saveNext = vi.fn().mockResolvedValue(true);
	const applyNext = vi.fn().mockResolvedValue(true);
	render({ ...project, currentProjectPath: "/projects/committed.recordly" }, applyNext, {
		hasUnsavedChanges: true,
		saveProject: saveNext,
	});
	retry?.();
	await vi.waitFor(() => expect(applyNext).toHaveBeenCalled());
	expect(saveNext).toHaveBeenCalledOnce();
});

it.each([
	{
		name: "plan retention",
		errors: [],
		sourcesKept: ["/media/planned.mp4", "/media/also-planned.mp4"],
		deleted: [target],
	},
	{
		name: "deletion failure",
		errors: ["Could not trash project.recordly: EACCES"],
		sourcesKept: ["/media/unshared.mp4"],
		deleted: [],
	},
	{ name: "no retained files", errors: [], sourcesKept: [], deleted: [target] },
])("reports retained sources neutrally for $name", async ({ errors, sourcesKept, deleted }) => {
	const trashProjectFiles = vi
		.fn()
		.mockResolvedValue({ success: errors.length === 0, deleted, errors, sourcesKept });
	bridge({ trashProjectFiles });
	const refreshProjectLibrary = vi.fn().mockResolvedValue(undefined);
	const actions = render(initialProject(), undefined, { refreshProjectLibrary });
	const options = { includeSources: true, protectedSources: errors.length ? [] : sourcesKept };
	await expect(actions.handleDeleteProjects([target], options)).resolves.toEqual(deleted);
	expect(trashProjectFiles).toHaveBeenCalledWith([target], options);
	expect(refreshProjectLibrary).toHaveBeenCalledOnce();
	if (errors.length) {
		expect(toast.error).toHaveBeenCalledWith("Could not delete some projects", {
			description: errors.join("\n"),
		});
	} else {
		expect(toast.error).not.toHaveBeenCalled();
	}
	if (sourcesKept.length) {
		expect(translate).toHaveBeenCalledWith(
			"ui.cleanup.sharedSourcesKept",
			"Source files kept: {{count}}.",
			{ count: sourcesKept.length },
		);
		expect(toast.info).toHaveBeenCalledWith("Source files kept: {{count}}.");
	} else {
		expect(toast.info).not.toHaveBeenCalled();
	}
});
