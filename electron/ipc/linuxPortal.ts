import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isX11CaptureSession } from "./linuxCaptureSelection";

const execFileAsync = promisify(execFile);

const PORTAL_PROBE_TIMEOUT_MS = 5000;

const PORTAL_DBUS = {
	dest: "org.freedesktop.portal.Desktop",
	objectPath: "/org/freedesktop/portal/desktop",
	interface: "org.freedesktop.portal.ScreenCast",
} as const;

/**
 * Parses the reply of a Properties.Get("version") D-Bus call for the
 * ScreenCast portal interface. Handles both shapes we can spawn:
 *   gdbus:     "(uint32 4,)"
 *   dbus-send: "   variant uint32 4" (+ trailing empty line)
 */
export function parsePortalScreenCastVersionReply(output: string): number | null {
	const match = output.match(/uint32\s+(\d+)/);
	if (!match) return null;
	const version = Number.parseInt(match[1], 10);
	return Number.isFinite(version) && version > 0 ? version : null;
}

type PortalProbeDeps = {
	runDbus: (args: string[]) => Promise<{ stdout: string; stderr: string }>;
};

/**
 * Asks the session portal whether it implements the ScreenCast interface.
 * Tries gdbus first, then dbus-send — between them every mainstream distro
 * has one available. Any version reply means supported; a missing interface,
 * missing portal, or missing tool means not (the caller treats "probe failed"
 * and "no portal" the same way: show the picker).
 */
export async function probePortalScreenCastSupport(
	deps: PortalProbeDeps = { runDbus: (args) => execFileAsync(args[0], args.slice(1), { timeout: PORTAL_PROBE_TIMEOUT_MS }) },
): Promise<boolean> {
	const commands: string[][] = [
		[
			"gdbus",
			"call",
			"--session",
			"--dest",
			PORTAL_DBUS.dest,
			"--object-path",
			PORTAL_DBUS.objectPath,
			"--method",
			"org.freedesktop.DBus.Properties.Get",
			PORTAL_DBUS.interface,
			"version",
		],
		[
			"dbus-send",
			"--session",
			"--print-reply",
			`--dest=${PORTAL_DBUS.dest}`,
			PORTAL_DBUS.objectPath,
			"org.freedesktop.DBus.Properties.Get",
			`string:${PORTAL_DBUS.interface}`,
			"string:version",
		],
	];
	for (const command of commands) {
		try {
			const result = await deps.runDbus(command);
			if (parsePortalScreenCastVersionReply(result.stdout) !== null) {
				return true;
			}
		} catch {
			// Tool missing, portal missing, or interface not implemented —
			// try the next candidate.
		}
	}
	return false;
}

let portalScreenCastProbe: Promise<boolean> | null = null;

function getPortalScreenCastSupport(): Promise<boolean> {
	if (!portalScreenCastProbe) {
		portalScreenCastProbe = probePortalScreenCastSupport().catch(() => false);
	}
	return portalScreenCastProbe;
}

export type SourcePickerVisibilityReason =
	| "not-linux"
	| "wayland-session"
	| "wayland-no-portal"
	| "portal-screencast"
	| "no-portal-screencast";

export type SourcePickerVisibility = {
	show: boolean;
	reason: SourcePickerVisibilityReason;
};

/**
 * The single rule for Recordly's own Screen/Window picker:
 * - non-Linux: always shown (unchanged behavior)
 * - Linux + Wayland with a ScreenCast portal: never shown (portal is the
 *   only capture path)
 * - Linux + Wayland without a ScreenCast portal (e.g. Cinnamon/muffin):
 *   never shown — no capture path exists at all, and the renderer uses this
 *   reason to tell the user to switch to an X11 session instead of letting
 *   getDisplayMedia fail with a cryptic error
 * - Linux + X11 + portal has ScreenCast: hidden (system dialog works —
 *   GNOME/KDE keep today's behavior)
 * - Linux + X11 without portal ScreenCast (or failed probe): shown — the
 *   picker is the only working capture path there, and the safe default
 */
export function resolveSourcePickerVisibility(options: {
	platform: NodeJS.Platform;
	env?: Record<string, string | string[] | undefined>;
	portalScreenCastSupported: boolean;
}): SourcePickerVisibility {
	if (options.platform !== "linux") {
		return { show: true, reason: "not-linux" };
	}
	const env = options.env ?? process.env;
	if (!isX11CaptureSession(env)) {
		return options.portalScreenCastSupported
			? { show: false, reason: "wayland-session" }
			: { show: false, reason: "wayland-no-portal" };
	}
	return options.portalScreenCastSupported
		? { show: false, reason: "portal-screencast" }
		: { show: true, reason: "no-portal-screencast" };
}

export async function getSourcePickerVisibilityForPlatform(
	platform: NodeJS.Platform = process.platform,
): Promise<SourcePickerVisibility> {
	if (platform !== "linux") {
		return resolveSourcePickerVisibility({ platform, portalScreenCastSupported: false });
	}
	const portalScreenCastSupported = await getPortalScreenCastSupport();
	return resolveSourcePickerVisibility({ platform, portalScreenCastSupported });
}
