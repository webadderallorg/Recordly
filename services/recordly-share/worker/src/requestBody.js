export async function limitedJson(request, max = 1024 * 1024) {
	const reader = request.body?.getReader();
	if (!reader) throw new Error("INVALID_JSON");
	let size = 0;
	const chunks = [];
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > max) {
				await reader.cancel();
				throw new Error("BODY_TOO_LARGE");
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		const value = JSON.parse(new TextDecoder().decode(bytes));
		if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
		return value;
	} catch {
		throw new Error("INVALID_JSON");
	}
}
