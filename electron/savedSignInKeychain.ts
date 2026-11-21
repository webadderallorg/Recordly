import { createRequire } from "node:module";
import path from "node:path";

type Keychain = {
	readKey: () => Buffer | null;
	addKey: (key: Buffer) => boolean;
};

const require = createRequire(import.meta.url);
let keychain: Keychain | undefined;

export function savedSignInKeychain(): Keychain {
	keychain ??= require(
		path.join(
			process.resourcesPath,
			"app.asar.unpacked",
			"electron",
			"native",
			"bin",
			process.arch === "arm64" ? "darwin-arm64" : "darwin-x64",
			"recordly-saved-sign-in.node",
		),
	) as Keychain;
	return keychain;
}
