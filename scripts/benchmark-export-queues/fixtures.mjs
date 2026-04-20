import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function ensureBuildArtifacts(config) {
	await fs.access(config.mainEntry);
	await fs.access(config.rendererEntry);
}

export async function createFixtureVideo(ffmpegPath, targetPath, options) {
	const {
		durationSeconds,
		frameRate,
		fixtureWidth,
		fixtureHeight,
		includeAudio = true,
		videoFilter = `testsrc2=size=${fixtureWidth}x${fixtureHeight}:rate=${frameRate}`,
	} = options;
	const args = ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", videoFilter];

	if (includeAudio) {
		args.push(
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=880:sample_rate=48000",
			"-c:a",
			"aac",
			"-b:a",
			"128k",
		);
	} else {
		args.push("-an");
	}

	args.push(
		"-t",
		String(durationSeconds),
		"-c:v",
		"libx264",
		"-preset",
		"veryfast",
		"-pix_fmt",
		"yuv420p",
		"-movflags",
		"+faststart",
		targetPath,
	);

	await execFileAsync(ffmpegPath, args, {
		timeout: 60_000,
		maxBuffer: 20 * 1024 * 1024,
	});
}

function parseDurationSeconds(ffmpegOutput) {
	const match = ffmpegOutput.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
	if (!match) {
		return null;
	}

	return (
		Number.parseInt(match[1], 10) * 3600 +
		Number.parseInt(match[2], 10) * 60 +
		Number.parseFloat(match[3])
	);
}

export async function inspectOutput(ffmpegPath, targetPath) {
	try {
		const { stderr } = await execFileAsync(
			ffmpegPath,
			["-hide_banner", "-i", targetPath, "-f", "null", "-"],
			{
				timeout: 30_000,
				maxBuffer: 20 * 1024 * 1024,
			},
		);
		return parseDurationSeconds(stderr);
	} catch (error) {
		return parseDurationSeconds(String(error?.stderr ?? ""));
	}
}

export async function readSmokeExportReport(outputPath) {
	const reportPath = `${outputPath}.report.json`;

	try {
		const reportContent = await fs.readFile(reportPath, "utf8");
		return {
			reportPath,
			report: JSON.parse(reportContent),
		};
	} catch {
		return null;
	}
}