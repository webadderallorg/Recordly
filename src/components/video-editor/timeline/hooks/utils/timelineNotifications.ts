import { toast } from "sonner";

export interface TimelineNotifications {
	error: (title: string, description?: string) => void;
	info: (title: string, description?: string) => void;
	success: (title: string, description?: string) => void;
}

export const timelineNotifications: TimelineNotifications = {
	error: (title, description) => toast.error(title, description ? { description } : undefined),
	info: (title, description) => toast.info(title, description ? { description } : undefined),
	success: (title, description) => toast.success(title, description ? { description } : undefined),
};
