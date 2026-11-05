import { OnboardingController } from "./OnboardingController";
import { useRecordlyAuth } from "./useRecordlyAuth";

export default function OnboardingWindow() {
	const auth = useRecordlyAuth();
	return (
		<div className="relative h-screen w-screen overflow-hidden bg-editor-bg text-foreground">
			<OnboardingController
				requestNonce={0}
				ready={!auth.loading}
				user={auth.user}
				configured={auth.configured}
				callbackError={auth.callbackError}
				standalone
			/>
		</div>
	);
}
