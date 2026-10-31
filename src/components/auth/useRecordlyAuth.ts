import type { User } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import {
	completeAuthCallback,
	recordlyAuth,
	recordlyAuthConfigured,
} from "@/lib/auth/recordlyAuth";

export function useRecordlyAuth() {
	const [user, setUser] = useState<User | null>(null);
	const [accessToken, setAccessToken] = useState<string>();
	const [loading, setLoading] = useState(recordlyAuthConfigured);
	const [callbackError, setCallbackError] = useState<string>();
	const callbackUrl = useRef<string | undefined>(undefined);

	useEffect(() => {
		if (!recordlyAuth) {
			setLoading(false);
			return;
		}

		let mounted = true;
		void recordlyAuth.auth
			.getSession()
			.then(({ data, error }) => {
				if (error) throw error;
				if (mounted) {
					setUser(data.session?.user ?? null);
					setAccessToken(data.session?.access_token);
					setLoading(false);
				}
			})
			.catch((error) => {
				if (mounted) {
					setCallbackError(error instanceof Error ? error.message : String(error));
					setLoading(false);
				}
			});
		const { data: listener } = recordlyAuth.auth.onAuthStateChange((_event, session) => {
			if (mounted) {
				setUser(session?.user ?? null);
				setAccessToken(session?.access_token);
			}
		});

		const handleCallback = async (url: string) => {
			if (!mounted || callbackUrl.current === url) return;
			callbackUrl.current = url;
			try {
				setCallbackError(undefined);
				await completeAuthCallback(url);
			} catch (error) {
				if (mounted)
					setCallbackError(error instanceof Error ? error.message : String(error));
			} finally {
				await window.electronAPI.ackAuthCallbackUrl(url).catch(() => undefined);
			}
		};
		const unsubscribe = window.electronAPI.onAuthCallbackUrl((url) => void handleCallback(url));
		void window.electronAPI.getPendingAuthCallbackUrl().then((url) => {
			if (url) void handleCallback(url);
		});

		return () => {
			mounted = false;
			listener.subscription.unsubscribe();
			unsubscribe();
		};
	}, []);

	return {
		user: user?.is_anonymous ? null : user,
		accessToken: user?.is_anonymous ? undefined : accessToken,
		loading,
		configured: recordlyAuthConfigured,
		callbackError,
	};
}
