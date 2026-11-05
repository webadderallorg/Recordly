import { Button } from "@heroui/react";
import { useEffect, useRef, useState } from "react";
import {
	challengeEnabled,
	challengeToken,
	cloudAuthConfigUrl,
	type AuthProtectionState,
} from "../../lib/auth/cloudAuthProtection";

export function RecordlyBotChallenge({
	configurationUrl,
	previouslyRequired = false,
	onChange,
	onRetry,
	labels,
}: {
	configurationUrl?: string;
	previouslyRequired?: boolean;
	onChange: (state: AuthProtectionState) => void;
	onRetry: () => void;
	labels: { checking: string; failed: string; retry: string; title: string };
}) {
	const frame = useRef<HTMLIFrameElement>(null);
	const knownRequired = useRef(previouslyRequired);
	const [config, setConfig] = useState<{ enabled: boolean; origin?: string }>();
	const [failed, setFailed] = useState(false);
	const [requestId, setRequestId] = useState("");
	const [interactionRequired, setInteractionRequired] = useState(false);
	useEffect(() => {
		const controller = new AbortController();
		let active = true;
		const timer = setTimeout(() => controller.abort(), 15000);
		setFailed(false);
		setInteractionRequired(false);
		onChange({ ready: false, required: knownRequired.current });
		void (async () => {
			try {
				const endpoint = cloudAuthConfigUrl(configurationUrl);
				if (!endpoint) {
					if (active) setConfig({ enabled: false });
					return;
				}
				const response = await fetch(endpoint, {
					credentials: "omit",
					signal: controller.signal,
				});
				if (!response.ok) throw new Error("Configuration unavailable");
				const enabled = challengeEnabled(await response.json());
				if (active) {
					knownRequired.current = enabled;
					setConfig({ enabled, origin: new URL(endpoint).origin });
				}
			} catch {
				// Configuration is a UX hint, never an authorization decision. Older
				// cloud deployments do not expose cross-origin configuration. Supabase
				// still rejects every tokenless request once CAPTCHA is enabled there.
				if (active) {
					setFailed(true);
					onChange({
						ready: !knownRequired.current,
						required: knownRequired.current,
						failed: true,
					});
				}
			} finally {
				clearTimeout(timer);
			}
		})();
		return () => {
			active = false;
			clearTimeout(timer);
			controller.abort();
		};
	}, [configurationUrl, onChange]);
	useEffect(() => {
		setInteractionRequired(false);
		if (!config) return;
		onChange({ ready: !config.enabled, required: config.enabled });
		setRequestId(crypto.randomUUID().replace(/-/g, ""));
	}, [config, onChange]);
	useEffect(() => {
		if (!config?.enabled || !config.origin || !requestId) return;
		let timer: ReturnType<typeof setTimeout>;
		const receive = (event: MessageEvent) => {
			const token = challengeToken(
				event,
				frame.current?.contentWindow ?? null,
				config.origin!,
				requestId,
			);
			if (token) {
				clearTimeout(timer);
				setInteractionRequired(false);
				setFailed(false);
				onChange({ ready: true, required: true, token });
			} else if (
				event.source === frame.current?.contentWindow &&
				event.origin === config.origin &&
				event.data?.type === "recordly-auth-challenge" &&
				event.data.requestId === requestId
			) {
				if (event.data.status === "interactive") {
					setInteractionRequired(true);
				} else if (event.data.status === "background") {
					setInteractionRequired(false);
				} else if (["expired", "error"].includes(event.data.status)) {
					setInteractionRequired(false);
					setFailed(true);
					onChange({ ready: false, required: true, failed: true });
				}
			}
		};
		window.addEventListener("message", receive);
		timer = setTimeout(() => {
			setInteractionRequired(false);
			setFailed(true);
			onChange({ ready: false, required: true, failed: true });
		}, 120000);
		return () => {
			window.removeEventListener("message", receive);
			clearTimeout(timer);
		};
	}, [config, requestId, onChange]);
	if (config?.enabled === false && !failed) return null;
	const source =
		config?.origin && requestId
			? `${config.origin}/cloud/challenge?${new URLSearchParams({ request: requestId, parent: window.location.origin })}`
			: undefined;
	const visible = interactionRequired || failed;
	return (
		<div
			data-auth-challenge
			className={visible ? "space-y-2" : "h-0 overflow-hidden"}
			style={visible ? undefined : { margin: 0 }}
		>
			{source && !failed && (
				<iframe
					ref={frame}
					src={source}
					title={labels.title}
					className="block w-full border-0"
					style={{ height: interactionRequired ? 72 : 0 }}
					aria-hidden={!interactionRequired}
					tabIndex={interactionRequired ? 0 : -1}
					sandbox="allow-scripts allow-same-origin"
				/>
			)}
			{failed && (
				<div
					role="alert"
					className="flex items-center justify-between gap-2 text-xs text-muted"
				>
					<span>{labels.failed}</span>
					<Button type="button" variant="ghost" size="sm" onPress={onRetry}>
						{labels.retry}
					</Button>
				</div>
			)}
		</div>
	);
}
