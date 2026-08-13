export class VersionedWaveformCache<T> {
	private readonly values = new Map<string, T>();
	private readonly latestKeyByScope = new Map<string, string>();
	private readonly scopeByKey = new Map<string, string>();

	constructor(private readonly maxEntries: number) {
		if (!Number.isInteger(maxEntries) || maxEntries < 1) {
			throw new RangeError("Waveform cache size must be a positive integer");
		}
	}

	activate(scope: string, key: string): void {
		const previousKey = this.latestKeyByScope.get(scope);
		if (previousKey && previousKey !== key) {
			this.values.delete(previousKey);
			this.scopeByKey.delete(previousKey);
		}
		this.latestKeyByScope.set(scope, key);
	}

	get(key: string): T | undefined {
		const value = this.values.get(key);
		if (value === undefined) {
			return undefined;
		}

		this.values.delete(key);
		this.values.set(key, value);
		return value;
	}

	setIfCurrent(scope: string, key: string, value: T): boolean {
		if (this.latestKeyByScope.get(scope) !== key) {
			return false;
		}

		this.values.delete(key);
		this.values.set(key, value);
		this.scopeByKey.set(key, scope);
		this.evictOverflow();
		return true;
	}

	deactivateIfCurrent(scope: string, key: string): void {
		if (this.latestKeyByScope.get(scope) === key && !this.values.has(key)) {
			this.latestKeyByScope.delete(scope);
		}
	}

	private evictOverflow(): void {
		while (this.values.size > this.maxEntries) {
			const oldestKey = this.values.keys().next().value;
			if (oldestKey === undefined) {
				return;
			}

			this.values.delete(oldestKey);
			const scope = this.scopeByKey.get(oldestKey);
			this.scopeByKey.delete(oldestKey);
			if (scope && this.latestKeyByScope.get(scope) === oldestKey) {
				this.latestKeyByScope.delete(scope);
			}
		}
	}
}
