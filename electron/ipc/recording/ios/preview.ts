export interface IOSPreviewFrame {
	generation: number;
	sequence: number;
	jpeg: Uint8Array;
}

const HEADER_BYTES = 24;
const MAX_JPEG_BYTES = 128 * 1024;

/** A damaged preview closes only this disposable stream, never the control pipe. */
export class PreviewFrameDecoder {
	private partial = Buffer.alloc(0);
	private expected = HEADER_BYTES;
	private closed = false;

	push(chunk: Uint8Array): IOSPreviewFrame[] {
		if (this.closed) return [];
		let latest: IOSPreviewFrame | undefined;
		let offset = 0;
		while (offset < chunk.byteLength) {
			const amount = Math.min(this.expected - this.partial.length, chunk.byteLength - offset);
			this.partial = Buffer.concat([this.partial, chunk.subarray(offset, offset + amount)]);
			offset += amount;
			if (this.partial.length !== this.expected) continue;
			if (this.expected === HEADER_BYTES) {
				const header = this.partial;
				const size = header.readUInt32BE(16);
				if (
					header.toString("ascii", 0, 4) !== "RLIP" ||
					header.readUInt16BE(4) !== 1 ||
					header.readUInt16BE(6) !== 0 ||
					header.readUInt32BE(20) !== 0 ||
					size === 0 ||
					size > MAX_JPEG_BYTES
				) {
					this.closed = true;
					this.partial = Buffer.alloc(0);
					throw new Error("INVALID_PREVIEW");
				}
				this.expected += size;
			} else {
				latest = {
					generation: this.partial.readUInt32BE(8),
					sequence: this.partial.readUInt32BE(12),
					jpeg: this.partial.subarray(HEADER_BYTES),
				};
				this.partial = Buffer.alloc(0);
				this.expected = HEADER_BYTES;
			}
		}
		return latest ? [latest] : [];
	}
}
