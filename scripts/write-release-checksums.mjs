import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const releaseRoot = path.join(projectRoot, "release");
const outputFileName = process.argv[2] ?? "SHA256SUMS.txt";
const outputPath = path.join(releaseRoot, outputFileName);
const releaseArtifactExtensions = new Set([".AppImage", ".blockmap", ".dmg", ".exe", ".zip", ".zsync"]);

function relativePath(filePath) {
	return path.relative(projectRoot, filePath).replaceAll("\\", "/");
}

function artifactSubjectName(filePath) {
	return path.basename(filePath);
}

function isReleaseArtifact(fileName) {
	if (fileName.startsWith("SHA256SUMS")) {
		return false;
	}

	if (fileName.startsWith("latest") && fileName.endsWith(".yml")) {
		return true;
	}

	return releaseArtifactExtensions.has(path.extname(fileName));
}

function sha256(filePath) {
	return new Promise((resolve, reject) => {
		const hash = createHash("sha256");
		createReadStream(filePath)
			.on("error", reject)
			.on("data", (chunk) => hash.update(chunk))
			.on("end", () => resolve(hash.digest("hex")));
	});
}

if (!existsSync(releaseRoot)) {
	throw new Error("[release-checksums] release directory is missing");
}

const releaseArtifacts = readdirSync(releaseRoot)
	.map((entry) => path.join(releaseRoot, entry))
	.filter((filePath) => statSync(filePath).isFile())
	.filter((filePath) => isReleaseArtifact(path.basename(filePath)))
	.sort((left, right) => relativePath(left).localeCompare(relativePath(right)));

if (releaseArtifacts.length === 0) {
	throw new Error("[release-checksums] no release artifacts found");
}

const checksums = [];
for (const filePath of releaseArtifacts) {
	checksums.push(`${await sha256(filePath)}  ${artifactSubjectName(filePath)}`);
}

writeFileSync(outputPath, `${checksums.join("\n")}\n`);
console.log(`[release-checksums] wrote ${relativePath(outputPath)}`);
for (const artifact of releaseArtifacts) {
	console.log(`[release-checksums] ${relativePath(artifact)}`);
}
