import type { SupportDeviceInfo } from "../../../electron/supportDeviceInfo";
import packageInfo from "../../../package.json";
import {
	diagnosticSurface,
	OPERATION_HISTORY_LIMIT,
	type OperationEvent,
	startDiagnosticOperation,
} from "../../shared/operationDiagnostics";
import { type CrashDiagnostic, type CrashView, captureCrash } from "./crashDiagnostics";
import { redactDiagnostic, redactDiagnosticLogEntry } from "./diagnosticRedaction";
import { summarizeExportDiagnostics } from "./exportDiagnosticSummary";
import { getExportDiagnosticLogs } from "./exportDiagnostics";

export { redactDiagnostic } from "./diagnosticRedaction";

const entries: string[] = [];
const pending = new Map<string, string>();
const persisting = new Set<string>();
const recentlyPersisted = new Map<string, number>();
const MAX_PENDING_LOGS = 30;
const MAX_LOGS = 150;
const relatedCrashes: CrashDiagnostic[] = [];
const operations: OperationEvent[] = [];
const inFlightOperations = new Map<string, OperationEvent>();
let installed = false;
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let firstCrash: CrashDiagnostic | undefined;
let lastUnhandledError: (CrashDiagnostic & { kind: "uncaught" | "rejection" }) | undefined;
let view: CrashView = "application";
let windowType = "unknown";

function currentSurface() {
	return diagnosticSurface(view === "application" ? windowType : view);
}

export function beginAppOperation(name: string, parentOperationId?: string) {
	return startDiagnosticOperation(
		(event) => {
			operations.push(event);
			if (operations.length > OPERATION_HISTORY_LIMIT) operations.shift();
			inFlightOperations.delete(event.operationId);
			if (event.phase !== "finish") {
				inFlightOperations.set(event.operationId, event);
				if (inFlightOperations.size > OPERATION_HISTORY_LIMIT) {
					const oldest = inFlightOperations.keys().next().value;
					if (oldest !== undefined) inFlightOperations.delete(oldest);
				}
			}
			if (typeof window !== "undefined")
				window.electronAPI?.recordOperationDiagnostic?.(event);
		},
		{
			name,
			parentOperationId,
			source: "renderer",
			surface: currentSurface(),
		},
	);
}

function activeOperations() {
	return [...inFlightOperations.values()]
		.slice(-8)
		.map(({ name, stage, operationId }) => ({ name, stage, operationId }));
}

export function setDiagnosticView(next: CrashView) {
	if (view === next) return;
	view = next;
	if (typeof document !== "undefined") document.documentElement.dataset.diagnosticView = next;
	recordAppDiagnostic("view changed");
	beginAppOperation(`navigation.${next}`).finish("succeeded");
}

/** Keep handled failures and operation milestones in the user-requested snapshot too. */
export function recordFeedbackDiagnostic(message: string) {
	record("diagnostic", [message]);
}

/** Keep selected app events available even after the renderer exits. */
export function recordAppDiagnostic(message: string, error?: unknown) {
	try {
		record("diagnostic", error === undefined ? [message] : [message, error], "immediate");
	} catch {
		// Diagnostic collection must not change an application's failure path.
	}
}

export function recordReactCrash(error: unknown, componentStack?: string | null) {
	const crash = {
		...captureCrash(error, componentStack ?? "", currentSurface()),
		activeOperations: activeOperations(),
	};
	const previous = relatedCrashes[relatedCrashes.length - 1] ?? firstCrash;
	if (!firstCrash) firstCrash = crash;
	else if (
		previous?.errorName !== crash.errorName ||
		previous.message !== crash.message ||
		previous.stack[0] !== crash.stack[0]
	) {
		// A failed cleanup can throw again while React unmounts the failed view.
		// Preserve the original crash even when later errors have their own stacks.
		relatedCrashes.push(crash);
		if (relatedCrashes.length > 2) relatedCrashes.shift();
	}
	record(
		"error",
		[
			`React crash ${crash.errorName}: ${[crash.message, ...crash.stack, ...crash.componentStack].join("\n")}`,
		],
		"immediate",
	);
}

