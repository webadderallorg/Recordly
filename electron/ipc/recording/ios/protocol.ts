/** Byte-bounded framing with fatal UTF-8 validation, independent of event schema. */
export class NDJSONDecoder<T> {
	private partial = Buffer.alloc(0);
	private readonly utf8 = new TextDecoder("utf-8", { fatal: true });

	constructor(private readonly parse: (line: string) => T) {}

	push(chunk: Uint8Array): T[] {
		const bytes = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
		const output: T[] = [];
		let offset = 0;
		while (offset < bytes.length) {
			const end = bytes.indexOf(10, offset);
			const stop = end === -1 ? bytes.length : end;
			if (this.partial.length + stop - offset > 64 * 1024) throw new Error("INVALID_REQUEST");
			this.partial = Buffer.concat([this.partial, bytes.subarray(offset, stop)]);
			if (end === -1) break;
			if (this.partial.length === 0) throw new Error("INVALID_REQUEST");
			output.push(this.parse(this.utf8.decode(this.partial)));
			this.partial = Buffer.alloc(0);
			offset = end + 1;
		}
		return output;
	}

	finish(): void {
		if (this.partial.length) throw new Error("INCOMPLETE_PROTOCOL");
	}
}
