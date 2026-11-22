/** Library history is secondary to a filesystem operation that already committed. */
export async function persistRecentMetadata(
	action: () => Promise<void>,
): Promise<string | undefined> {
	try {
		await action();
		return undefined;
	} catch (error) {
		const warning = `Project operation completed, but recent-project history could not be updated: ${String(error)}`;
		console.warn(warning);
		return warning;
	}
}
