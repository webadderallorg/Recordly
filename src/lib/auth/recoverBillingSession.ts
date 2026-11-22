import { recordlyAuth } from "./recordlyAuth";

let recovery: { token: string; userId: string; promise: Promise<string | undefined> } | undefined;

/** Recover a rejected session once, without signing out or crossing account boundaries. */
export function recoverBillingSession(
	rejectedToken: string,
	userId: string,
): Promise<string | undefined> {
	if (recovery?.token === rejectedToken && recovery.userId === userId) return recovery.promise;
	const promise = (async () => {
		if (!recordlyAuth) return undefined;
		try {
			const current = await recordlyAuth.auth.getSession();
			if (current.error) throw current.error;
			const session = current.data.session;
			if (!session || session.user.id !== userId || session.user.is_anonymous)
				return undefined;
			if (session.access_token !== rejectedToken) return session.access_token;
			const refreshed = await recordlyAuth.auth.refreshSession();
			if (refreshed.error) throw refreshed.error;
			if (
				refreshed.data.session?.user.id !== session.user.id ||
				refreshed.data.session?.user.is_anonymous
			)
				return undefined;
			return refreshed.data.session?.access_token;
		} catch (error) {
			const status = (error as { status?: number })?.status;
			if (status !== 400 && status !== 401 && status !== 403) {
				throw new Error(
					"Could not refresh your cloud session. Check your connection and try again.",
				);
			}
			return undefined;
		}
	})();
	recovery = { token: rejectedToken, userId, promise };
	// Dedupe concurrent consumers, but allow a later retry after a network outage.
	void promise
		.finally(() => {
			if (recovery?.promise === promise) recovery = undefined;
		})
		.catch(() => undefined);
	return promise;
}
