type QrSvgPath = {
	path: string;
	size: number;
};

type QrProfile = {
	version: number;
	dataCodewords: number;
	eccCodewords: number;
	alignmentCenters: number[];
};

const LOW_ECC_PROFILES: QrProfile[] = [
	{ version: 1, dataCodewords: 19, eccCodewords: 7, alignmentCenters: [] },
	{ version: 2, dataCodewords: 34, eccCodewords: 10, alignmentCenters: [6, 18] },
	{ version: 3, dataCodewords: 55, eccCodewords: 15, alignmentCenters: [6, 22] },
	{ version: 4, dataCodewords: 80, eccCodewords: 20, alignmentCenters: [6, 26] },
	{ version: 5, dataCodewords: 108, eccCodewords: 26, alignmentCenters: [6, 30] },
];

const FORMAT_MASK = 0x5412;
const FORMAT_DIVISOR = 0x537;
const LOW_ECC_FORMAT_BITS = 1;
const QUIET_ZONE_MODULES = 4;
const PAD_CODEWORDS = [0xec, 0x11];
const FINDER_LIKE_PATTERN = [true, false, true, true, true, false, true];

const GF_EXP = new Array<number>(512);
const GF_LOG = new Array<number>(256);

let x = 1;
for (let i = 0; i < 255; i += 1) {
	GF_EXP[i] = x;
	GF_LOG[x] = i;
	x <<= 1;
	if (x & 0x100) {
		x ^= 0x11d;
	}
}
for (let i = 255; i < GF_EXP.length; i += 1) {
	GF_EXP[i] = GF_EXP[i - 255];
}

export function createQrSvgPath(value: string): QrSvgPath | null {
	const matrix = createQrMatrix(value);
	if (!matrix) {
		return null;
	}

	const size = matrix.length + QUIET_ZONE_MODULES * 2;
	const path = matrix
		.flatMap((row, rowIndex) =>
			row.flatMap((dark, colIndex) =>
				dark
					? [`M${colIndex + QUIET_ZONE_MODULES} ${rowIndex + QUIET_ZONE_MODULES}h1v1h-1z`]
					: [],
			),
		)
		.join("");

	return { path, size };
}

function createQrMatrix(value: string): boolean[][] | null {
	const bytes = new TextEncoder().encode(value);
	const profile = selectProfile(bytes.length);
	if (!profile) {
		return null;
	}

	const dataCodewords = createDataCodewords(bytes, profile.dataCodewords);
	const errorCodewords = createErrorCorrectionCodewords(dataCodewords, profile.eccCodewords);
	const codewords = [...dataCodewords, ...errorCodewords];
	const bits = codewords.flatMap((codeword) => intToBits(codeword, 8));
	const base = createBaseMatrix(profile);
	placeDataBits(base.modules, base.reserved, bits);

	let bestMatrix: boolean[][] | null = null;
	let bestPenalty = Number.POSITIVE_INFINITY;

	for (let mask = 0; mask < 8; mask += 1) {
		const candidate = applyMask(base.modules, base.reserved, mask);
		drawFormatBits(candidate, mask);
		const penalty = scorePenalty(candidate);
		if (penalty < bestPenalty) {
			bestPenalty = penalty;
			bestMatrix = candidate;
		}
	}

	return bestMatrix;
}

function selectProfile(byteLength: number): QrProfile | null {
	return (
		LOW_ECC_PROFILES.find((profile) => {
			const capacityBits = profile.dataCodewords * 8;
			const requiredBits = 4 + 8 + byteLength * 8;
			return requiredBits <= capacityBits;
		}) ?? null
	);
}

function createDataCodewords(bytes: Uint8Array, dataCodewordCount: number): number[] {
	const capacityBits = dataCodewordCount * 8;
	const bits = [...intToBits(0b0100, 4), ...intToBits(bytes.length, 8)];
	for (const byte of bytes) {
		bits.push(...intToBits(byte, 8));
	}

	const terminatorLength = Math.min(4, capacityBits - bits.length);
	for (let i = 0; i < terminatorLength; i += 1) {
		bits.push(0);
	}
	while (bits.length % 8 !== 0) {
		bits.push(0);
	}

	const codewords: number[] = [];
	for (let i = 0; i < bits.length; i += 8) {
		codewords.push(bitsToInt(bits.slice(i, i + 8)));
	}
	let padIndex = 0;
	while (codewords.length < dataCodewordCount) {
		codewords.push(PAD_CODEWORDS[padIndex % PAD_CODEWORDS.length]);
		padIndex += 1;
	}

	return codewords;
}

