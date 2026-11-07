import { Button, Modal } from "@heroui/react";
import { useState } from "react";
import { X } from "@phosphor-icons/react";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import { OnboardingFooter, OnboardingLayout, OnboardingPrimaryAction } from "./OnboardingLayout";
import { OnboardingPermissions } from "./OnboardingPermissions";

/** Permission recovery has no account steps or onboarding side effects. */
export function RecordingPermissionsDialog({
	open,
	onClose,
	onFinish,
	standalone,
}: {
	open: boolean;
	onClose: () => void;
	onFinish: () => void;
	standalone: boolean;
}) {
	const t = useScopedT("onboarding");
	const { t: appT } = useI18n();
	const [ready, setReady] = useState(false);
	return (
		<Modal
			isOpen={open}
			onOpenChange={(value) => {
				if (!value) onClose();
			}}
		>
			<Modal.Backdrop variant="blur">
				<Modal.Container size="cover" placement="center" className="p-0">
					<Modal.Dialog
						aria-label={t("permissions")}
						data-recording-permissions
						className="relative h-full min-h-0 w-full max-w-none gap-0 overflow-hidden rounded-none p-0"
					>
						{standalone && (
							<div
								aria-hidden="true"
								className="onboarding-window-drag absolute left-0 right-12 top-0 z-30 flex h-8 justify-center pt-2"
							>
								<span className="h-1 w-10 rounded-full bg-foreground/20" />
							</div>
						)}
						<OnboardingLayout
							stage="permissions"
							canViewPermissions
							showNavigation={false}
							footer={
								<OnboardingFooter>
									<div aria-hidden="true" />
									<OnboardingPrimaryAction
										isDisabled={!ready}
										onPress={() => {
											if (ready) onFinish();
										}}
									>
										{t("startRecording")}
									</OnboardingPrimaryAction>
								</OnboardingFooter>
							}
						>
							<OnboardingPermissions
								showFooter={false}
								onReadyChange={setReady}
								onFinish={onFinish}
							/>
						</OnboardingLayout>
						<Button
							isIconOnly
							variant="ghost"
							aria-label={appT("common.actions.close")}
							onPress={onClose}
							className="onboarding-window-close absolute right-2 top-2 z-40 size-8 min-w-0 rounded-full bg-background/80"
						>
							<X size={16} aria-hidden="true" />
						</Button>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
