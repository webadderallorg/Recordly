import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { savedSignInKeychain } from "./savedSignInKeychain";

const MAGIC = Buffer.from("Recordly-Saved-Sign-In\0");
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
let cachedKey: Buffer | undefined;

function readKey(create: boolean): Buffer {
	const keychain = savedSignInKeychain();
	let key = keychain.readKey();
	if (!key && create) {
		const candidate = randomBytes(KEY_BYTES);
		try {
			keychain.addKey(candidate);
			// A simultaneous create may have won. Always read the actual item
			// back before committing a file that depends on it.
			key = keychain.readKey();
		} finally {
			candidate.fill(0);
		}
	}
	if (!key || key.length !== KEY_BYTES) throw new Error("Saved sign-in key is unavailable.");
	return key;
}

export function isSavedSignInCiphertext(encrypted: Buffer): boolean {
	return encrypted.subarray(0, MAGIC.length).equals(MAGIC);
}

export function sealSavedSignIn(plaintext: string): Buffer {
	const nonce = randomBytes(NONCE_BYTES);
	cachedKey ??= readKey(true);
	const cipher = createCipheriv("aes-256-gcm", cachedKey, nonce);
	cipher.setAAD(MAGIC);
	const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	return Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), data]);
}

export function openSavedSignIn(encrypted: Buffer, verifyKeychain = false): string {
	const nonceEnd = MAGIC.length + NONCE_BYTES;
	const tagEnd = nonceEnd + TAG_BYTES;
	if (!isSavedSignInCiphertext(encrypted) || encrypted.length <= tagEnd)
		throw new Error("Invalid saved sign-in file.");
	// Never generate a replacement key for a file that already requires one.
	let key = cachedKey;
	if (verifyKeychain || !key) {
		key = readKey(false);
		if (!verifyKeychain) cachedKey = key;
	}
	const decipher = createDecipheriv(
		"aes-256-gcm",
		key,
		encrypted.subarray(MAGIC.length, nonceEnd),
	);
	decipher.setAAD(MAGIC);
	decipher.setAuthTag(encrypted.subarray(nonceEnd, tagEnd));
	return Buffer.concat([decipher.update(encrypted.subarray(tagEnd)), decipher.final()]).toString(
		"utf8",
	);
}
