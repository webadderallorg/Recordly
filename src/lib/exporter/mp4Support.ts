export const DEFAULT_MP4_CODEC = "avc1.640033";
export const MP4_CODEC_FALLBACK_LIST = [
	DEFAULT_MP4_CODEC,
	"avc1.640034", // H.264 level 5.2 supports 4K at 60 FPS.
	"avc1.4d4033",
	"avc1.420033",
	"avc1.4d401f",
	"avc1.42001f",
] as const;

export type SupportedMp4EncoderPath = {
	codec: string;
	hardwareAcceleration: "prefer-hardware" | "prefer-software";
};

export type SupportedMp4Dimensions = {
	width: number;
	height: number;
	capped: boolean;
	encoderPath: SupportedMp4EncoderPath | null;
};

type ResolveMp4EncoderPathOptions = {
	width: number;
	height: number;
	frameRate: number;
	bitrate: number;
	codec?: string;
};

type ProbeSupportedMp4DimensionsOptions = {
	width: number;
	height: number;
	frameRate: number;
	codec?: string;
	getBitrate: (width: number, height: number) => number;
};

const encoderSupportCache = new Map<string, SupportedMp4EncoderPath | null>();
const supportedDimensionCache = new Map<string, SupportedMp4Dimensions>();

function normalizeEvenDimension(value: number): number {
	return Math.max(2, Math.floor(value / 2) * 2);
}

function buildEncoderSupportCacheKey(options: ResolveMp4EncoderPathOptions): string {
	return [
		options.codec ?? DEFAULT_MP4_CODEC,
		options.width,
		options.height,
		options.frameRate,
		options.bitrate,
	].join(":");
}

function scaleDimensions(
	width: number,
	height: number,
	scale: number,
): { width: number; height: number } {
	return {
		width: normalizeEvenDimension(width * scale),
		height: normalizeEvenDimension(height * scale),
	};
}

function appendEncoderCandidate(
	candidates: SupportedMp4EncoderPath[],
	candidate: SupportedMp4EncoderPath | null | undefined,
): void {
	if (!candidate) {
		return;
	}

	const alreadyIncluded = candidates.some((value) => {
		return (
			value.codec === candidate.codec &&
			value.hardwareAcceleration === candidate.hardwareAcceleration
		);
	});

	if (!alreadyIncluded) {
		candidates.push(candidate);
	}
}

export function getOrderedSupportedMp4EncoderCandidates(options: {
	codec?: string;
	preferredEncoderPath?: SupportedMp4EncoderPath | null;
}): SupportedMp4EncoderPath[] {
	const orderedCodecs = Array.from(
		new Set(
			[options.preferredEncoderPath?.codec, options.codec, ...MP4_CODEC_FALLBACK_LIST].filter(
				(value): value is string => typeof value === "string" && value.length > 0,
			),
		),
	);
	const candidates: SupportedMp4EncoderPath[] = [];

	if (options.preferredEncoderPath?.hardwareAcceleration === "prefer-hardware") {
		appendEncoderCandidate(candidates, options.preferredEncoderPath);
	}

	for (const codec of orderedCodecs) {
		appendEncoderCandidate(candidates, {
			codec,
			hardwareAcceleration: "prefer-hardware",
		});
	}

	if (options.preferredEncoderPath?.hardwareAcceleration === "prefer-software") {
		appendEncoderCandidate(candidates, options.preferredEncoderPath);
	}

	for (const codec of orderedCodecs) {
		appendEncoderCandidate(candidates, {
			codec,
			hardwareAcceleration: "prefer-software",
		});
	}

	return candidates;
}

export async function resolveSupportedMp4EncoderPath(
	options: ResolveMp4EncoderPathOptions,
): Promise<SupportedMp4EncoderPath | null> {
	const codec = options.codec ?? DEFAULT_MP4_CODEC;
	const width = normalizeEvenDimension(options.width);
	const height = normalizeEvenDimension(options.height);
	const cacheKey = buildEncoderSupportCacheKey({ ...options, codec, width, height });
	const cachedResult = encoderSupportCache.get(cacheKey);

	if (cachedResult !== undefined) {
		return cachedResult;
	}

	const baseConfig: Omit<VideoEncoderConfig, "hardwareAcceleration"> = {
		codec,
		width,
		height,
		bitrate: options.bitrate,
		framerate: options.frameRate,
		latencyMode: "quality",
		bitrateMode: "variable",
	};

	// Try the same codec paths as the exporter before reducing resolution.
	// A level 5.1 rejection at 4K/60 must not silently shrink the output.
	for (const candidate of getOrderedSupportedMp4EncoderCandidates({ codec })) {
		try {
			const support = await VideoEncoder.isConfigSupported({
				...baseConfig,
				...candidate,
			});
			if (support.supported) {
				encoderSupportCache.set(cacheKey, candidate);
				return candidate;
			}
		} catch {
			// Some platforms throw for unsupported codec profiles; try the next path.
		}
	}

	encoderSupportCache.set(cacheKey, null);
	return null;
}

export async function probeSupportedMp4Dimensions(
	options: ProbeSupportedMp4DimensionsOptions,
): Promise<SupportedMp4Dimensions> {
	const codec = options.codec ?? DEFAULT_MP4_CODEC;
	const normalizedWidth = normalizeEvenDimension(options.width);
	const normalizedHeight = normalizeEvenDimension(options.height);
	const requestedBitrate = options.getBitrate(normalizedWidth, normalizedHeight);
	const dimensionCacheKey = [
		codec,
		normalizedWidth,
		normalizedHeight,
		options.frameRate,
		requestedBitrate,
	].join(":");
	const cachedResult = supportedDimensionCache.get(dimensionCacheKey);

	if (cachedResult) {
		return cachedResult;
	}

	const directPath = await resolveSupportedMp4EncoderPath({
		width: normalizedWidth,
		height: normalizedHeight,
		frameRate: options.frameRate,
		bitrate: requestedBitrate,
		codec,
	});

	if (directPath) {
		const result = {
			width: normalizedWidth,
			height: normalizedHeight,
			capped: false,
			encoderPath: directPath,
		} satisfies SupportedMp4Dimensions;
		supportedDimensionCache.set(dimensionCacheKey, result);
		return result;
	}

	let bestResult: SupportedMp4Dimensions | null = null;
	let low = 1;
	let high = 1000;

	while (low <= high) {
		const mid = Math.floor((low + high) / 2);
		const scale = mid / 1000;
		const candidateDimensions = scaleDimensions(normalizedWidth, normalizedHeight, scale);
		const candidatePath = await resolveSupportedMp4EncoderPath({
			width: candidateDimensions.width,
			height: candidateDimensions.height,
			frameRate: options.frameRate,
			bitrate: options.getBitrate(candidateDimensions.width, candidateDimensions.height),
			codec,
		});

		if (candidatePath) {
			bestResult = {
				width: candidateDimensions.width,
				height: candidateDimensions.height,
				capped:
					candidateDimensions.width !== normalizedWidth ||
					candidateDimensions.height !== normalizedHeight,
				encoderPath: candidatePath,
			};
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}

	const result =
		bestResult ??
		({
			width: normalizedWidth,
			height: normalizedHeight,
			capped: false,
			encoderPath: null,
		} satisfies SupportedMp4Dimensions);

	supportedDimensionCache.set(dimensionCacheKey, result);
	return result;
}
