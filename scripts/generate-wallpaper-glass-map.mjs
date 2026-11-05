// Bake a rounded-rectangle lens map once, rather than generating one per tile.
// SDF/refraction approach: https://github.com/rdev/liquid-glass-react (MIT).
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const width = 256;
const height = 192;
const radius = 30;
const rim = 11;
const pixels = Buffer.alloc(height * (1 + width * 3));

for (let y = 0; y < height; y++) {
	for (let x = 0; x < width; x++) {
		const px = x + 0.5 - width / 2;
		const py = y + 0.5 - height / 2;
		const qx = Math.abs(px) - width / 2 + radius;
		const qy = Math.abs(py) - height / 2 + radius;
		const ox = Math.max(qx, 0);
		const oy = Math.max(qy, 0);
		const length = Math.hypot(ox, oy);
		const distance = length + Math.min(Math.max(qx, qy), 0) - radius;
		const nx = length ? (ox / length) * Math.sign(px) : qx > qy ? Math.sign(px) : 0;
		const ny = length ? (oy / length) * Math.sign(py) : qy >= qx ? Math.sign(py) : 0;
		const t = Math.max(0, Math.min(1, 1 + distance / rim));
		const bend = t * t * (3 - 2 * t);
		const offset = y * (1 + width * 3) + 1 + x * 3;
		// R = horizontal and B = vertical, matching the upstream SVG filter.
		pixels[offset] = Math.round(128 - nx * bend * 120);
		// G is a rim mask: the original center is composited back without filtering.
		pixels[offset + 1] = Math.round(bend * 255);
		pixels[offset + 2] = Math.round(128 - ny * bend * 120);
	}
}

function chunk(type, data) {
	const name = Buffer.from(type);
	let crc = 0xffffffff;
	for (const byte of Buffer.concat([name, data])) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	}
	const size = Buffer.alloc(4);
	size.writeUInt32BE(data.length);
	const checksum = Buffer.alloc(4);
	checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
	return Buffer.concat([size, name, data, checksum]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(width, 0);
header.writeUInt32BE(height, 4);
header[8] = 8;
header[9] = 2;
writeFileSync(
	new URL("../src/assets/liquid-glass/displacement.png", import.meta.url),
	Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(pixels)),
		chunk("IEND", Buffer.alloc(0)),
	]),
);
