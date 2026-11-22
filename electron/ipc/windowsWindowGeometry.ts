import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getCursorMonitorExePath } from "./paths/binaries";

const exec = promisify(execFile);

/** Short-lived Win32 probes reuse the shipped helper without starting its cursor monitor. */
export async function readWindowsWindowGeometry(args: string[]): Promise<unknown> {
	const { stdout } = await exec(getCursorMonitorExePath(), args, {
		timeout: 5000,
		windowsHide: true,
		maxBuffer: 4 * 1024 * 1024,
	});
	return JSON.parse(stdout);
}
