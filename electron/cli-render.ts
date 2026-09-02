/**
 * Headless render CLI — `electron . --render <project.recordly> [--out <file.mp4>]`
 *
 * Fleet patch (Berserker 2026-09-02): agent-native export. Bridges the CLI flag to
 * the app's own RECORDLY_SMOKE_EXPORT_* env contract — the same path CI uses — so
 * the normal boot creates the editor window with the full smoke-export query and
 * the real export pipeline runs. We only set env + watch the output file.
 */
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

// Module-load (runs at import time, BEFORE main.ts evaluates its module-level
// IS_SMOKE_EXPORT constant and requests the single-instance lock):
// 1. Separate userData → separate lock scope → coexists with the user's GUI.
// 2. Seed RECORDLY_SMOKE_EXPORT_* from argv early — main.ts's smoke branch and
//    getEditorWindowQuery() read these synchronously at boot.
if (process.argv.includes("--render")) {
	app.setPath("userData", path.join(app.getPath("temp"), "recordly-cli-render"));
	const i = process.argv.indexOf("--render");
	const projectPathArg = process.argv[i + 1];
	if (projectPathArg && fs.existsSync(projectPathArg)) {
		process.env.RECORDLY_SMOKE_EXPORT = "1";
		process.env.RECORDLY_SMOKE_EXPORT_PROJECT = path.resolve(projectPathArg);
	}
}

export interface CliRenderArgs {
	projectPath: string;
	outPath: string;
	quality?: string;
	fps?: string;
}

export function parseCliRenderArgs(argv: string[]): CliRenderArgs | null {
	const i = argv.indexOf("--render");
	if (i === -1) return null;
	const projectPath = argv[i + 1];
	if (!projectPath) {
		console.error("usage: electron . --render <project.recordly> [--out <file.mp4>] [--quality q] [--fps n]");
		app.exit(64);
		return null;
	}
	const outIdx = argv.indexOf("--out");
	const qIdx = argv.indexOf("--quality");
	const fpsIdx = argv.indexOf("--fps");
	return {
		projectPath: path.resolve(projectPath),
		outPath: path.resolve(outIdx !== -1 ? argv[outIdx + 1] : "recordly-export.mp4"),
		quality: qIdx !== -1 ? argv[qIdx + 1] : undefined,
		fps: fpsIdx !== -1 ? argv[fpsIdx + 1] : undefined,
	};
}

/**
 * Configure the app's own smoke-export boot path via env, validate inputs, and
 * start watching for the output. Called from the whenReady handler BEFORE the
 * normal boot continues (the smoke branch downstream creates the editor window).
 */
export async function runCliRender(args: CliRenderArgs): Promise<void> {
	const started = Date.now();
	console.log(`[cli-render] project=${args.projectPath}`);
	console.log(`[cli-render] out=${args.outPath}`);

	const project = JSON.parse(fs.readFileSync(args.projectPath, "utf8")) as {
		videoPath?: string;
	};
	if (!project.videoPath) {
		console.error("[cli-render] project has no videoPath");
		app.exit(65);
		return;
	}
	if (!fs.existsSync(project.videoPath)) {
		console.error(`[cli-render] video missing: ${project.videoPath}`);
		app.exit(66);
		return;
	}

	if (fs.existsSync(args.outPath)) fs.rmSync(args.outPath);

	process.env.RECORDLY_SMOKE_EXPORT = "1";
	process.env.RECORDLY_SMOKE_EXPORT_PROJECT = args.projectPath;
	process.env.RECORDLY_SMOKE_EXPORT_INPUT = project.videoPath;
	process.env.RECORDLY_SMOKE_EXPORT_OUTPUT = args.outPath;
	if (args.quality) process.env.RECORDLY_SMOKE_EXPORT_QUALITY = args.quality;
	if (args.fps) process.env.RECORDLY_SMOKE_EXPORT_FPS = args.fps;
	console.log("[cli-render] smoke-export env set — normal boot will create the editor window");

	// fire-and-forget watcher: stable output → exit 0; timeout → exit 124
	void (async () => {
		const deadline = Date.now() + 20 * 60 * 1000;
		let lastSize = -1;
		let stableSince = 0;
		while (Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 1000));
			if (fs.existsSync(args.outPath)) {
				const size = fs.statSync(args.outPath).size;
				if (size === lastSize && size > 0) {
					if (!stableSince) stableSince = Date.now();
					if (Date.now() - stableSince > 5000) {
						console.log(`[cli-render] DONE in ${((Date.now() - started) / 1000).toFixed(1)}s — ${args.outPath} (${(size / 1048576).toFixed(1)} MB)`);
						app.exit(0);
						return;
					}
				} else {
					stableSince = 0;
					lastSize = size;
					if (size > 0) console.log(`[cli-render] … ${(size / 1048576).toFixed(1)} MB`);
				}
			}
		}
		console.error("[cli-render] TIMEOUT waiting for output");
		app.exit(124);
	})();
}
