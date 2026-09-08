import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { IOSHelperProcess } from "./helperProcess";

const helpers: IOSHelperProcess[] = [];
function helper(scenario = "normal") {
	const result = new IOSHelperProcess({
		binaryPath: process.execPath,
		args: [
			path.resolve("electron/ipc/recording/ios/__fixtures__/fake-ios-helper.mjs"),
			scenario,
		],
		requestTimeoutMs: 200,
	});
	helpers.push(result);
	return result;
}
afterEach(async () => {
	await Promise.all(helpers.splice(0).map((h) => h.shutdown()));
});

it("handshakes with an actual child, including split output and stderr flood", async () => {
	const client = helper("split");
	const hello = await client.request({ command: "hello" });
	expect(hello.event).toBe("accepted");
	expect(client.diagnosticBytes).toBeLessThanOrEqual(8192);
});
it("rejects malformed protocol and pending commands on child crash", async () => {
	await expect(helper("malformed").request({ command: "hello" })).rejects.toThrow();
	await expect(helper("crash").request({ command: "hello" })).rejects.toThrow("HELPER_EXITED");
});
it("bounds pending requests and times out an unresponsive helper", async () => {
	const client = helper("silent");
	const pending = Array.from({ length: 8 }, () =>
		client.request({ command: "hello" }).catch((e: Error) => e.message),
	);
	await expect(client.request({ command: "hello" })).rejects.toThrow("RECORDING_BUSY");
	expect(await Promise.all(pending)).toEqual(Array(8).fill("HELPER_UNAVAILABLE"));
});
it("warns once for an invalid preview while continuing the control protocol", async () => {
	const client = helper("bad-preview");
	const warning = vi.fn();
	client.onWarning(warning);
	await client.request({ command: "hello" });
	await vi.waitFor(() => expect(warning).toHaveBeenCalledWith("PREVIEW_UNAVAILABLE"));
	expect((await client.request({ command: "hello" })).event).toBe("accepted");
	expect(warning).toHaveBeenCalledOnce();
});
