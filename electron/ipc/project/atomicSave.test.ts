import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getProjectBackupPath, writeProjectFileAtomically } from "./atomicSave";

describe("writeProjectFileAtomically", () => {
	let tempDir: string;
	let projectPath: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-atomic-project-"));
		projectPath = path.join(tempDir, "demo.recordly");
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	async function expectNoTemporaryArtifacts() {
		const entries = await fs.readdir(tempDir);
		expect(entries.filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
	}

	it("commits a complete new project without creating a backup", async () => {
		await writeProjectFileAtomically(projectPath, '{"version":1}');

		await expect(fs.readFile(projectPath, "utf-8")).resolves.toBe('{"version":1}');
		await expect(fs.access(getProjectBackupPath(projectPath))).rejects.toMatchObject({
			code: "ENOENT",
		});
		await expectNoTemporaryArtifacts();
		await expectNoTemporaryArtifacts();
	});

	it("removes a stale backup when the target has no previous generation", async () => {
		await fs.writeFile(getProjectBackupPath(projectPath), "stale-project");

		await writeProjectFileAtomically(projectPath, '{"version":1}');

		await expect(fs.access(getProjectBackupPath(projectPath))).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	it("preserves the previous complete generation before replacement", async () => {
		await writeProjectFileAtomically(projectPath, '{"version":1,"name":"old"}');
		await writeProjectFileAtomically(projectPath, '{"version":1,"name":"new"}');

		await expect(fs.readFile(projectPath, "utf-8")).resolves.toBe('{"version":1,"name":"new"}');
		await expect(fs.readFile(getProjectBackupPath(projectPath), "utf-8")).resolves.toBe(
			'{"version":1,"name":"old"}',
		);
		await expectNoTemporaryArtifacts();
	});

	it("keeps the active generation unchanged when backup commit fails", async () => {
		await writeProjectFileAtomically(projectPath, '{"version":1,"name":"old"}');
		await fs.mkdir(getProjectBackupPath(projectPath));

		await expect(
			writeProjectFileAtomically(projectPath, '{"version":1,"name":"new"}'),
		).rejects.toBeDefined();

		await expect(fs.readFile(projectPath, "utf-8")).resolves.toBe('{"version":1,"name":"old"}');
		await expectNoTemporaryArtifacts();

		await fs.rm(getProjectBackupPath(projectPath), { recursive: true });
		await writeProjectFileAtomically(projectPath, '{"version":1,"name":"retry"}');
		await expect(fs.readFile(projectPath, "utf-8")).resolves.toBe(
			'{"version":1,"name":"retry"}',
		);
		await expect(fs.readFile(getProjectBackupPath(projectPath), "utf-8")).resolves.toBe(
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
		await expect(fs.readFile(getProjectBackupPath(projectPath), "utf-8")).resolves.toBe(
			'{"revision":2}',
		);
		await expectNoTemporaryArtifacts();
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
});
