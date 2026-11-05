import { translate } from "@/contexts/I18nContext";
import type { User } from "@supabase/supabase-js";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useRecordlyAuth } from "@/components/auth/useRecordlyAuth";
import { recoverBillingSession } from "@/lib/auth/recoverBillingSession";
import { CLOUD_SHARE_ENDPOINT } from "@/components/video-editor/cloud/endpoint";
import {
	invalidateCloudBillingReads,
	readCloudBilling,
} from "@/components/video-editor/cloud/cloudBillingReads";
import { subscribeShareCapacityChanges } from "@/components/video-editor/cloud/shareCapacity";
import {
	type CloudBillingInterval,
	parseCloudBillingCatalog,
	parseCloudBillingStatus,
} from "@/types/cloudBilling";
import { hasVerifiedCheckoutPrice } from "./pricingOffer";
import { type CachedCloudUsage, readUsageCache, writeUsageCache } from "./usageCache";

type Status = ReturnType<typeof parseCloudBillingStatus>;
type Catalog = ReturnType<typeof parseCloudBillingCatalog>;
type LegacyUsage = { recordings: number; storageBytes: number };

interface BillingContextValue {
	status: Status | null;
	catalog: Catalog | null;
	catalogLoading: boolean;
	fallbackUsage: LegacyUsage | null;
	usagePreview: CachedCloudUsage | null;
	loading: boolean;
	error: string | null;
	needsSignIn: boolean;
	user: User | null;
	refresh: () => Promise<void>;
	openPricing: () => void;
	pricingOpen: boolean;
	setPricingOpen: (open: boolean) => void;
	busy: "checkout" | "portal" | null;
	startBilling: (action: "checkout" | "portal", interval?: CloudBillingInterval) => Promise<void>;
	awaitingCheckout: boolean;
}

const BillingContext = createContext<BillingContextValue | null>(null);
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function readLegacyUsage(token: string): Promise<LegacyUsage> {
	const videos = new Map<string, number>();
	const cursors = new Set<string>();
	let cursor: string | undefined;
	for (let page = 0; page < 100; page++) {
		const result = await window.electronAPI.cloudShareManage({
			endpoint: CLOUD_SHARE_ENDPOINT,
			token,
			action: "list",
			cursor,
		});
		if (!result.success || !Array.isArray(result.videos))
			throw new Error(
				result.error || translate("billing.usageLoadError", "Could not load cloud usage."),
			);
		for (const video of result.videos) {
			if (
				typeof video.code !== "string" ||
				!Number.isSafeInteger(video.size) ||
				video.size < 0
			)
				throw new Error(
					translate("billing.usageVerifyError", "Could not verify cloud usage."),
				);
			videos.set(video.code, video.size);
		}
		if (!result.nextCursor)
			return {
				recordings: videos.size,
				storageBytes: [...videos.values()].reduce((sum, size) => sum + size, 0),
			};
		if (cursors.has(result.nextCursor))
			throw new Error(
				translate("billing.recordingsLoadError", "Could not load all cloud recordings."),
			);
		cursors.add(result.nextCursor);
		cursor = result.nextCursor;
	}
	throw new Error(
		translate("billing.recordingsLoadError", "Could not load all cloud recordings."),
	);
}

