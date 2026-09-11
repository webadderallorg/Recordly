// Smoke-export diagnostics must stay visible in packaged builds. The renderer
// production bundle is minified with terser `drop_console: true`
// (vite.config.ts), which strips EVERY syntactic `console.*` call — including
// console.error. Dispatching through an aliased sink is not a syntactic
// console call, so terser keeps it and `--enable-logging=stderr` can surface
// the logs when validating a build.
//
// Use these wrappers only for diagnostics that must survive production builds
// (smoke export path, backend selection); regular code keeps plain console.
const consoleSink = console;

export function keepLog(...args: unknown[]): void {
	consoleSink.log(...args);
}

export function keepError(...args: unknown[]): void {
	consoleSink.error(...args);
}
