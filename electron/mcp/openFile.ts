import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { shell } from "electron";

export const DOWNLOAD_DEFAULT_TIMEOUT_MS = 60_000;
export const DOWNLOAD_MAX_TIMEOUT_MS = 5 * 60_000;
const DOWNLOAD_POLL_MS = 500;
// Browsers write here until the download is complete.
const PARTIAL_SUFFIX = /\.(crdownload|part|download|partial|tmp|opdownload)$/i;

export type OpenFileDeps = {
	openPath: (filePath: string) => Promise<string>;
	openWithApp: (filePath: string, app: string) => Promise<void>;
	/** Supplied by the agent-control layer, which owns the frontmost-window loop open_url uses. */
	selectFrontWindow?: (app?: string) => Promise<{ id: string } & Record<string, unknown>>;
	sleep: (ms: number) => Promise<void>;
	now: () => number;
	pollMs: number;
};

const defaultDeps = (): OpenFileDeps => ({
	openPath: (filePath) => shell.openPath(filePath),
	openWithApp: (filePath, app) =>
		new Promise((resolve, reject) => {
			const failed = (error: Error) =>
				reject(new Error(`Could not open the file with ${app}: ${error.message}`));
			if (process.platform === "darwin") {
				execFile("open", ["-a", app, filePath], (error) =>
					error ? failed(error) : resolve(),
				);
				return;
			}
			const child = spawn(app, [filePath], { detached: true, stdio: "ignore" });
			child.once("error", failed);
			child.once("spawn", () => {
				child.removeListener("error", failed);
				child.unref();
				resolve();
			});
		}),
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	now: Date.now,
	pollMs: DOWNLOAD_POLL_MS,
});

/** `*` and `?` in the file name only; the folder must be literal. */
export function splitGlob(glob: string) {
	if (typeof glob !== "string" || !path.isAbsolute(glob)) {
		throw new Error(
			`glob must be an absolute path such as /Users/me/Downloads/*.xlsx: ${glob}`,
		);
	}
	const dir = path.dirname(glob);
	if (/[*?[\]{}]/.test(dir)) {
		throw new Error("Wildcards are only allowed in the file name, not in the folder.");
	}
	const name = path.basename(glob);
	const source = name
		.split("")
		.map((char) =>
			char === "*" ? ".*" : char === "?" ? "." : char.replace(/[\\^$.|+()[\]{}]/g, "\\$&"),
		)
		.join("");
	// Anchored and built from escaped literals, so the pattern stays linear-time.
	return { dir, matches: (file: string) => new RegExp(`^${source}$`, "i").test(file) };
}

export function createOpenFile(overrides: Partial<OpenFileDeps> = {}) {
	const deps = { ...defaultDeps(), ...overrides };

	return {
		async openFile(args: { path: string; withApp?: string; thenSelectSource?: boolean }) {
			if (!path.isAbsolute(args.path)) throw new Error(`path must be absolute: ${args.path}`);
			const target = path.resolve(args.path);
			const stat = await fs.stat(target).catch(() => null);
			if (!stat) throw new Error(`There is no file at ${target}.`);
			if (!stat.isFile()) {
				throw new Error(`${target} is a folder, not a file. Pass the file itself.`);
			}
			if (args.thenSelectSource && !deps.selectFrontWindow) {
				throw new Error(
					"Selecting the window needs the mouse and keyboard switch in Recordly Settings, which is off.",
				);
			}
			if (args.withApp) {
				await deps.openWithApp(target, args.withApp);
			} else {
				const failure = await deps.openPath(target);
				if (failure) throw new Error(`Could not open ${target}: ${failure}`);
			}
			if (!args.thenSelectSource) return { path: target };
			const source = await deps.selectFrontWindow?.(args.withApp);
			return { path: target, sourceId: source?.id, source };
		},

		async waitForDownload(args: { glob: string; timeoutMs?: number; sinceMs?: number }) {
			const { dir, matches } = splitGlob(args.glob);
			const timeout = Math.min(
				Math.max(args.timeoutMs ?? DOWNLOAD_DEFAULT_TIMEOUT_MS, 1_000),
				DOWNLOAD_MAX_TIMEOUT_MS,
			);
			if (!(await fs.stat(dir).catch(() => null))?.isDirectory()) {
				throw new Error(`The folder does not exist: ${dir}`);
			}
			const scan = async () => {
				const found = new Map<string, { size: number; mtimeMs: number }>();
				for (const name of await fs.readdir(dir)) {
					if (!matches(name) || PARTIAL_SUFFIX.test(name)) continue;
					const stat = await fs.stat(path.join(dir, name)).catch(() => null);
					if (stat?.isFile()) found.set(name, { size: stat.size, mtimeMs: stat.mtimeMs });
				}
				return found;
			};
			// A download that finished before the call is still the one asked for, so sinceMs
			// counts anything modified after that moment as new.
			if (args.sinceMs !== undefined && !Number.isFinite(args.sinceMs)) {
				throw new Error("sinceMs must be a number of milliseconds since the epoch.");
			}
			const since = args.sinceMs;
			const before = await scan();
			if (since !== undefined) {
				for (const [name, stat] of before) {
					if (stat.mtimeMs >= since) before.delete(name);
				}
			}
			const previous = new Map<string, number>();
			const deadline = deps.now() + timeout;
			for (;;) {
				const current = await scan();
				const ready = [...current]
					.filter(([name, stat]) => {
						const old = before.get(name);
						const isNew =
							!old || old.mtimeMs !== stat.mtimeMs || old.size !== stat.size;
						return isNew && stat.size > 0 && previous.get(name) === stat.size;
					})
					.sort((a, b) => b[1].mtimeMs - a[1].mtimeMs);
				if (ready.length) {
					const [name, stat] = ready[0];
					return { path: path.join(dir, name), sizeBytes: stat.size };
				}
				previous.clear();
				for (const [name, stat] of current) previous.set(name, stat.size);
				if (deps.now() >= deadline) {
					throw new Error(
						`No finished download matching ${args.glob} appeared within ${Math.round(timeout / 1000)} s. Check the download started, or try a longer timeoutMs (up to ${DOWNLOAD_MAX_TIMEOUT_MS / 1000} s).`,
					);
				}
				await deps.sleep(deps.pollMs);
			}
		},
	};
}

export type OpenFileTools = ReturnType<typeof createOpenFile>;