function flushAppDiagnostics() {
	clearTimeout(flushTimer);
	flushTimer = undefined;
	if (!pending.size) return;
	const batch = [...pending].filter(([summary]) => !persisting.has(summary));
	if (!batch.length || !window.electronAPI?.appendAppDiagnostics) return;
	for (const [summary] of batch) {
		pending.delete(summary);
		persisting.add(summary);
	}
	const complete = (success: boolean) => {
		const now = Date.now();
		for (const [summary] of batch) {
			persisting.delete(summary);
			if (success) {
				recentlyPersisted.set(summary, now);
				pending.delete(summary);
			}
		}
		for (const [summary, savedAt] of recentlyPersisted)
			if (now - savedAt >= 1000 || recentlyPersisted.size > MAX_LOGS)
				recentlyPersisted.delete(summary);
		if (pending.size) flushTimer ??= setTimeout(flushAppDiagnostics, 200);
	};
	try {
		void window.electronAPI.appendAppDiagnostics(batch.map(([, entry]) => entry)).then(
			(result) => complete(result.success),
			() => complete(false),
		);
	} catch {
		complete(false);
	}
}

function record(level: string, args: unknown[], persistence?: "batched" | "immediate") {
	// Do not serialize arbitrary objects: they may contain session or project data.
	const message = args
		.map((value) =>
			value instanceof Error
				? [
						`${value.name}: ${value.message}`,
						...captureCrash(value, "", currentSurface()).stack.slice(0, 4),
					].join("\n")
				: typeof value === "string"
					? value
					: `[${typeof value}]`,
		)
		.join(" ");
	const summary = `${level}: [${currentSurface()}] ${redactDiagnostic(message)}`;
	const entry = `${new Date().toISOString()} ${summary}`;
	entries.push(entry);
	if (entries.length > MAX_LOGS) entries.shift();
	if (!persistence || typeof window === "undefined" || !window.electronAPI?.appendAppDiagnostics)
		return;
	const savedAt = recentlyPersisted.get(summary);
	if (savedAt !== undefined && Date.now() - savedAt < 1000) return;
	// Coalesce identical messages and retain only the latest entries in a burst.
	pending.delete(summary);
	pending.set(summary, entry);
	if (pending.size > MAX_PENDING_LOGS) {
		const oldest = pending.keys().next().value;
		if (oldest !== undefined) pending.delete(oldest);
	}
	if (persistence === "immediate") flushAppDiagnostics();
	else flushTimer ??= setTimeout(flushAppDiagnostics, 200);
}
export function installFeedbackDiagnostics() {
	if (installed) return;
	installed = true;
	const type = new URLSearchParams(window.location?.search).get("windowType") ?? "";
	if (
		/^(editor|hud-overlay|source-selector|countdown|update-toast|capture-picker|onboarding|onboarding-intro|permission-accessory)$/.test(
			type,
		)
	)
		windowType = type;
	if (windowType === "editor") {
		view = document.documentElement.dataset.startupView === "home" ? "home" : "editor";
		document.documentElement.dataset.diagnosticView = view;
		recordAppDiagnostic("renderer started");
	}
	if (windowType !== "unknown") beginAppOperation("app.renderer-start").finish("succeeded");
	for (const level of ["warn", "error"] as const) {
		const original = console[level].bind(console);
		console[level] = (...args: unknown[]) => {
			try {
				record(level, args, "batched");
			} catch {
				// Diagnostic collection must not interfere with the original console call.
			}
			original(...args);
		};
	}
	function recordUnhandled(level: "uncaught" | "rejection", error: unknown) {
		const crash = captureCrash(error, "", currentSurface());
		lastUnhandledError = { ...crash, kind: level, activeOperations: activeOperations() };
		const operation = beginAppOperation("app.unhandled-error");
		operation.step(level);
		operation.finish("failed");
		record(
			level,
			[`${crash.errorName}: ${[crash.message, ...crash.stack].join("\n")}`],
			"immediate",
		);
	}
	window.addEventListener("error", (event) =>
		recordUnhandled("uncaught", event.error ?? event.message),
	);
	window.addEventListener("unhandledrejection", (event) =>
		recordUnhandled("rejection", event.reason),
	);
	window.addEventListener("pagehide", flushAppDiagnostics);
}
const MAX_DIAGNOSTIC_BYTES = 290_000;
export function feedbackDiagnostics(
	persistedLogs: string[] = [],
	crash?: CrashDiagnostic,
	runtime?: RendererExportRuntimeInfo,
	desktop?: { operations?: OperationEvent[]; appRunId?: string; windowId?: number },
	device?: SupportDeviceInfo,
) {
	const history = new Map<string, OperationEvent>();
	for (const event of [...operations, ...(desktop?.operations ?? [])])
		history.set(`${event.operationId}:${event.sequence}`, event);
	const operationHistory = [...history.values()]
		.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.sequence - b.sequence)
		.slice(-OPERATION_HISTORY_LIMIT);
	const metadata = {
		capturedAt: new Date().toISOString(),
		appVersion: packageInfo.version,
		windowType,
		view: currentSurface(),
		platform: navigator.platform.slice(0, 2000),
		userAgent: navigator.userAgent.slice(0, 2000),
		runtime,
		device,
		viewport:
			typeof window !== "undefined" && Number.isFinite(window.devicePixelRatio)
				? {
						widthCssPx: window.innerWidth,
						heightCssPx: window.innerHeight,
						devicePixelRatio: window.devicePixelRatio,
					}
				: undefined,
		crash,
		lastUnhandledError,
		relatedCrashes: relatedCrashes.length ? relatedCrashes : undefined,
		appRunId: desktop?.appRunId,
		windowId: desktop?.windowId,
		operationHistoryVersion: 1,
	};
	const chronological = [
		...new Set([...entries, ...persistedLogs].map(redactDiagnosticLogEntry)),
	].sort((a, b) => a.slice(0, 24).localeCompare(b.slice(0, 24)));
	const lastSeen = new Map<string, number>();
	const logs = chronological.filter((entry) => {
		const timestamp = Date.parse(entry.slice(0, 24));
		if (!Number.isFinite(timestamp)) return true;
		const message = entry.slice(25);
		const previous = lastSeen.get(message);
		if (previous !== undefined && timestamp - previous < 1000) return false;
		lastSeen.set(message, timestamp);
		return true;
	});
	const encoder = new TextEncoder();
	const recentExports = summarizeExportDiagnostics(logs, operationHistory, desktop?.appRunId);
	const summary = recentExports.length ? recentExports : undefined;
	let payload = JSON.stringify({ ...metadata, recentExports: summary, operationHistory, logs });
	while (
		encoder.encode(payload).byteLength > MAX_DIAGNOSTIC_BYTES &&
		(logs.length || operationHistory.length)
	) {
		if (logs.length) logs.shift();
		else operationHistory.shift();
		payload = JSON.stringify({ ...metadata, recentExports: summary, operationHistory, logs });
	}
	return payload;
}

/** Keep bridge failures or stalls from blocking a user-requested report. */
async function readDesktopDiagnostic<T>(read: () => Promise<T> | undefined) {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			read(),
			new Promise<undefined>((resolve) => {
				timeout = setTimeout(() => resolve(undefined), 1500);
			}),
		]);
	} catch {
		return undefined;
	} finally {
		clearTimeout(timeout);
	}
}

export async function collectFeedbackDiagnostics() {
	flushAppDiagnostics();
	const [app, runtime, device, exportLogs] = await Promise.all([
		readDesktopDiagnostic(() => window.electronAPI?.getAppDiagnostics?.()),
		readDesktopDiagnostic(() => window.electronAPI?.getExportRuntimeInfo?.()),
		readDesktopDiagnostic(() => window.electronAPI?.getSupportDeviceInfo?.()),
		getExportDiagnosticLogs(),
	]);
	return feedbackDiagnostics(
		[...(app?.success ? app.logs : []), ...exportLogs],
		firstCrash,
		runtime?.success ? runtime.runtime : undefined,
		app?.success ? app : undefined,
		device?.success ? device.device : undefined,
	);
}
