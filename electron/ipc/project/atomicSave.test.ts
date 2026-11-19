import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	getProjectStorageKey,
	getProjectBackupPath,
	getLegacyProjectBackupPath,
	readProjectFileWithRecovery,
	writeProjectFileAtomically,
} from "./atomicSave";

describe("writeProjectFileAtomically", () => {
	let tempDir: string;
	let projectPath: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-atomic-project-"));
		projectPath = path.join(tempDir, "demo.recordly");
	});

	afterEach(async () => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	async function expectNoTemporaryArtifacts() {
		const entries = await fs.readdir(tempDir);
		expect(entries.filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
	}

	it("commits a complete new project without creating a backup", async () => {
		await writeProjectFileAtomically(projectPath, '{"version":1}');

		await expect(fs.readFile(projectPath, "utf-8")).resolves.toBe('{"version":1}');
		await expect(fs.access(await getProjectBackupPath(projectPath))).rejects.toMatchObject({
			code: "ENOENT",
		});
		await expectNoTemporaryArtifacts();
	});

	it("removes a stale backup when the target has no previous generation", async () => {
		await fs.mkdir(path.dirname(await getProjectBackupPath(projectPath)), { recursive: true });
		await fs.writeFile(await getProjectBackupPath(projectPath), "stale-project");

		await writeProjectFileAtomically(projectPath, '{"version":1}');

		await expect(fs.access(await getProjectBackupPath(projectPath))).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	it("preserves the previous complete generation before replacement", async () => {
		await writeProjectFileAtomically(projectPath, '{"version":1,"name":"old"}');
		await writeProjectFileAtomically(projectPath, '{"version":1,"name":"new"}');

		await expect(fs.readFile(projectPath, "utf-8")).resolves.toBe('{"version":1,"name":"new"}');
		await expect(fs.readFile(await getProjectBackupPath(projectPath), "utf-8")).resolves.toBe(
			'{"version":1,"name":"old"}',
		);
		await expectNoTemporaryArtifacts();
	});

	it("keeps the active generation unchanged when backup commit fails", async () => {
		await writeProjectFileAtomically(projectPath, '{"version":1,"name":"old"}');
		await fs.mkdir(await getProjectBackupPath(projectPath), { recursive: true });

		await expect(
			writeProjectFileAtomically(projectPath, '{"version":1,"name":"new"}'),
		).rejects.toBeDefined();

		await expect(fs.readFile(projectPath, "utf-8")).resolves.toBe('{"version":1,"name":"old"}');
		await expectNoTemporaryArtifacts();

		await fs.rm(await getProjectBackupPath(projectPath), { recursive: true });
		await writeProjectFileAtomically(projectPath, '{"version":1,"name":"retry"}');
		await expect(fs.readFile(projectPath, "utf-8")).resolves.toBe(
			'{"version":1,"name":"retry"}',
		);
		await expect(fs.readFile(await getProjectBackupPath(projectPath), "utf-8")).resolves.toBe(
			'{"version":1,"name":"old"}',
		);
		await expectNoTemporaryArtifacts();
	});

	it("serializes overlapping writes to the same project", async () => {
		await writeProjectFileAtomically(projectPath, '{"revision":1}');

		// Each call enters the queue synchronously before its first await, preserving invocation order.
		await Promise.all([
			writeProjectFileAtomically(projectPath, '{"revision":2}'),
			writeProjectFileAtomically(projectPath, '{"revision":3}'),
		]);

		await expect(fs.readFile(projectPath, "utf-8")).resolves.toBe('{"revision":3}');
		await expect(fs.readFile(await getProjectBackupPath(projectPath), "utf-8")).resolves.toBe(
			'{"revision":2}',
		);
		await expectNoTemporaryArtifacts();
	});

	it("keeps only the document visible and migrates an old visible backup after durable save", async () => {
		await fs.writeFile(projectPath, '{"revision":1}');
		await fs.writeFile(getLegacyProjectBackupPath(projectPath), '{"revision":0}');
		await writeProjectFileAtomically(projectPath, '{"revision":2}');
		expect((await fs.readdir(tempDir)).filter((name) => !name.startsWith("."))).toEqual([
			"demo.recordly",
		]);
		expect(await fs.readFile(await getProjectBackupPath(projectPath), "utf-8")).toBe(
			'{"revision":1}',
		);
	});

	it("uses distinct recovery paths for identical project names in different directories", async () => {
		expect(await getProjectBackupPath(path.join(tempDir, "a", "demo.recordly"))).not.toBe(
			await getProjectBackupPath(path.join(tempDir, "b", "demo.recordly")),
		);
	});

	it("recovers through a parent directory alias even when the primary is missing", async () => {
		const realDir = path.join(tempDir, "real");
		const aliasDir = path.join(tempDir, "alias");
		await fs.mkdir(realDir);
		await fs.symlink(realDir, aliasDir, process.platform === "win32" ? "junction" : "dir");
		const realProject = path.join(realDir, "demo.recordly");
		const aliasProject = path.join(aliasDir, "demo.recordly");
		await writeProjectFileAtomically(realProject, '{"revision":1}');
		await writeProjectFileAtomically(realProject, '{"revision":2}');
		expect(await getProjectBackupPath(aliasProject)).toBe(
			await getProjectBackupPath(realProject),
		);
		await fs.writeFile(realProject, "damaged");
		await expect(readProjectFileWithRecovery(aliasProject, JSON.parse)).resolves.toMatchObject({
			project: { revision: 1 },
			recovered: true,
		});
		await fs.unlink(realProject);
		await expect(readProjectFileWithRecovery(aliasProject, JSON.parse)).resolves.toMatchObject({
			project: { revision: 1 },
			recovered: true,
		});
	});

	it("matches the filesystem case policy without merging distinct case-sensitive files", async () => {
		const upper = path.join(tempDir, "Case.recordly");
		const lower = path.join(tempDir, "case.recordly");
		await fs.writeFile(upper, '{"revision":1}');
		const lowerExists = await fs.access(lower).then(
			() => true,
			() => false,
		);
		if (lowerExists) {
			expect(await getProjectBackupPath(upper)).toBe(await getProjectBackupPath(lower));
			await fs.unlink(upper);
			expect(await getProjectBackupPath(upper)).toBe(await getProjectBackupPath(lower));
		} else {
			expect(await getProjectBackupPath(upper)).not.toBe(await getProjectBackupPath(lower));
		}
	});

	it("serializes simultaneous saves through different parent aliases", async () => {
		const actual = path.join(tempDir, "actual");
		const alias = path.join(tempDir, "alias");
		await fs.mkdir(actual);
		await fs.symlink(actual, alias, process.platform === "win32" ? "junction" : "dir");
		const target = path.join(actual, "demo.recordly");
		await writeProjectFileAtomically(target, '{"revision":1}');
		await Promise.all([
			writeProjectFileAtomically(target, '{"revision":2}'),
			writeProjectFileAtomically(path.join(alias, "demo.recordly"), '{"revision":3}'),
		]);
		expect(await fs.readFile(target, "utf-8")).toBe('{"revision":3}');
		expect(await fs.readFile(await getProjectBackupPath(target), "utf-8")).toBe(
			'{"revision":2}',
		);
	});

	it.skipIf(process.platform === "win32")(
		"replaces a leaf symlink without changing its target or backup identity",
		async () => {
			const target = path.join(tempDir, "target.recordly");
			await fs.writeFile(target, '{"revision":1}');
			await fs.symlink(target, projectPath);
			const backup = await getProjectBackupPath(projectPath);
			await writeProjectFileAtomically(projectPath, '{"revision":2}');
			expect(await getProjectBackupPath(projectPath)).toBe(backup);
			expect((await fs.lstat(projectPath)).isSymbolicLink()).toBe(false);
			expect(await fs.readFile(target, "utf-8")).toBe('{"revision":1}');
			expect(await fs.readFile(backup, "utf-8")).toBe('{"revision":1}');
		},
	);

	it("can still read a managed backup written under the previous lexical path hash", async () => {
		const key = process.platform === "win32" ? projectPath.toLowerCase() : projectPath;
		const oldBackup = path.join(
			path.dirname(key),
			".recordly-recovery",
			`${createHash("sha256").update(key).digest("hex")}.recordly`,
		);
		await fs.mkdir(path.dirname(oldBackup), { recursive: true });
		await fs.writeFile(oldBackup, '{"revision":1}');
		await fs.writeFile(projectPath, "damaged");
		await expect(readProjectFileWithRecovery(projectPath, JSON.parse)).resolves.toMatchObject({
			project: { revision: 1 },
			recovered: true,
		});
		await writeProjectFileAtomically(projectPath, '{"revision":3}');
		expect(await fs.readFile(await getProjectBackupPath(projectPath), "utf-8")).toBe(
			'{"revision":1}',
		);
		if (oldBackup !== (await getProjectBackupPath(projectPath))) {
			await expect(fs.access(oldBackup)).rejects.toMatchObject({ code: "ENOENT" });
		}
	});

	it.each([
		["managed", "damaged"],
		["legacy", "damaged"],
		["managed", "missing"],
		["legacy", "missing"],
	])("keeps the valid %s generation on direct save with a %s primary", async (kind, state) => {
		const backup =
			kind === "managed"
				? await getProjectBackupPath(projectPath)
				: getLegacyProjectBackupPath(projectPath);
		await fs.mkdir(path.dirname(backup), { recursive: true });
		await fs.writeFile(backup, '{"revision":1}');
		if (state === "damaged") await fs.writeFile(projectPath, '{"broken":');
		await writeProjectFileAtomically(projectPath, '{"revision":3}');
		expect(await fs.readFile(projectPath, "utf-8")).toBe('{"revision":3}');
		expect(await fs.readFile(await getProjectBackupPath(projectPath), "utf-8")).toBe(
			'{"revision":1}',
		);
		await expectNoTemporaryArtifacts();
	});

	it("does not retire an invalid legacy generation unless a valid replacement is durable", async () => {
		await fs.writeFile(projectPath, "damaged primary");
		await fs.writeFile(
			getLegacyProjectBackupPath(projectPath),
			"damaged but potentially repairable backup",
		);
		await writeProjectFileAtomically(projectPath, '{"revision":3}');
		expect(await fs.readFile(getLegacyProjectBackupPath(projectPath), "utf-8")).toBe(
			"damaged but potentially repairable backup",
		);
	});

	it.each([
		"damaged",
		"missing",
	])("recovers a %s primary and keeps the good backup on the next save", async (state) => {
		await writeProjectFileAtomically(projectPath, '{"revision":1}');
		await writeProjectFileAtomically(projectPath, '{"revision":2}');
		if (state === "damaged") await fs.writeFile(projectPath, '{"broken":');
		else await fs.unlink(projectPath);
		await expect(readProjectFileWithRecovery(projectPath, JSON.parse)).resolves.toMatchObject({
			project: { revision: 1 },
			recovered: true,
		});
		await writeProjectFileAtomically(projectPath, '{"revision":3}');
		expect(await fs.readFile(await getProjectBackupPath(projectPath), "utf-8")).toBe(
			'{"revision":1}',
		);
		expect(await fs.readFile(projectPath, "utf-8")).toBe('{"revision":3}');
	});

	it("validates legacy recovery data and never uses an invalid managed generation", async () => {
		await fs.writeFile(projectPath, "broken");
		await fs.mkdir(path.dirname(await getProjectBackupPath(projectPath)), { recursive: true });
		await fs.writeFile(await getProjectBackupPath(projectPath), '{"notAProject":true}');
		await fs.writeFile(getLegacyProjectBackupPath(projectPath), '{"revision":7}');
		const parse = (contents: string) => {
			const value = JSON.parse(contents);
			if (typeof value.revision !== "number") throw new Error("invalid project");
			return value;
		};
		await expect(readProjectFileWithRecovery(projectPath, parse)).resolves.toMatchObject({
			project: { revision: 7 },
			recovered: true,
		});
		await writeProjectFileAtomically(projectPath, '{"revision":8}');
		expect(await fs.readFile(await getProjectBackupPath(projectPath), "utf-8")).toBe(
			'{"revision":7}',
		);
		await expect(fs.access(getLegacyProjectBackupPath(projectPath))).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	it("rejects recovery if neither generation passes document validation", async () => {
		await fs.writeFile(projectPath, "broken primary");
		await fs.writeFile(getLegacyProjectBackupPath(projectPath), "broken backup");
		await expect(readProjectFileWithRecovery(projectPath, JSON.parse)).rejects.toThrow();
		expect(await fs.readFile(projectPath, "utf-8")).toBe("broken primary");
	});

	it.skipIf(process.platform === "win32")(
		"preserves exact project permission bits despite the process umask",
		async () => {
			await fs.writeFile(projectPath, '{"revision":1}', { mode: 0o666 });
			await fs.chmod(projectPath, 0o666);
			const previousUmask = process.umask(0o077);

			try {
				await writeProjectFileAtomically(projectPath, '{"revision":2}');
			} finally {
				process.umask(previousUmask);
			}

			expect((await fs.stat(projectPath)).mode & 0o777).toBe(0o666);
		},
	);
	function deferred() {
		let resolve!: () => void;
		const promise = new Promise<void>((done) => {
			resolve = done;
		});
		return { promise, resolve };
	}

	it("keeps the event loop available while filesystem identity is pending", async () => {
		await fs.writeFile(projectPath, '{"revision":1}');
		const canonicalParent = await fs.realpath(tempDir);
		const release = deferred();
		vi.spyOn(fs, "realpath").mockImplementationOnce(async () => {
			await release.promise;
			return canonicalParent;
		});
		const identity = getProjectStorageKey(projectPath);
		try {
			expect(identity).toBeInstanceOf(Promise);
			let settled = false;
			void identity.then(() => {
				settled = true;
			});
			await new Promise<void>((done) => setImmediate(done));
			expect(settled).toBe(false);
		} finally {
			release.resolve();
			await identity;
		}
	});

	it("preserves invocation order when a later alias identity resolves first", async () => {
		await writeProjectFileAtomically(projectPath, '{"revision":1}');
		const alias = path.join(tempDir, "alias");
		await fs.symlink(tempDir, alias, process.platform === "win32" ? "junction" : "dir");
		const canonicalParent = await fs.realpath(tempDir);
		const parentStats = await fs.stat(tempDir);
		const firstIdentity = deferred();
		const secondIdentity = deferred();
		vi.spyOn(fs, "realpath")
			.mockImplementationOnce(async () => {
				await firstIdentity.promise;
				return canonicalParent;
			})
			.mockImplementationOnce(async () => {
				secondIdentity.resolve();
				return canonicalParent;
			});
		vi.spyOn(fs, "stat").mockResolvedValue(parentStats);
		const first = writeProjectFileAtomically(
			path.join(alias, "demo.recordly"),
			'{"revision":2}',
		);
		const second = writeProjectFileAtomically(projectPath, '{"revision":3}');
		try {
			await secondIdentity.promise;
			// All later identity microtasks finish while the first identity is held.
			await new Promise<void>((done) => setImmediate(done));
			firstIdentity.resolve();
			await Promise.all([first, second]);
		} finally {
			firstIdentity.resolve();
			await Promise.allSettled([first, second]);
			vi.restoreAllMocks();
		}
		expect(await fs.readFile(projectPath, "utf-8")).toBe('{"revision":3}');
		expect(await fs.readFile(await getProjectBackupPath(projectPath), "utf-8")).toBe(
			'{"revision":2}',
		);
	});

	it("releases admission after identity failure without poisoning the next write", async () => {
		const other = path.join(tempDir, "other.recordly");
		const denied = Object.assign(new Error("Identity access denied"), { code: "EACCES" });
		vi.spyOn(fs, "realpath").mockRejectedValueOnce(denied);
		const failed = writeProjectFileAtomically(projectPath, '{"revision":1}');
		const next = writeProjectFileAtomically(other, '{"revision":2}');
		await expect(failed).rejects.toBe(denied);
		await next;
		expect(await fs.readFile(other, "utf-8")).toBe('{"revision":2}');
		await expect(fs.access(projectPath)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("admits another project while an earlier project's disk commit is pending", async () => {
		const other = path.join(tempDir, "other.recordly");
		await writeProjectFileAtomically(projectPath, '{"revision":1}');
		await writeProjectFileAtomically(other, '{"revision":1}');
		const release = deferred();
		const entered = deferred();
		const rename = fs.rename.bind(fs);
		vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
			if (to === projectPath) {
				entered.resolve();
				await release.promise;
			}
			return rename(from, to);
		});
		const first = writeProjectFileAtomically(projectPath, '{"revision":2}');
		await entered.promise;
		const second = writeProjectFileAtomically(other, '{"revision":9}');
		try {
			let finished = false;
			void second.then(() => {
				finished = true;
			});
			await vi.waitFor(() => expect(finished).toBe(true), { timeout: 2000, interval: 10 });
			expect(await fs.readFile(other, "utf-8")).toBe('{"revision":9}');
			expect(await fs.readFile(projectPath, "utf-8")).toBe('{"revision":1}');
		} finally {
			release.resolve();
			await Promise.allSettled([first, second]);
		}
	});
	it("releases unrelated admissions when a filesystem identity never resolves", async () => {
		const other = path.join(tempDir, "other.recordly");
		await writeProjectFileAtomically(projectPath, '{"revision":1}');
		await writeProjectFileAtomically(other, '{"revision":1}');
		const canonicalParent = await fs.realpath(tempDir);
		const parentStats = await fs.stat(tempDir);
		vi.useFakeTimers();
		vi.spyOn(fs, "realpath")
			.mockImplementationOnce(() => new Promise<string>(() => {}))
			.mockResolvedValue(canonicalParent);
		vi.spyOn(fs, "stat").mockResolvedValue(parentStats);
		let firstError: unknown;
		void writeProjectFileAtomically(projectPath, '{"revision":2}').catch((error) => {
			firstError = error;
		});
		const second = writeProjectFileAtomically(other, '{"revision":9}');
		void second.catch(() => undefined);
		await vi.advanceTimersByTimeAsync(0);
		expect(firstError).toBeUndefined();
		await vi.advanceTimersByTimeAsync(5000);
		expect(firstError).toBeInstanceOf(Error);
		expect((firstError as Error).message).toContain("Project location did not respond");
		await second;
		expect(await fs.readFile(other, "utf-8")).toBe('{"revision":9}');
		expect(await fs.readFile(projectPath, "utf-8")).toBe('{"revision":1}');
		expect(vi.getTimerCount()).toBe(0);
	});

	it.each([
		"resolve",
		"reject",
	])("never writes after a timed-out identity later %ss", async (completion) => {
		const other = path.join(tempDir, "other.recordly");
		await writeProjectFileAtomically(projectPath, '{"revision":1}');
		await writeProjectFileAtomically(other, '{"revision":1}');
		const backup = await getProjectBackupPath(projectPath);
		const canonicalParent = await fs.realpath(tempDir);
		const parentStats = await fs.stat(tempDir);
		let resolveIdentity!: (value: string) => void;
		let rejectIdentity!: (error: Error) => void;
		const lateIdentity = new Promise<string>((resolve, reject) => {
			resolveIdentity = resolve;
			rejectIdentity = reject;
		});
		vi.useFakeTimers();
		vi.spyOn(fs, "realpath")
			.mockReturnValueOnce(lateIdentity)
			.mockResolvedValue(canonicalParent);
		vi.spyOn(fs, "stat").mockResolvedValue(parentStats);
		let firstError: unknown;
		void writeProjectFileAtomically(projectPath, '{"revision":2}').catch((error) => {
			firstError = error;
		});
		const second = writeProjectFileAtomically(other, '{"revision":9}');
		void second.catch(() => undefined);
		await vi.advanceTimersByTimeAsync(5000);
		expect(firstError).toBeInstanceOf(Error);
		if (completion === "resolve") resolveIdentity(canonicalParent);
		else rejectIdentity(new Error("Late filesystem failure"));
		await vi.advanceTimersByTimeAsync(0);
		await second;
		// A same-key read joins after any wrongly admitted late write, so it also
		// detects a timeout that rejected only the caller while leaving work queued.
		const read = await readProjectFileWithRecovery(projectPath, JSON.parse);
		expect(read.project).toEqual({ revision: 1 });
		await expect(fs.access(backup)).rejects.toMatchObject({ code: "ENOENT" });
		expect(await fs.readFile(other, "utf-8")).toBe('{"revision":9}');
		expect(vi.getTimerCount()).toBe(0);
	});

	it("clears identity deadlines after successful resolution and immediate failure", async () => {
		vi.useFakeTimers();
		await writeProjectFileAtomically(projectPath, '{"revision":1}');
		expect(vi.getTimerCount()).toBe(0);
		const denied = Object.assign(new Error("Identity access denied"), { code: "EACCES" });
		vi.spyOn(fs, "realpath").mockRejectedValueOnce(denied);
		await expect(writeProjectFileAtomically(projectPath, '{"revision":2}')).rejects.toBe(
			denied,
		);
		expect(vi.getTimerCount()).toBe(0);
		expect(await fs.readFile(projectPath, "utf-8")).toBe('{"revision":1}');
	});
});
