import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const reportPrefix = "RECORDLY_NATIVE_FRAME_TRANSPORT_BENCHMARK ";
const oneMiB = 1024 * 1024;
const payloadSizes = [oneMiB, 33 * oneMiB];
const iterations = parsePositiveInteger(
	process.env.RECORDLY_IPC_BENCH_ITERATIONS ?? "4",
	"RECORDLY_IPC_BENCH_ITERATIONS",
);
const windowSize = parsePositiveInteger(
	process.env.RECORDLY_IPC_BENCH_WINDOW ?? "2",
	"RECORDLY_IPC_BENCH_WINDOW",
);
const timeoutMs = parsePositiveInteger(
	process.env.RECORDLY_IPC_BENCH_TIMEOUT_MS ?? "120000",
	"RECORDLY_IPC_BENCH_TIMEOUT_MS",
);
const keepFixture = process.env.RECORDLY_IPC_BENCH_KEEP_TEMP === "1";

function parsePositiveInteger(value, label) {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`${label} must be a positive integer`);
	}

	return parsed;
}

function createFixtureSources() {
	const mainSource = `
const { app, BrowserWindow, ipcMain, MessageChannelMain } = require("electron");
const path = require("node:path");

let benchmarkWindow = null;
let benchmarkPort = null;
let didReport = false;

function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}

function finishWithError(message) {
	if (didReport) {
		return;
	}

	didReport = true;
	process.stdout.write(
		${JSON.stringify(reportPrefix)} +
			JSON.stringify({ type: "error", message: String(message) }) +
			"\\n",
	);
	setImmediate(() => {
		if (benchmarkWindow && !benchmarkWindow.isDestroyed()) {
			benchmarkWindow.destroy();
		}
		if (app.isReady()) {
			app.quit();
		}
	});
}

function finishWithResult(result) {
	if (didReport) {
		return;
	}

	didReport = true;
	process.stdout.write(
		${JSON.stringify(reportPrefix)} +
			JSON.stringify({ type: "result", result }) +
			"\\n",
	);
	setImmediate(() => {
		if (benchmarkWindow && !benchmarkWindow.isDestroyed()) {
			benchmarkWindow.destroy();
		}
		app.quit();
	});
}

function validateFrame(message) {
	if (!message || typeof message !== "object") {
		throw new Error("Main received a non-object frame message");
	}
	if (!(message.payload instanceof ArrayBuffer)) {
		throw new Error("Main received a frame without an ArrayBuffer payload");
	}

	const bytes = new Uint8Array(message.payload);
	const expectedFirst = message.seq % 251;
	const expectedLast = (message.seq + 1) % 251;
	if (bytes.length === 0 || bytes[0] !== expectedFirst || bytes.at(-1) !== expectedLast) {
		throw new Error(\`Main received corrupt payload for sequence \${message.seq}\`);
	}

	return bytes.byteLength;
}

function installMessagePort(port) {
	benchmarkPort = port;
	benchmarkPort.on("message", (event) => {
		try {
			const message = event.data;
			if (message?.type === "probe") {
				const receivedBytes = validateFrame({ ...message, seq: 0 });
				benchmarkPort.postMessage({ type: "probe-ack", receivedBytes });
				return;
			}
			if (message === null || message === undefined) {
				throw new Error("MessagePortMain delivered no data for the transferable ArrayBuffer probe; this runtime does not support the tested renderer-to-main transfer");
			}
			if (message?.type !== "frame") {
				throw new Error("Main received an unknown MessagePort message");
			}

			const receivedBytes = validateFrame(message);
			benchmarkPort.postMessage({
				type: "ack",
				runId: message.runId,
				seq: message.seq,
				receivedBytes,
			});
		} catch (error) {
			finishWithError(\`MessagePortMain could not receive a transferable frame: \${errorMessage(error)}\`);
		}
	});
	benchmarkPort.start();
}

ipcMain.on("legacy-frame", (event, message) => {
	try {
		const receivedBytes = validateFrame(message);
		event.sender.send("legacy-ack", {
			runId: message.runId,
			seq: message.seq,
			receivedBytes,
		});
	} catch (error) {
		finishWithError(\`ipcRenderer.send could not receive a frame: \${errorMessage(error)}\`);
	}
});

ipcMain.on("benchmark-failed", (_event, message) => {
	finishWithError(\`Renderer benchmark failed: \${String(message?.message ?? message)}\`);
});

ipcMain.on("benchmark-ready", (event) => {
	try {
		if (typeof MessageChannelMain !== "function") {
			throw new Error("MessageChannelMain is unavailable in this Electron runtime");
		}

		const channel = new MessageChannelMain();
		if (!channel.port1 || !channel.port2 || typeof channel.port1.postMessage !== "function") {
			throw new Error("Electron did not provide usable MessagePortMain endpoints");
		}
		installMessagePort(channel.port1);
		event.sender.postMessage("transferable-port", null, [channel.port2]);
		event.sender.send("benchmark-start", {
			payloadSizes: ${JSON.stringify(payloadSizes)},
			iterations: ${iterations},
			windowSize: ${windowSize},
			timeoutMs: ${timeoutMs},
		});
	} catch (error) {
		finishWithError(\`Electron could not establish transferable resources: \${errorMessage(error)}\`);
	}
});

ipcMain.on("benchmark-result", (_event, result) => {
	finishWithResult({
		electronVersion: process.versions.electron ?? "unknown",
		nodeVersion: process.versions.node ?? "unknown",
		platform: process.platform,
		arch: process.arch,
		results: result,
	});
});

app.disableHardwareAcceleration();
app.setPath("userData", path.join(__dirname, "user-data"));
app.setPath("sessionData", path.join(__dirname, "session-data"));
app.commandLine.appendSwitch("disable-gpu");

app.whenReady()
	.then(async () => {
		benchmarkWindow = new BrowserWindow({
			show: false,
			webPreferences: {
				contextIsolation: false,
				nodeIntegration: true,
				sandbox: false,
			},
		});
		benchmarkWindow.webContents.on("did-fail-load", (_event, errorCode, description) => {
			finishWithError(\`Electron could not load the benchmark renderer (\${errorCode}): \${description}\`);
		});
		benchmarkWindow.webContents.on("render-process-gone", (_event, details) => {
			finishWithError(\`Electron renderer exited before completing the benchmark: \${details.reason}\`);
		});
		await benchmarkWindow.loadFile(path.join(__dirname, "renderer.html"));
	})
	.catch((error) => finishWithError(\`Electron could not launch the benchmark fixture: \${errorMessage(error)}\`));
`;

	const rendererSource = `
const { ipcRenderer } = require("electron");

let messagePort = null;
let benchmarkConfig = null;
let probeDetached = false;
let probeComplete = false;
let hasStarted = false;
let activeReject = null;
const legacyRuns = new Map();
const messagePortRuns = new Map();

function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}

function reportFailure(error) {
	const message = errorMessage(error);
	if (activeReject) {
		activeReject(new Error(message));
		return;
	}

	try {
		ipcRenderer.send("benchmark-failed", { message });
	} catch (sendError) {
		console.error(\`Unable to report benchmark failure: \${errorMessage(sendError)}\`);
	}
}

function makePayload(size, sequence) {
	const payload = new ArrayBuffer(size);
	const bytes = new Uint8Array(payload);
	bytes[0] = sequence % 251;
	bytes[size - 1] = (sequence + 1) % 251;
	return payload;
}

function handleAck(runs, message) {
	const run = runs.get(message?.runId);
	if (run) {
		run.ack(message);
	}
}

ipcRenderer.on("legacy-ack", (_event, message) => handleAck(legacyRuns, message));

ipcRenderer.on("transferable-port", (event) => {
	try {
		const candidate = event.ports?.[0];
		if (!candidate || typeof candidate.postMessage !== "function") {
			throw new Error("Electron transferred no usable renderer MessagePort");
		}
		if (typeof candidate.start !== "function") {
			throw new Error("The transferred renderer MessagePort has no start() method");
		}

		messagePort = candidate;
		messagePort.onmessage = (messageEvent) => {
			const message = messageEvent.data;
			if (message?.type === "probe-ack") {
				if (message.receivedBytes !== 2 || !probeDetached) {
					reportFailure(
						"Electron established a MessagePort but did not transfer the probe ArrayBuffer",
					);
					return;
				}
				probeComplete = true;
				maybeStart();
				return;
			}
			if (message?.type === "ack") {
				handleAck(messagePortRuns, message);
			}
		};
		messagePort.start();

		const probe = makePayload(2, 0);
		messagePort.postMessage({ type: "probe", payload: probe }, [probe]);
		probeDetached = probe.byteLength === 0;
		if (!probeDetached) {
			throw new Error("MessagePort.postMessage did not detach the transferred ArrayBuffer");
		}
	} catch (error) {
		reportFailure(\`Electron could not establish transferable ArrayBuffers: \${errorMessage(error)}\`);
	}
});

ipcRenderer.on("benchmark-start", (_event, config) => {
	benchmarkConfig = config;
	maybeStart();
});

function maybeStart() {
	if (hasStarted || !benchmarkConfig || !probeComplete || !messagePort) {
		return;
	}

	hasStarted = true;
	runBenchmark()
		.then((results) => ipcRenderer.send("benchmark-result", results))
		.catch((error) => reportFailure(error));
}

function summarize(values) {
	const sorted = [...values].sort((left, right) => left - right);
	const percentile = (fraction) => {
		const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
		return sorted[index];
	};
	const total = values.reduce((sum, value) => sum + value, 0);
	return {
		averageMs: total / values.length,
		medianMs: percentile(0.5),
		p95Ms: percentile(0.95),
	};
}

function runTransport(route, size, port) {
	return new Promise((resolve, reject) => {
		const runId = \`\${route}-\${size}-\${Date.now()}-\${Math.random()}\`;
		const pending = new Map();
		const ackLatencies = [];
		const detachmentSamples = [];
		let nextSequence = 0;
		let completed = 0;
		let inFlightBytes = 0;
		let peakInFlightBytes = 0;
		let settled = false;
		const startedAt = performance.now();
		const totalBytes = size * benchmarkConfig.iterations;
		const runs = route === "legacy-ipc-send" ? legacyRuns : messagePortRuns;
		const timeout = setTimeout(() => fail(new Error(
			\`\${route} timed out waiting for ACKs at \${formatBytes(size)}\`,
		)), benchmarkConfig.timeoutMs);

		function finish() {
			if (settled) {
				return;
			}
			settled = true;
			activeReject = null;
			clearTimeout(timeout);
			runs.delete(runId);
			const durationMs = performance.now() - startedAt;
			resolve({
				route,
				payloadBytes: size,
				payloadMiB: size / (1024 * 1024),
				iterations: benchmarkConfig.iterations,
				windowSize: benchmarkConfig.windowSize,
				totalBytes,
				durationMs,
				 throughputMiBPerSec: totalBytes / (1024 * 1024) / (durationMs / 1000),
				ackLatencyMs: summarize(ackLatencies),
				peakInFlightPayloadBytes: peakInFlightBytes,
				peakInFlightPayloadMiB: peakInFlightBytes / (1024 * 1024),
				receivedBytes: totalBytes,
				bufferOwnership: {
					semantics:
						route === "message-port-transfer"
							? "sender buffer detached after transfer-list post"
							: "sender buffer remained attached; no transfer list",
					detachedAfterPostCount: detachmentSamples.filter(Boolean).length,
					samples: detachmentSamples.length,
					allDetachedAfterPost: detachmentSamples.every(Boolean),
				},
				physicalZeroCopy: "not measured; ownership transfer does not prove physical zero-copy",
			});
		}

		function fail(error) {
			if (settled) {
				return;
			}
			settled = true;
			activeReject = null;
			clearTimeout(timeout);
			runs.delete(runId);
			reject(error instanceof Error ? error : new Error(String(error)));
		}

		function ack(message) {
			if (settled) {
				return;
			}
			const sent = pending.get(message?.seq);
			if (!sent) {
				fail(new Error(\`\${route} received an unexpected ACK\`));
				return;
			}
			if (message.receivedBytes !== size) {
				fail(new Error(\`\${route} ACK reported \${message.receivedBytes} bytes, expected \${size}\`));
				return;
			}
			pending.delete(message.seq);
			completed += 1;
			inFlightBytes -= sent.bytes;
			ackLatencies.push(performance.now() - sent.sentAt);
			if (completed === benchmarkConfig.iterations) {
				finish();
				return;
			}
			sendAvailable();
		}

		function sendAvailable() {
			while (!settled &&
				nextSequence < benchmarkConfig.iterations &&
				pending.size < benchmarkConfig.windowSize) {
				const sequence = nextSequence;
				nextSequence += 1;
				const payload = makePayload(size, sequence);
				pending.set(sequence, { bytes: size, sentAt: performance.now() });
				inFlightBytes += size;
				peakInFlightBytes = Math.max(peakInFlightBytes, inFlightBytes);
				try {
					if (route === "legacy-ipc-send") {
						ipcRenderer.send("legacy-frame", { runId, seq: sequence, payload });
					} else {
						port.postMessage(
							{ type: "frame", runId, seq: sequence, payload },
							[payload],
						);
					}
					detachmentSamples.push(payload.byteLength === 0);
				} catch (error) {
					fail(new Error(\`\${route} could not send an ArrayBuffer: \${errorMessage(error)}\`));
				}
			}
		}

		runs.set(runId, { ack });
		activeReject = fail;
		sendAvailable();
	});
}

function formatBytes(bytes) {
	return \`\${bytes / (1024 * 1024)} MiB\`;
}

async function runBenchmark() {
	const results = [];
	for (const size of benchmarkConfig.payloadSizes) {
		results.push(await runTransport("legacy-ipc-send", size, null));
		results.push(await runTransport("message-port-transfer", size, messagePort));
	}
	activeReject = null;
	return results;
}

window.addEventListener("error", (event) => reportFailure(event.error ?? new Error(event.message)));
window.addEventListener("unhandledrejection", (event) => reportFailure(event.reason));
ipcRenderer.send("benchmark-ready");
`;

	const htmlSource = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Native frame transport benchmark</title></head>
<body><script>${rendererSource}</script></body>
</html>
`;

	return { mainSource, htmlSource };
}

async function createFixture() {
	const fixtureDirectory = await fs.mkdtemp(
		path.join(os.tmpdir(), "recordly-native-frame-transport-"),
	);
	const sources = createFixtureSources();
	await Promise.all([
		fs.writeFile(path.join(fixtureDirectory, "main.cjs"), sources.mainSource),
		fs.writeFile(path.join(fixtureDirectory, "renderer.html"), sources.htmlSource),
	]);
	return fixtureDirectory;
}

function resolveElectronPath() {
	let electronPath;
	try {
		electronPath = require("electron");
	} catch (error) {
		throw new Error(
			`Electron is not installed or could not be resolved: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (typeof electronPath !== "string" || electronPath.length === 0) {
		throw new Error("The Electron package did not expose an executable path");
	}

	return electronPath;
}

