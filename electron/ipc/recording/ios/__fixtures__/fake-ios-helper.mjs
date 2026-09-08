import readline from "node:readline";
import fs from "node:fs";

const scenario = process.argv[2];
let sequence = 0;
const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
	const command = JSON.parse(line);
	if (command.command === "shutdown") {
		input.close();
		process.exit(0);
	}
	if (scenario === "crash") process.exit(2);
	if (scenario === "silent") return;
	if (scenario === "malformed") {
		process.stdout.write("broken\n");
		return;
	}
	if (scenario === "bad-preview") fs.writeSync(3, Buffer.alloc(24));
	const event =
		JSON.stringify({
			protocolVersion: 1,
			event: "accepted",
			requestId: command.requestId,
			sequence: ++sequence,
			payload: {
				build: "test",
				protocolVersion: 1,
				capabilities: {
					supportsPause: false,
					supportsWebcam: false,
					supportsTouchTelemetry: false,
					previewMaxLongestEdge: 480,
					previewMaxFramesPerSecond: 5,
					previewMaxJpegBytes: 131072,
					protocolVersion: 1,
				},
			},
		}) + "\n";
	if (scenario === "split") {
		process.stderr.write("x".repeat(32768));
		process.stdout.write(event.slice(0, 20));
		setTimeout(() => process.stdout.write(event.slice(20)), 5);
	} else process.stdout.write(event);
});
input.on("close", () => process.exit(0));
