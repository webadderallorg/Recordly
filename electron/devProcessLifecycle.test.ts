import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElectronDevLifecycle, type ElectronDevQueue } from "../scripts/electronDevProcessLifecycle";

function fixture() {
	const children: ChildProcess[] = [];
	let current: ChildProcess | undefined;
	const makeChild = () => {
		const child = Object.assign(new EventEmitter(), {
			pid: children.length + 100,
			exitCode: null,
			signalCode: null,
			kill: vi.fn(() => true),
		}) as unknown as ChildProcess;
		children.push(child);
		return child;
	};
	const start = vi.fn(async () => {
		current = makeChild();
	});
	const stopProcessTree = vi.fn();
	const host = {
		getProcess: () => current,
		clearProcess: (child: ChildProcess) => {
			if (child === current) current = undefined;
		},
		stopProcessTree,
	};
	const finish = (child: ChildProcess) => {
		child.exitCode = 0;
		child.emit("exit", 0, null);
	};
	return {
		children,
		start,
		host,
		finish,
		setCurrent: (child: ChildProcess) => {
			current = child;
		},
		makeChild,
	};
}

afterEach(() => vi.useRealTimers());

describe("Electron development process ownership", () => {
	it("adopts the current editor after config reload without stopping or replacing it", async () => {
		const f = fixture();
		f.setCurrent(f.makeChild());
		const lifecycle = createElectronDevLifecycle(f.host);
		await lifecycle.mainBuilt(f.start);
		await lifecycle.preloadBuilt(f.start);
		expect(f.start).not.toHaveBeenCalled();
		expect(f.host.stopProcessTree).not.toHaveBeenCalled();
	});

	it("starts only one process for overlapping main and preload builds", async () => {
		const f = fixture();
		const lifecycle = createElectronDevLifecycle(f.host);
		await Promise.all([lifecycle.mainBuilt(f.start), lifecycle.preloadBuilt(f.start)]);
		expect(f.start).toHaveBeenCalledTimes(1);
		expect(f.host.stopProcessTree).not.toHaveBeenCalled();
	});

	it("waits for the old process to exit before starting the replacement", async () => {
		const f = fixture();
		const lifecycle = createElectronDevLifecycle(f.host);
		await lifecycle.mainBuilt(f.start);
		const old = f.host.getProcess()!;
		const remove = vi.spyOn(old, "removeListener");
		const restart = lifecycle.mainBuilt(f.start);
		await Promise.resolve();
		expect(f.host.stopProcessTree).toHaveBeenCalledWith(old.pid);
		expect(remove).toHaveBeenCalledWith("exit", process.exit);
		expect(f.start).toHaveBeenCalledTimes(1);
		f.finish(old);
		await restart;
		expect(f.start).toHaveBeenCalledTimes(2);
		expect(f.host.getProcess()).not.toBe(old);
	});

	it("shares its queue across config reloads and never overlaps live processes", async () => {
		const f = fixture();
		const queue: ElectronDevQueue = { pending: Promise.resolve() };
		const first = createElectronDevLifecycle(f.host, queue);
		await first.mainBuilt(f.start);
		const old = f.host.getProcess()!;
		const restart = first.mainBuilt(f.start);
		await Promise.resolve();
		const reloaded = createElectronDevLifecycle(f.host, queue);
		const adopt = reloaded.mainBuilt(f.start);
		const preload = reloaded.preloadBuilt(f.start);
		expect(f.start).toHaveBeenCalledTimes(1);
		f.finish(old);
		await Promise.all([restart, adopt, preload]);
		expect(f.start).toHaveBeenCalledTimes(2);
		expect(f.children.filter((child) => child.exitCode === null)).toHaveLength(1);
	});

	it("force-stops a stuck owned process before replacing it", async () => {
		vi.useFakeTimers();
		const f = fixture();
		const lifecycle = createElectronDevLifecycle(f.host);
		await lifecycle.mainBuilt(f.start);
		const old = f.host.getProcess()!;
		vi.mocked(old.kill).mockImplementation(() => {
			f.finish(old);
			return true;
		});
		const restart = lifecycle.mainBuilt(f.start);
		await vi.advanceTimersByTimeAsync(3000);
		await restart;
		expect(old.kill).toHaveBeenCalledWith("SIGKILL");
		expect(f.start).toHaveBeenCalledTimes(2);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("refuses to create another copy when the old process cannot be stopped", async () => {
		vi.useFakeTimers();
		const f = fixture();
		const lifecycle = createElectronDevLifecycle(f.host);
		await lifecycle.mainBuilt(f.start);
		const failure = expect(lifecycle.mainBuilt(f.start)).rejects.toThrow("restart cancelled");
		await vi.advanceTimersByTimeAsync(5000);
		await failure;
		expect(f.start).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("allows a later build to retry after a failed startup", async () => {
		const f = fixture();
		const lifecycle = createElectronDevLifecycle(f.host);
		f.start.mockRejectedValueOnce(new Error("spawn failed"));
		await expect(lifecycle.mainBuilt(f.start)).rejects.toThrow("spawn failed");
		await lifecycle.mainBuilt(f.start);
		expect(f.children).toHaveLength(1);
	});
	it("reaps real child processes through a burst of rebuilds", async () => {
		const children: ChildProcess[] = [];
		let current: ChildProcess | undefined;
		const lifecycle = createElectronDevLifecycle({
			getProcess: () => current,
			clearProcess: (child) => {
				if (current === child) current = undefined;
			},
			stopProcessTree: (pid) => {
				process.kill(pid, "SIGTERM");
			},
		});
		const start = async () => {
			expect(
				children.filter((child) => child.exitCode === null && child.signalCode === null),
			).toHaveLength(0);
			current = spawn(
				process.execPath,
				["-e", 'process.send("ready"); setInterval(() => {}, 1000)'],
				{ stdio: ["ignore", "ignore", "ignore", "ipc"] },
			);
			children.push(current);
			await once(current, "message");
		};
		try {
			await Promise.all([lifecycle.mainBuilt(start), lifecycle.preloadBuilt(start)]);
			await Promise.all([
				lifecycle.mainBuilt(start),
				lifecycle.mainBuilt(start),
				lifecycle.preloadBuilt(start),
			]);
			expect(children).toHaveLength(3);
			expect(
				children.filter((child) => child.exitCode === null && child.signalCode === null),
			).toEqual([current]);
		} finally {
			await Promise.all(
				children.map(async (child) => {
					if (child.exitCode !== null || child.signalCode !== null) return;
					const exited = once(child, "exit");
					child.kill("SIGKILL");
					await exited;
				}),
			);
		}
	});
});