function parseReportLine(line) {
	if (!line.startsWith(reportPrefix)) {
		return null;
	}

	try {
		return JSON.parse(line.slice(reportPrefix.length));
	} catch (error) {
		throw new Error(
			`Electron emitted an invalid benchmark report: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function launchFixture(electronPath, fixtureDirectory) {
	return new Promise((resolve, reject) => {
		let child;
		try {
			child = spawn(
				electronPath,
				["--no-sandbox", "--disable-gpu", path.join(fixtureDirectory, "main.cjs")],
				{
					cwd: fixtureDirectory,
					env: {
						...process.env,
						RECORDLY_IPC_BENCH_ITERATIONS: String(iterations),
						RECORDLY_IPC_BENCH_WINDOW: String(windowSize),
						RECORDLY_IPC_BENCH_TIMEOUT_MS: String(timeoutMs),
					},
					stdio: ["ignore", "pipe", "pipe"],
				},
			);
		} catch (error) {
			reject(
				new Error(
					`Electron could not be launched: ${error instanceof Error ? error.message : String(error)}`,
				),
			);
			return;
		}

		let outputBuffer = "";
		let report = null;
		let timedOut = false;
		let settled = false;
		const timeout = setTimeout(() => {
			timedOut = true;
			child.kill();
		}, timeoutMs + 5000);

		const settle = (callback) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeout);
			callback();
		};

		child.on("error", (error) => {
			settle(() => reject(new Error(`Electron could not be launched: ${error.message}`)));
		});
		child.stdout.on("data", (chunk) => {
			outputBuffer += chunk.toString();
			let newlineIndex = outputBuffer.indexOf("\n");
			while (newlineIndex >= 0) {
				const line = outputBuffer.slice(0, newlineIndex).trim();
				outputBuffer = outputBuffer.slice(newlineIndex + 1);
				if (line.length > 0) {
					const parsed = parseReportLine(line);
					if (parsed) {
						report = parsed;
					}
				}
				newlineIndex = outputBuffer.indexOf("\n");
			}
		});
		child.stderr.on("data", (chunk) => process.stderr.write(chunk));
		child.on("close", (code, signal) => {
			settle(() => {
				if (timedOut) {
					reject(new Error(`Electron benchmark timed out after ${timeoutMs} ms`));
					return;
				}
				if (!report) {
					reject(
						new Error(
							`Electron exited without a benchmark report (code ${code ?? "unknown"}, signal ${signal ?? "none"})`,
						),
					);
					return;
				}
				if (report.type === "error") {
					reject(new Error(report.message));
					return;
				}
				if (code !== 0) {
					reject(new Error(`Electron benchmark exited with code ${code}`));
					return;
				}
				resolve(report.result);
			});
		});
	});
}

function formatNumber(value, digits = 2) {
	return Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

function printReport(report) {
	console.log("Native frame transport benchmark");
	console.log(
		JSON.stringify({
			electronVersion: report.electronVersion,
			nodeVersion: report.nodeVersion,
			platform: report.platform,
			arch: report.arch,
			payloadSizesBytes: payloadSizes,
			iterations,
			windowSize,
			peakInFlightDefinition: "unacknowledged logical payload bytes",
			physicalZeroCopy: "not measured or guaranteed by this benchmark",
		}),
	);
	for (const result of report.results) {
		console.log(
			`${result.route} ${formatNumber(result.payloadMiB, 0)} MiB: ` +
				`throughput=${formatNumber(result.throughputMiBPerSec)} MiB/s, ` +
				`ACK p50=${formatNumber(result.ackLatencyMs.medianMs)} ms, ` +
				`ACK p95=${formatNumber(result.ackLatencyMs.p95Ms)} ms, ` +
				`peakInFlight=${formatNumber(result.peakInFlightPayloadMiB, 0)} MiB, ` +
				`detached=${result.bufferOwnership.detachedAfterPostCount}/${result.bufferOwnership.samples}`,
		);
	}
	console.log(JSON.stringify(report.results));
}

async function main() {
	let fixtureDirectory = null;
	try {
		const electronPath = resolveElectronPath();
		fixtureDirectory = await createFixture();
		const report = await launchFixture(electronPath, fixtureDirectory);
		printReport(report);
	} catch (error) {
		console.error(
			`[benchmark-native-frame-transport] unavailable: ${error instanceof Error ? error.message : String(error)}`,
		);
		console.error(
			"No Recordly project data was used; the benchmark only creates a temporary Electron fixture.",
		);
		process.exitCode = 1;
	} finally {
		if (fixtureDirectory && !keepFixture) {
			await fs.rm(fixtureDirectory, { recursive: true, force: true });
		} else if (fixtureDirectory) {
			console.log(`Temporary fixture retained at ${fixtureDirectory}`);
		}
	}
}

await main();
