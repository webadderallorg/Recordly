import { afterEach, beforeEach, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
	effects: [] as (() => unknown)[],
	layoutEffects: [] as (() => void | (() => void))[],
	layoutCleanups: [] as (() => void)[],
}));
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useRef: (value: unknown) => ({ current: value }),
	useEffect: (effect: () => unknown) => hooks.effects.push(effect),
	useLayoutEffect: (effect: () => void | (() => void)) => hooks.layoutEffects.push(effect),
	useCallback: (callback: unknown) => callback,
}));
vi.mock("@/components/ui/toast", () => ({
	toast: { warning: vi.fn(), error: vi.fn(), dismiss: vi.fn(), success: vi.fn() },
}));
vi.mock("@/i18n/runtime", () => ({ translate: (_key: string, fallback: string) => fallback }));
vi.mock("../projectPersistence", () => ({
	fromFileUrl: (value: string) => value,
	resolveVideoUrl: vi.fn(),
}));
import { toast } from "@/components/ui/toast";
import { useInitialEditorSource } from "./useInitialEditorSource";
import { useProjectOpenActions } from "./useProjectOpenActions";

const recoveredProject = {
	version: 1,
	videoPath: "/recordings/old.mp4",
	editor: { wallpaper: "red" },
};
const path = "/projects/recovered.recordly";
beforeEach(() => {
	vi.clearAllMocks();
	hooks.effects = [];
	hooks.layoutEffects = [];
	hooks.layoutCleanups = [];
});
afterEach(() => {
	for (const cleanup of hooks.layoutCleanups) cleanup();
	vi.unstubAllGlobals();
});
function commitLayoutEffects() {
	for (const effect of hooks.layoutEffects.splice(0)) {
		const cleanup = effect();
		if (cleanup) hooks.layoutCleanups.push(cleanup);
	}
}

it.each([
	true,
	false,
])("notifies recovery=%s only after the selected project is applied", async (applied) => {
	const result = { success: true, recovered: true, project: recoveredProject, path };
	vi.stubGlobal("window", {
		electronAPI: { openProjectFileAtPath: vi.fn().mockResolvedValue(result) },
	});
	const apply = vi.fn().mockResolvedValue(applied);
	const closeBrowser = vi.fn();
	const actions = useProjectOpenActions({
		project: { setProjectBrowserOpen: closeBrowser },
		applyLoadedProject: apply,
		hasUnsavedChanges: false,
		refreshProjectLibrary: vi.fn().mockResolvedValue(undefined),
	} as unknown as Parameters<typeof useProjectOpenActions>[0]);
	commitLayoutEffects();
	await actions.handleOpenProjectFromLibrary(path);
	expect(apply).toHaveBeenCalledWith(recoveredProject, path);
	if (applied) {
		expect(closeBrowser).toHaveBeenCalledWith(false);
		expect(toast.warning).toHaveBeenCalledWith("Recovered the previous saved version");
		expect(apply.mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(toast.warning).mock.invocationCallOrder[0],
		);
	} else {
		expect(toast.warning).not.toHaveBeenCalled();
		expect(closeBrowser).not.toHaveBeenCalled();
	}
});

it("does not show a recovery warning for a normal project open", async () => {
	vi.stubGlobal("window", {
		electronAPI: {
			openProjectFileAtPath: vi
				.fn()
				.mockResolvedValue({ success: true, project: recoveredProject, path }),
		},
	});
	const actions = useProjectOpenActions({
		project: { setProjectBrowserOpen: vi.fn() },
		applyLoadedProject: vi.fn().mockResolvedValue(true),
		hasUnsavedChanges: false,
		refreshProjectLibrary: vi.fn().mockResolvedValue(undefined),
	} as unknown as Parameters<typeof useProjectOpenActions>[0]);
	commitLayoutEffects();
	await actions.handleOpenProjectFromLibrary(path);
	expect(toast.warning).not.toHaveBeenCalled();
});

it("hydrates the recovered launch project and reports recovery after application", async () => {
	vi.stubGlobal("window", {
		electronAPI: {
			loadCurrentProjectFile: vi.fn().mockResolvedValue({
				success: true,
				recovered: true,
				project: recoveredProject,
				path,
			}),
		},
	});
	const apply = vi.fn().mockResolvedValue(true);
	const loading = vi.fn();
	useInitialEditorSource({
		project: { setLoading: loading, setError: vi.fn() },
		appearance: { webcam: { sourcePath: null }, setResolvedWebcamVideoUrl: vi.fn() },
		timeline: {},
		smokeConfig: { enabled: false },
		devConfig: {},
		applyLoadedProject: apply,
	} as unknown as Parameters<typeof useInitialEditorSource>[0]);
	hooks.effects[0]();
	await vi.waitFor(() => expect(loading).toHaveBeenCalledWith(false));
	expect(apply).toHaveBeenCalledWith(recoveredProject, path);
	expect(toast.warning).toHaveBeenCalledWith("Recovered the previous saved version");
});
