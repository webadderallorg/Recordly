import { existsSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { IOSHelperProcess } from "./helperProcess";

const binary = path.resolve(
	`electron/native/bin/darwin-${process.arch === "arm64" ? "arm64" : "x64"}/recordly-ios-device-helper`,
);
it.skipIf(process.platform !== "darwin" || !existsSync(binary))(
	"decodes the actual Swift helper hello through the production TypeScript transport without TCC",
	async () => {
		const helper = new IOSHelperProcess({ binaryPath: binary });
		try {
			const event = await helper.request({ command: "hello" });
			expect(event.event).toBe("accepted");
			if (event.event === "accepted")
				expect(event.payload).toMatchObject({
					protocolVersion: 1,
					capabilities: { supportsPause: false },
				});
		} finally {
			await helper.shutdown();
		}
	},
);
