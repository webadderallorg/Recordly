export const WINDOWS_CMAKE_GENERATORS = Object.freeze([
	{ name: "Visual Studio 18 2026", label: "VS 2026 (v143)", toolset: "v143" },
	{ name: "Visual Studio 17 2022", label: "VS 2022" },
	{ name: "Visual Studio 16 2019", label: "VS 2019" },
	{ name: "Visual Studio 18 2026", label: "VS 2026 (default toolset)" },
]);

export const WINDOWS_VISUAL_STUDIO_INSTALL_DIRS = Object.freeze(["18", "2022", "2019"]);

export function configureWithWindowsCmakeGenerator({
	prefix,
	configure,
	clearCache,
	log = console.log,
}) {
	let lastError;

	for (let index = 0; index < WINDOWS_CMAKE_GENERATORS.length; index += 1) {
		const generator = WINDOWS_CMAKE_GENERATORS[index];
		clearCache();

		try {
			configure(generator.name, generator.toolset);
			return generator.name;
		} catch (error) {
			lastError = error;
			const nextGenerator = WINDOWS_CMAKE_GENERATORS[index + 1];
			if (nextGenerator) {
				log(
					`[${prefix}] CMake configure with ${generator.label} failed, trying ${nextGenerator.label}...`,
				);
			}
		}
	}

	throw lastError;
}
