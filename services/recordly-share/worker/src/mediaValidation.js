// File signatures reject obvious type spoofing; they do not decode the entire
// recording, establish that it is playable, or scan it for malware.
export const MEDIA_PREFIX_BYTES = 64;
export class InvalidMediaError extends Error {}
const ascii = (bytes, start, end) => String.fromCharCode(...bytes.subarray(start, end));
export function matchesMediaSignature(bytes, contentType, totalSize = Number.MAX_SAFE_INTEGER) {
	if (!(bytes instanceof Uint8Array)) return false;
	switch (contentType) {
		case "video/mp4":
		case "video/quicktime": {
			if (bytes.length < 16 || ascii(bytes, 4, 8) !== "ftyp") return false;
			const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
				0,
			);
			if (size === 1) {
				if (bytes.length < 24) return false;
				const extended = new DataView(
					bytes.buffer,
					bytes.byteOffset,
					bytes.byteLength,
				).getBigUint64(8);
				return extended >= 24n && extended <= BigInt(totalSize);
			}
			return size >= 16 && size <= totalSize;
		}
		case "video/webm":
			return (
				bytes.length >= 4 &&
				bytes[0] === 0x1a &&
				bytes[1] === 0x45 &&
				bytes[2] === 0xdf &&
				bytes[3] === 0xa3
			);
		case "image/gif":
			return bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6));
		case "image/jpeg":
			return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
		default:
			return false;
	}
}

export async function validateStoredRecording(bucket, key, contentType) {
	const prefix = await bucket.get(key, { range: { offset: 0, length: MEDIA_PREFIX_BYTES } });
	if (
		!prefix ||
		!matchesMediaSignature(new Uint8Array(await prefix.arrayBuffer()), contentType, prefix.size)
	)
		throw new InvalidMediaError("Recording bytes do not match a supported media type");
}

export async function validatedJpegStream(stream, signal = AbortSignal.timeout(5 * 60 * 1000)) {
	const reader = stream.getReader();
	const abort = () => {
		void reader.cancel(signal.reason).catch(() => {
			/* The timeout response owns this cancellation failure. */
		});
	};
	signal.addEventListener("abort", abort, { once: true });
	const chunks = [];
	const prefix = new Uint8Array(3);
	let copied = 0;
	try {
		while (copied < prefix.length) {
			signal.throwIfAborted();
			const { done, value } = await reader.read();
			signal.throwIfAborted();
			if (done) break;
			chunks.push(value);
			const take = Math.min(value.byteLength, prefix.length - copied);
			prefix.set(value.subarray(0, take), copied);
			copied += take;
		}
		if (copied !== 3 || !matchesMediaSignature(prefix, "image/jpeg"))
			throw new InvalidMediaError("Thumbnail bytes must be JPEG");
	} catch (error) {
		await reader.cancel(error);
		throw error;
	} finally {
		signal.removeEventListener("abort", abort);
	}
	let index = 0;
	return new ReadableStream({
		async pull(controller) {
			if (index < chunks.length) {
				controller.enqueue(chunks[index++]);
				return;
			}
			const { done, value } = await reader.read();
			if (done) controller.close();
			else controller.enqueue(value);
		},
		cancel(reason) {
			return reader.cancel(reason);
		},
	});
}
