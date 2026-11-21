import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runDbusSend = promisify(execFile);

export async function isWaylandScreenCastMissing(run = runDbusSend): Promise<boolean> {
	try {
		const { stdout } = await run(
			"dbus-send",
			[
				"--session",
				"--print-reply",
				"--reply-timeout=1500",
				"--dest=org.freedesktop.portal.Desktop",
				"/org/freedesktop/portal/desktop",
				"org.freedesktop.DBus.Introspectable.Introspect",
			],
			{ timeout: 2000 },
		);
		return (
			/<node(?:\s|>)/.test(stdout) &&
			!/<interface\s+name=["']org\.freedesktop\.portal\.ScreenCast["']/.test(stdout)
		);
	} catch (error) {
		return (
			!!error &&
			typeof error === "object" &&
			"stderr" in error &&
			typeof error.stderr === "string" &&
			/^Error org\.freedesktop\.DBus\.Error\.(?:ServiceUnknown|NameHasNoOwner):/.test(
				error.stderr,
			)
		);
	}
}
