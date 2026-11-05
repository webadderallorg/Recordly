import { expect, it, vi } from "vitest";
import { loadConfigFromFile } from "vite";
import { minify, type MinifyOptions } from "terser";

it("keeps warnings and errors in the packaged renderer so support reports contain logs", async () => {
	const config = await loadConfigFromFile({ command: "build", mode: "ui" });
	const options = config?.config.build?.terserOptions as MinifyOptions;
	expect(options).toBeTruthy();
	const result = await minify(
		'console.log("noise");console.warn("warning evidence");console.error("failure evidence");',
		options,
	);
	const sink = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
	new Function("console", result.code!)(sink);
	expect(sink.log).not.toHaveBeenCalled();
	expect(sink.warn).toHaveBeenCalledWith("warning evidence");
	expect(sink.error).toHaveBeenCalledWith("failure evidence");
});