/** The server owns entitlement; checkout return and local storage never grant Cloud. */
export function BillingProvider({ children }: { children: ReactNode }) {
	const auth = useRecordlyAuth();
	const [status, setStatus] = useState<Status | null>(null);
	const [statusOwner, setStatusOwner] = useState<string | null>(null);
	const [catalog, setCatalog] = useState<Catalog | null>(null);
	const [catalogLoading, setCatalogLoading] = useState(false);
	const [fallbackUsage, setFallbackUsage] = useState<LegacyUsage | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [needsSignIn, setNeedsSignIn] = useState(false);
	const [catalogError, setCatalogError] = useState<string | null>(null);
	const [pricingOpen, setPricingOpen] = useState(false);
	const [busy, setBusy] = useState<"checkout" | "portal" | null>(null);
	const [awaitingCheckout, setAwaitingCheckout] = useState(false);
	const [pollUntil, setPollUntil] = useState(0);
	const request = useRef(0);
	const usageRequest = useRef<{ key: string; promise: Promise<void> } | null>(null);
	const catalogRequest = useRef<{ key: string; promise: Promise<void> } | null>(null);
	const mounted = useRef(true);
	const userId = auth.user?.id;
	const storedUsage = useMemo(
		() => (userId ? readUsageCache(CLOUD_SHARE_ENDPOINT, userId) : null),
		[userId],
	);
	const [recentUsage, setRecentUsage] = useState<{
		owner: string;
		snapshot: CachedCloudUsage;
	} | null>(null);
	const usagePreview = auth.user
		? recentUsage && recentUsage.owner === userId
			? recentUsage.snapshot
			: storedUsage
		: null;
	const authKey = `${userId ?? ""}:${auth.accessToken ?? ""}`;
	const currentAuthKey = useRef(authKey);
	currentAuthKey.current = authKey;
	const busyRef = useRef(false);
	const sessionRecoveryAttempted = useRef(false);
	const previousUserId = useRef(auth.user?.id);
	const verifiedStatus = statusOwner === authKey ? status : null;
	const verifiedFallbackUsage = statusOwner === authKey ? fallbackUsage : null;

	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			request.current++;
			usageRequest.current = null;
			catalogRequest.current = null;
		};
	}, []);

	const refresh = useCallback(
		(fresh = false): Promise<void> => {
			if (auth.loading) return Promise.resolve();
			const key = authKey;
			// Focus and visibility often fire together. Share the pending usage read
			// instead of invalidating its result and starting another provider request.
			if (usageRequest.current?.key === key) return usageRequest.current.promise;
			const id = ++request.current;
			const current = () =>
				mounted.current && request.current === id && currentAuthKey.current === key;
			const rememberUsage = (
				plan: CachedCloudUsage["plan"],
				usage: CachedCloudUsage["usage"],
			) => {
				if (!userId || !current()) return;
				const snapshot: CachedCloudUsage = {
					version: 1,
					updatedAt: Date.now(),
					plan,
					usage,
				};
				writeUsageCache(CLOUD_SHARE_ENDPOINT, userId, snapshot);
				setRecentUsage({ owner: userId, snapshot });
			};
			const rememberLegacyUsage = (usage: LegacyUsage) =>
				rememberUsage("free", {
					...usage,
					recordingLimit: 5,
					storageLimitBytes: null,
				});
			setLoading(true);
			const billingAvailable =
				CLOUD_SHARE_ENDPOINT && typeof window.electronAPI.cloudBilling === "function";
			// Pricing is independent of usage: a slow public catalog must not keep a
			// completed account read behind a loading indicator.
			if (billingAvailable && catalogRequest.current?.key !== key) {
				const pending = { key, promise: Promise.resolve() };
				catalogRequest.current = pending;
				setCatalogLoading(true);
				pending.promise = (async () => {
					try {
						const result = parseCloudBillingCatalog(
							await readCloudBilling(
								CLOUD_SHARE_ENDPOINT,
								"catalog",
								undefined,
								fresh,
							),
						);
						if (
							!mounted.current ||
							currentAuthKey.current !== key ||
							catalogRequest.current !== pending
						)
							return;
						setCatalog(result);
						setCatalogError(null);
					} catch (failure) {
						if (
							!mounted.current ||
							currentAuthKey.current !== key ||
							catalogRequest.current !== pending
						)
							return;
						setCatalog(null);
						setCatalogError(errorMessage(failure));
					} finally {
						if (catalogRequest.current === pending) {
							catalogRequest.current = null;
							if (mounted.current) setCatalogLoading(false);
						}
					}
				})();
			}
			const pending = { key, promise: Promise.resolve() };
			usageRequest.current = pending;
			pending.promise = (async () => {
				try {
					if (!billingAvailable) {
						setCatalog(null);
						setCatalogError(null);
						const legacy =
							CLOUD_SHARE_ENDPOINT && auth.accessToken
								? await readLegacyUsage(auth.accessToken)
								: null;
						if (!current()) return;
						setStatus(null);
						setFallbackUsage(legacy);
						if (legacy) rememberLegacyUsage(legacy);
						setError(
							CLOUD_SHARE_ENDPOINT
								? translate(
										"billing.restartForBilling",
										"Restart Recordly to connect plan management.",
									)
								: translate(
										"billing.cloudNotConfigured",
										"Cloud sharing is not configured in this build.",
									),
						);
						return;
					}
					let result =
						userId && auth.accessToken
							? await readCloudBilling(
									CLOUD_SHARE_ENDPOINT,
									"status",
									auth.accessToken,
									fresh,
								)
							: null;
					if (!current()) return;
					if (
						result?.httpStatus === 401 &&
						auth.accessToken &&
						!sessionRecoveryAttempted.current
					) {
						sessionRecoveryAttempted.current = true;
						let token: string | undefined;
						try {
							token = await recoverBillingSession(auth.accessToken, userId!);
						} catch (failure) {
							// A connection failure can be retried. An obsolete account's
							// failure must not reset the current account's recovery gate.
							if (current()) sessionRecoveryAttempted.current = false;
							throw failure;
						}
						if (!current()) return;
						if (token)
							result = await readCloudBilling(
								CLOUD_SHARE_ENDPOINT,
								"status",
								token,
								true,
							);
					}
					if (!current()) return;
					setNeedsSignIn(result?.httpStatus === 401);
					if (result?.httpStatus === 404)
						throw new Error(
							translate(
								"billing.billingUnavailable",
								"Cloud billing is not available (404).",
							),
						);
					const next = result ? parseCloudBillingStatus(result) : null;
					if (next) sessionRecoveryAttempted.current = false;
					setStatus(next);
					if (next)
						rememberUsage(next.billing.plan, {
							recordings: next.usage.recordings,
							storageBytes: next.usage.storageBytes,
							recordingLimit: next.usage.recordingLimit,
							storageLimitBytes: next.usage.storageLimitBytes,
						});
					setFallbackUsage(null);
					setError(null);
					if (next?.billing.plan === "pro") {
						setAwaitingCheckout(false);
						setPollUntil(0);
					}
				} catch (failure) {
					if (!current()) return;
					setStatus(null);
					setFallbackUsage(null);
					let message = errorMessage(failure);
					if (
						auth.accessToken &&
						/\b404\b|not found|billing.*not supported|no handler registered.*cloud-billing|cloudBilling.*not a function/i.test(
							message,
						)
					) {
						try {
							const legacy = await readLegacyUsage(auth.accessToken);
							if (!current()) return;
							setFallbackUsage(legacy);
							rememberLegacyUsage(legacy);
						} catch (legacyError) {
							if (!current()) return;
							message += ` ${errorMessage(legacyError)}`;
						}
					}
					setError(message);
				} finally {
					if (current()) {
						setStatusOwner(key);
						setLoading(false);
					}
					if (usageRequest.current === pending) usageRequest.current = null;
				}
			})();
			return pending.promise;
		},
		[auth.loading, userId, auth.accessToken, authKey],
	);

	useEffect(() => {
		if (previousUserId.current === auth.user?.id) return;
		previousUserId.current = auth.user?.id;
		sessionRecoveryAttempted.current = false;
		invalidateCloudBillingReads();
		setStatus(null);
		setStatusOwner(null);
		setFallbackUsage(null);
		setError(null);
		setNeedsSignIn(false);
		setAwaitingCheckout(false);
		setPollUntil(0);
		if (typeof window.electronAPI.cloudBillingCancel === "function")
			void window.electronAPI.cloudBillingCancel().catch(() => undefined);
	}, [auth.user?.id]);
	useEffect(() => {
		void refresh();
	}, [refresh]);

	useEffect(() => {
		let active = true;
		const onFocus = () => {
			if (document.visibilityState === "visible") void refresh();
		};
		window.addEventListener("focus", onFocus);
		document.addEventListener("visibilitychange", onFocus);
		const unsubscribe = subscribeShareCapacityChanges(() => {
			const pending = usageRequest.current;
			// A mutation can finish after an in-flight read took its snapshot.
			// Follow that read with a fresh one instead of coalescing the change away.
			if (pending?.key === authKey) {
				void pending.promise.then(() => {
					if (active) void refresh();
				});
			} else void refresh();
		});
		return () => {
			active = false;
			window.removeEventListener("focus", onFocus);
			document.removeEventListener("visibilitychange", onFocus);
			unsubscribe();
		};
	}, [refresh, authKey]);

	useEffect(() => {
		if (!pollUntil) return;
		let canceled = false;
		let timer: ReturnType<typeof setTimeout>;
		let attempts = 0;
		const poll = async () => {
			if (canceled) return;
			if (Date.now() >= pollUntil) {
				setPollUntil(0);
				return;
			}
			await refresh(true);
			if (!canceled)
				timer = setTimeout(() => void poll(), Math.min(20_000, 2000 * 2 ** attempts++));
		};
		timer = setTimeout(() => void poll(), 2000);
		return () => {
			canceled = true;
			clearTimeout(timer);
		};
	}, [pollUntil, refresh]);

	const startBilling = async (
		action: "checkout" | "portal",
		interval: CloudBillingInterval = "monthly",
	) => {
		if (busyRef.current) return;
		if (!auth.user || !auth.accessToken) {
			setPricingOpen(true);
			return;
		}
		if (
			action === "checkout" &&
			(interval !== "monthly" ||
				verifiedStatus?.billing.plan === "pro" ||
				!verifiedStatus?.billing.checkoutAvailable ||
				!verifiedStatus.billing.checkoutIntervals.includes(interval) ||
				!hasVerifiedCheckoutPrice(catalog, verifiedStatus?.billing, interval))
		) {
			setError(
				translate(
					"billing.checkoutNotVerified",
					"Checkout is not available until Recordly verifies the plan and its price.",
				),
			);
			return;
		}
		if (action === "portal" && !verifiedStatus?.billing.portalAvailable) {
			setError(
				translate(
					"billing.portalUnavailable",
					"Subscription management is not available yet. Try refreshing your plan.",
				),
			);
			return;
		}
		busyRef.current = true;
		setBusy(action);
		setError(null);
		const key = authKey;
		try {
			const result = await window.electronAPI.cloudBilling({
				endpoint: CLOUD_SHARE_ENDPOINT,
				token: auth.accessToken,
				action,
				...(action === "checkout" ? { interval } : {}),
			});
			if (!mounted.current || currentAuthKey.current !== key) return;
			if (!result.success)
				throw new Error(
					result.error ||
						translate(
							"billing.openBillingFailed",
							"Could not open secure billing. Try again.",
						),
				);
			if (action === "checkout") {
				setAwaitingCheckout(true);
				setPollUntil(Date.now() + 120_000);
			}
			await refresh(true);
		} catch (failure) {
			if (mounted.current && currentAuthKey.current === key) setError(errorMessage(failure));
		} finally {
			busyRef.current = false;
			if (mounted.current) setBusy(null);
		}
	};

	return (
		<BillingContext.Provider
			value={{
				status: verifiedStatus,
				catalog,
				catalogLoading,
				fallbackUsage: verifiedFallbackUsage,
				usagePreview,
				loading: loading || auth.loading || statusOwner !== authKey,
				error: statusOwner === authKey ? error || catalogError : null,
				needsSignIn: statusOwner === authKey && needsSignIn,
				user: auth.user,
				refresh: () => refresh(true),
				openPricing: () => {
					setPricingOpen(true);
					void refresh(true);
				},
				pricingOpen,
				setPricingOpen,
				busy,
				startBilling,
				awaitingCheckout: statusOwner === authKey ? awaitingCheckout : false,
			}}
		>
			{children}
		</BillingContext.Provider>
	);
}

export function useOptionalBilling(): BillingContextValue | null {
	return useContext(BillingContext);
}

export function useBilling(): BillingContextValue {
	const context = useOptionalBilling();
	if (!context) throw new Error("useBilling requires BillingProvider.");
	return context;
}
