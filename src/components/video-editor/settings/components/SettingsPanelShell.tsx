import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

interface SettingsPanelShellProps {
	activeEffectSection: string;
	content: ReactNode;
	footer?: ReactNode;
}

export function SettingsPanelShell({
	activeEffectSection,
	content,
	footer,
}: SettingsPanelShellProps) {
	return (
		<div className="flex-[2] w-[332px] min-w-[280px] max-w-[332px] bg-editor-panel rounded-2xl flex flex-col shadow-xl h-full overflow-hidden">
			<div
				className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 pb-0"
				style={{ scrollbarGutter: "stable" }}
			>
				<AnimatePresence mode="wait" initial={false}>
					<motion.div
						key={activeEffectSection}
						initial={{ opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -8 }}
						transition={{ duration: 0.18, ease: "easeOut" }}
					>
						{content}
					</motion.div>
				</AnimatePresence>
			</div>
			{footer}
		</div>
	);
}
