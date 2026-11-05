import type { RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "@/contexts/I18nContext";
import { recordlyAuth } from "@/lib/auth/recordlyAuth";
import { recoverBillingSession } from "@/lib/auth/recoverBillingSession";
import { CLOUD_SHARE_ENDPOINT as DEFAULT_CLOUD_ENDPOINT } from "./endpoint";
import {
	checkShareCapacity,
	ShareEmailVerificationRequiredError,
	ShareSignInRequiredError,
	subscribeShareCapacityChanges,
} from "./shareCapacity";

interface CloudShareCapacityInput {
	authToken?: string;
	accountId?: string;
	accountVersion: RefObject<number>;
	uploadId?: string;
	activeUploadAccountVersion: RefObject<number | undefined>;
	activeUploadId: RefObject<string | undefined>;
	uploading: boolean;
}
export function useCloudShareCapacity({
	authToken,
	accountId,
	accountVersion,
	uploadId,
	activeUploadAccountVersion,
	activeUploadId,
	uploading,
}: CloudShareCapacityInput) {
	const { t } = useI18n();

	const [capacityAvailable, setCapacityAvailable] = useState<boolean | null>(null);

	const [checkingCapacity, setCheckingCapacity] = useState(false);

	const [capacityError, setCapacityError] = useState<string>();

	const [capacityIdentity, setCapacityIdentity] = useState<string>();

	const currentCapacityIdentity = `${accountId ?? ""}:${authToken ?? ""}`;

	const verifiedCapacity =
		capacityIdentity === currentCapacityIdentity ? capacityAvailable : null;

	const latestAuthToken = useRef(authToken);

	const authTokenVersion = useRef(0);

	useLayoutEffect(() => {
		latestAuthToken.current = authToken;
		authTokenVersion.current++;
	}, [authToken]);

	const [signInRequired, setSignInRequired] = useState(false);

	const sessionRecovery = useRef<{ attempted: boolean; pending?: Promise<string | undefined> }>({
		attempted: false,
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: Account changes must reset the one-shot session recovery.
	useLayoutEffect(() => {
		sessionRecovery.current = { attempted: false };
	}, [accountId]);

	const recoverSession = useCallback((): Promise<string | undefined> => {
		const recovery = sessionRecovery.current;
		if (recovery.pending) return recovery.pending;
		if (!accountId || !authToken || recovery.attempted) return Promise.resolve(undefined);
		recovery.attempted = true;
		const version = accountVersion.current;
		const tokenVersion = authTokenVersion.current;
		const pending = (async () => {
			try {
				const token = await recoverBillingSession(authToken, accountId);
				if (accountVersion.current !== version) return undefined;
				if (token && authTokenVersion.current === tokenVersion)
					latestAuthToken.current = token;
				return token;
			} catch (error) {
				// A connection failure did not reject the user's credentials. Allow
				// focus/manual retries after connectivity returns.
				recovery.attempted = false;
				throw error;
			} finally {
				recovery.pending = undefined;
			}
		})();
		recovery.pending = pending;
		return pending;
	}, [accountId, authToken, accountVersion]);

	useEffect(() => {
		setCapacityAvailable(null);
		setCheckingCapacity(false);
		setSignInRequired(false);
		if (!authToken || !DEFAULT_CLOUD_ENDPOINT) return;
		let active = true;
		let generation = 0;
		let pending = false;
		let refreshAgain = false;
		const refresh = () => {
			if (pending) {
				refreshAgain = true;
				return;
			}
			pending = true;
			const request = ++generation;
			setCapacityAvailable(null);
			setCapacityError(undefined);
			setCheckingCapacity(true);
			void checkShareCapacity(DEFAULT_CLOUD_ENDPOINT, authToken, recoverSession)
				.then((available) => {
					if (active && request === generation) {
						sessionRecovery.current.attempted = false;
						setCapacityAvailable(available);
						setCapacityIdentity(currentCapacityIdentity);
					}
				})
				.catch((cause) => {
					if (active && request === generation) {
						setSignInRequired(
							cause instanceof ShareSignInRequiredError ||
								cause instanceof ShareEmailVerificationRequiredError,
						);
						setCapacityAvailable(null);
						setCapacityIdentity(currentCapacityIdentity);
						setCapacityError(
							cause instanceof Error
								? cause.message
								: t(
										"editor.cloud.checkStorageFailed",
										"Could not check cloud storage. Try again.",
									),
						);
					}
				})
				.finally(() => {
					pending = false;
					if (active && request === generation) {
						setCheckingCapacity(false);
						if (refreshAgain) {
							refreshAgain = false;
							refresh();
						}
					}
				});
		};
		const unsubscribe = subscribeShareCapacityChanges(refresh);
		const onFocus = () => {
			if (!pending) refresh();
		};
		window.addEventListener("focus", onFocus);
		refresh();
		return () => {
			active = false;
			unsubscribe();
			window.removeEventListener("focus", onFocus);
		};
	}, [authToken, currentCapacityIdentity, recoverSession, t]);

	useEffect(() => {
		if (
			!authToken ||
			!uploadId ||
			activeUploadAccountVersion.current !== accountVersion.current
		)
			return;
		void window.electronAPI
			.cloudShareUpdateToken?.({ uploadId, token: authToken })
			.catch(() => undefined);
	}, [authToken, uploadId, activeUploadAccountVersion, accountVersion]);

	useEffect(() => {
		if (!uploading || !recordlyAuth || !accountId) return;
		let active = true;
		let pending = false;
		const version = accountVersion.current;
		const refresh = async () => {
			if (pending || !active || accountVersion.current !== version) return;
			pending = true;
			const tokenVersion = authTokenVersion.current;
			try {
				let { data, error } = await recordlyAuth!.auth.getSession();
				if (error || data.session?.user.id !== accountId) return;
				if (data.session.expires_at && data.session.expires_at <= Date.now() / 1000 + 120) {
					({ data, error } = await recordlyAuth!.auth.refreshSession());
				}
				if (
					!active ||
					error ||
					accountVersion.current !== version ||
					authTokenVersion.current !== tokenVersion ||
					data.session?.user.id !== accountId
				)
					return;
				latestAuthToken.current = data.session.access_token;
				const id = activeUploadId.current;
				if (id && activeUploadAccountVersion.current === version)
					await window.electronAPI.cloudShareUpdateToken?.({
						uploadId: id,
						token: data.session.access_token,
					});
			} catch {
				// Expired/invalid credentials remain rejected by the upload service.
			} finally {
				pending = false;
			}
		};
		void refresh();
		const timer = window.setInterval(() => void refresh(), 30_000);
		return () => {
			active = false;
			window.clearInterval(timer);
		};
	}, [uploading, accountId, accountVersion, activeUploadId, activeUploadAccountVersion]);
	return {
		setCapacityAvailable,
		checkingCapacity,
		capacityError,
		capacityIdentity,
		setCapacityIdentity,
		currentCapacityIdentity,
		verifiedCapacity,
		signInRequired,
		sessionRecovery,
		recoverSession,
		latestAuthToken,
	};
}
