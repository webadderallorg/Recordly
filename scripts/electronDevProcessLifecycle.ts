import type { ChildProcess } from "node:child_process";

interface DevProcessHost {
	getProcess: () => ChildProcess | undefined;
	clearProcess: (child: ChildProcess) => void;
	stopProcessTree: (pid: number) => void;
}

type Start = () => Promise<void>;
export interface ElectronDevQueue {
	pending: Promise<void>;
}

function isRunning(child: ChildProcess | undefined): child is ChildProcess {
	return Boolean(child && child.exitCode === null && child.signalCode === null);
}

/** Vite invokes build hooks independently; only one may replace Electron at a time. */
export function createElectronDevLifecycle(
	host: DevProcessHost,
	queue: ElectronDevQueue = { pending: Promise.resolve() },
) {
	let firstBuild = true;

	const schedule = (start: Start, replace: boolean) => {
		const task = queue.pending.then(async () => {
			const child = host.getProcess();
			if (isRunning(child)) {
				if (!replace) return;
				// The plugin normally exits Vite when Electron quits. A managed restart
				// must remove that handler before stopping the old process.
				child.removeListener("exit", process.exit);
				await new Promise<void>((resolve, reject) => {
					const force = setTimeout(() => child.kill("SIGKILL"), 3000);
					const timeout = setTimeout(() => {
						cleanup();
						reject(
							new Error(
								`Electron process ${child.pid} did not exit; restart cancelled`,
							),
						);
					}, 5000);
					const cleanup = () => {
						clearTimeout(force);
						clearTimeout(timeout);
						child.removeListener("exit", exited);
					};
					const exited = () => {
						cleanup();
						resolve();
					};
					child.once("exit", exited);
					try {
						if (!child.pid) throw new Error("Electron process has no PID");
						host.stopProcessTree(child.pid);
					} catch (error) {
						cleanup();
						reject(error);
					}
				});
			}
			// Do not let the plugin signal a reaped PID again in startup.exit().
			if (child) host.clearProcess(child);
			await start();
		});
		// Keep subsequent builds usable after a failed build/start.
		queue.pending = task.catch(() => undefined);
		return task;
	};

	return {
		mainBuilt(start: Start) {
			const replace = !firstBuild;
			firstBuild = false;
			// Config reloads retain process.electronApp. Adopt it on the first
			// build instead of disrupting the open editor just to reload Vite.
			return schedule(start, replace);
		},
		preloadBuilt(start: Start) {
			firstBuild = false;
			return schedule(start, false);
		},
	};
}
