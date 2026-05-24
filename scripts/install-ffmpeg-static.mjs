import { spawnSync } from "node:child_process";

const maxAttempts = Number.parseInt(process.env.FFMPEG_STATIC_INSTALL_ATTEMPTS ?? "3", 10);
const baseDelayMs = Number.parseInt(process.env.FFMPEG_STATIC_INSTALL_DELAY_MS ?? "2000", 10);

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		const result = spawnSync(process.execPath, ["node_modules/ffmpeg-static/install.js"], {
			stdio: "inherit",
		});

		if (result.status === 0) {
			return;
		}

		if (attempt === maxAttempts) {
			process.exit(result.status ?? 1);
		}

		const delayMs = baseDelayMs * attempt;
		console.warn(
			`[ffmpeg-static] Install attempt ${attempt}/${maxAttempts} failed; retrying in ${delayMs}ms...`,
		);
		await sleep(delayMs);
	}
}

await main();
