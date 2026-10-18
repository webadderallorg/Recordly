import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { closePackagedRendererServer, ensurePackagedRendererServer } from "./rendererServer";

const STABLE_URL = "http://127.0.0.1:43823";

/** Resolves true if this call bound the port, false if something else already holds it. */
function occupyStablePort(server: Server) {
	return new Promise<boolean>((resolve, reject) => {
		server.once("listening", () => resolve(true));
		server.once("error", (error: NodeJS.ErrnoException) =>
			error.code === "EADDRINUSE" ? resolve(false) : reject(error),
		);
		server.listen(43823, "127.0.0.1");
	});
}

describe("ensurePackagedRendererServer", () => {
	afterEach(async () => {
		await closePackagedRendererServer();
	});

	it("uses the stable port when it is free", async (context) => {
		const probe = createServer();
		const portIsFree = await occupyStablePort(probe);
		if (portIsFree) {
			await new Promise<void>((resolve) => probe.close(() => resolve()));
		} else {
			context.skip();
		}

		expect(await ensurePackagedRendererServer(__dirname)).toBe(STABLE_URL);
	});

	it("falls back to a random port when the stable one is taken", async () => {
		const blocker = createServer();
		// If something else already holds the port, the scenario under test is already set up.
		const blockerListening = await occupyStablePort(blocker);
		try {
			const url = await ensurePackagedRendererServer(__dirname);
			expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
			expect(url).not.toBe(STABLE_URL);
		} finally {
			if (blockerListening) blocker.close();
		}
	});

	it("closes a server whose startup is still pending", async () => {
		const pending = ensurePackagedRendererServer(__dirname);
		await closePackagedRendererServer();
		const url = await pending;
		const port = Number(new URL(url).port);
		const stillListening = await new Promise<boolean>((resolve) => {
			const probe = createServer();
			probe.once("error", () => resolve(true));
			probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(false)));
		});
		expect(stillListening).toBe(false);
	});
});