function createErrorCorrectionCodewords(data: number[], degree: number): number[] {
	const generator = createGeneratorPolynomial(degree);
	const message = [...data, ...new Array<number>(degree).fill(0)];

	for (let i = 0; i < data.length; i += 1) {
		const factor = message[i];
		if (factor === 0) {
			continue;
		}
		for (let j = 0; j < generator.length; j += 1) {
			message[i + j] ^= gfMultiply(generator[j], factor);
		}
	}

	return message.slice(message.length - degree);
}

function createGeneratorPolynomial(degree: number): number[] {
	let result = [1];
	for (let i = 0; i < degree; i += 1) {
		const next = new Array<number>(result.length + 1).fill(0);
		for (let j = 0; j < result.length; j += 1) {
			next[j] ^= result[j];
			next[j + 1] ^= gfMultiply(result[j], GF_EXP[i]);
		}
		result = next;
	}
	return result;
}

function gfMultiply(a: number, b: number): number {
	if (a === 0 || b === 0) {
		return 0;
	}
	return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function createBaseMatrix(profile: QrProfile): {
	modules: (boolean | null)[][];
	reserved: boolean[][];
} {
	const size = profile.version * 4 + 17;
	const modules = Array.from({ length: size }, () => new Array<boolean | null>(size).fill(null));
	const reserved = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
	const setFunctionModule = (row: number, col: number, dark: boolean) => {
		if (row < 0 || col < 0 || row >= size || col >= size) {
			return;
		}
		modules[row][col] = dark;
		reserved[row][col] = true;
	};

	drawFinderPattern(setFunctionModule, 0, 0);
	drawFinderPattern(setFunctionModule, 0, size - 7);
	drawFinderPattern(setFunctionModule, size - 7, 0);
	drawAlignmentPatterns(profile, setFunctionModule);
	drawTimingPatterns(size, setFunctionModule);
	reserveFormatAreas(size, setFunctionModule);
	setFunctionModule(profile.version * 4 + 9, 8, true);

	return { modules, reserved };
}

function drawFinderPattern(
	setFunctionModule: (row: number, col: number, dark: boolean) => void,
	row: number,
	col: number,
) {
	for (let y = -1; y <= 7; y += 1) {
		for (let x = -1; x <= 7; x += 1) {
			const inFinder = x >= 0 && x <= 6 && y >= 0 && y <= 6;
			const dark =
				inFinder &&
				(x === 0 ||
					x === 6 ||
					y === 0 ||
					y === 6 ||
					(x >= 2 && x <= 4 && y >= 2 && y <= 4));
			setFunctionModule(row + y, col + x, dark);
		}
	}
}

function drawAlignmentPatterns(
	profile: QrProfile,
	setFunctionModule: (row: number, col: number, dark: boolean) => void,
) {
	for (const row of profile.alignmentCenters) {
		for (const col of profile.alignmentCenters) {
			const overlapsFinder =
				(row === 6 && col === 6) ||
				(row === 6 && col === profile.version * 4 + 10) ||
				(row === profile.version * 4 + 10 && col === 6);
			if (overlapsFinder) {
				continue;
			}
			for (let y = -2; y <= 2; y += 1) {
				for (let x = -2; x <= 2; x += 1) {
					setFunctionModule(row + y, col + x, Math.max(Math.abs(x), Math.abs(y)) !== 1);
				}
			}
		}
	}
}

function drawTimingPatterns(
	size: number,
	setFunctionModule: (row: number, col: number, dark: boolean) => void,
) {
	for (let i = 8; i < size - 8; i += 1) {
		const dark = i % 2 === 0;
		setFunctionModule(6, i, dark);
		setFunctionModule(i, 6, dark);
	}
}

function reserveFormatAreas(
	size: number,
	setFunctionModule: (row: number, col: number, dark: boolean) => void,
) {
	for (let i = 0; i < 9; i += 1) {
		if (i !== 6) {
			setFunctionModule(8, i, false);
			setFunctionModule(i, 8, false);
		}
	}
	for (let i = 0; i < 8; i += 1) {
		setFunctionModule(size - 1 - i, 8, false);
		setFunctionModule(8, size - 1 - i, false);
	}
}

function placeDataBits(modules: (boolean | null)[][], reserved: boolean[][], bits: number[]) {
	const size = modules.length;
	let bitIndex = 0;
	let upward = true;

	for (let right = size - 1; right >= 1; right -= 2) {
		if (right === 6) {
			right -= 1;
		}
		for (let vertical = 0; vertical < size; vertical += 1) {
			const row = upward ? size - 1 - vertical : vertical;
			for (let offset = 0; offset < 2; offset += 1) {
				const col = right - offset;
				if (reserved[row][col]) {
					continue;
				}
				modules[row][col] = bitIndex < bits.length ? bits[bitIndex] === 1 : false;
				bitIndex += 1;
			}
		}
		upward = !upward;
	}
}

function applyMask(
	modules: (boolean | null)[][],
	reserved: boolean[][],
	mask: number,
): boolean[][] {
	return modules.map((row, rowIndex) =>
		row.map((value, colIndex) => {
			const dark = value === true;
			if (reserved[rowIndex][colIndex]) {
				return dark;
			}
			return shouldMask(mask, rowIndex, colIndex) ? !dark : dark;
		}),
	);
}

function shouldMask(mask: number, row: number, col: number): boolean {
	switch (mask) {
		case 0:
			return (row + col) % 2 === 0;
		case 1:
			return row % 2 === 0;
		case 2:
			return col % 3 === 0;
		case 3:
			return (row + col) % 3 === 0;
		case 4:
			return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
		case 5:
			return ((row * col) % 2) + ((row * col) % 3) === 0;
		case 6:
			return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
		case 7:
			return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
		default:
			return false;
	}
}

function drawFormatBits(matrix: boolean[][], mask: number) {
	const size = matrix.length;
	const bits = createFormatBits(mask);
	const getBit = (index: number) => ((bits >> index) & 1) !== 0;

	for (let i = 0; i <= 5; i += 1) {
		matrix[i][8] = getBit(i);
	}
	matrix[7][8] = getBit(6);
	matrix[8][8] = getBit(7);
	matrix[8][7] = getBit(8);
	for (let i = 9; i < 15; i += 1) {
		matrix[8][14 - i] = getBit(i);
	}

	for (let i = 0; i < 8; i += 1) {
		matrix[8][size - 1 - i] = getBit(i);
	}
	for (let i = 8; i < 15; i += 1) {
		matrix[size - 15 + i][8] = getBit(i);
	}
	matrix[size - 8][8] = true;
}

function createFormatBits(mask: number): number {
	const data = (LOW_ECC_FORMAT_BITS << 3) | mask;
	let remainder = data;
	for (let i = 0; i < 10; i += 1) {
		remainder = (remainder << 1) ^ (((remainder >> 9) & 1) === 1 ? FORMAT_DIVISOR : 0);
	}
	return ((data << 10) | (remainder & 0x3ff)) ^ FORMAT_MASK;
}

function scorePenalty(matrix: boolean[][]): number {
	let penalty = 0;
	const size = matrix.length;

	for (let row = 0; row < size; row += 1) {
		penalty += scoreLine(matrix[row]);
		penalty += scoreFinderLikePatterns(matrix[row]);
	}
	for (let col = 0; col < size; col += 1) {
		const column = matrix.map((row) => row[col]);
		penalty += scoreLine(column);
		penalty += scoreFinderLikePatterns(column);
	}
	for (let row = 0; row < size - 1; row += 1) {
		for (let col = 0; col < size - 1; col += 1) {
			const color = matrix[row][col];
			if (
				color === matrix[row][col + 1] &&
				color === matrix[row + 1][col] &&
				color === matrix[row + 1][col + 1]
			) {
				penalty += 3;
			}
		}
	}

	const darkCount = matrix.flat().filter(Boolean).length;
	const percent = (darkCount * 100) / (size * size);
	penalty += Math.floor(Math.abs(percent - 50) / 5) * 10;

	return penalty;
}

function scoreFinderLikePatterns(line: boolean[]): number {
	let penalty = 0;
	for (let i = 0; i <= line.length - FINDER_LIKE_PATTERN.length; i += 1) {
		const matches = FINDER_LIKE_PATTERN.every((value, index) => line[i + index] === value);
		if (!matches) {
			continue;
		}

		const hasLightBefore = i >= 4 && line.slice(i - 4, i).every((value) => value === false);
		const afterStart = i + FINDER_LIKE_PATTERN.length;
		const hasLightAfter =
			afterStart + 4 <= line.length &&
			line.slice(afterStart, afterStart + 4).every((value) => value === false);
		if (hasLightBefore || hasLightAfter) {
			penalty += 40;
		}
	}
	return penalty;
}

function scoreLine(line: boolean[]): number {
	let penalty = 0;
	let runColor = line[0];
	let runLength = 1;

	for (let i = 1; i < line.length; i += 1) {
		if (line[i] === runColor) {
			runLength += 1;
			continue;
		}
		if (runLength >= 5) {
			penalty += runLength - 2;
		}
		runColor = line[i];
		runLength = 1;
	}

	if (runLength >= 5) {
		penalty += runLength - 2;
	}

	return penalty;
}

function intToBits(value: number, length: number): number[] {
	return Array.from({ length }, (_, index) => (value >> (length - 1 - index)) & 1);
}

function bitsToInt(bits: number[]): number {
	return bits.reduce((value, bit) => (value << 1) | bit, 0);
}
