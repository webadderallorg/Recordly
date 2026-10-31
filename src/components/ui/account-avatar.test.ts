import { expect, it } from "vitest";
import type { User } from "@supabase/supabase-js";
import { getAccountProfile } from "./account-avatar";
it("uses OAuth profile photos and falls back to name or email initials", () => {
	const user = {
		email: "alex@example.com",
		user_metadata: { full_name: "Alex Smith", avatar_url: "https://example.com/photo.jpg" },
	} as User;
	expect(getAccountProfile(user)).toEqual({
		name: "Alex Smith",
		initials: "AS",
		picture: "https://example.com/photo.jpg",
	});
	expect(
		getAccountProfile({ ...user, user_metadata: { picture: "https://example.com/google.jpg" } })
			.picture,
	).toBe("https://example.com/google.jpg");
	expect(getAccountProfile({ ...user, user_metadata: {} })).toEqual({
		name: "alex@example.com",
		initials: "A",
		picture: undefined,
	});
	expect(getAccountProfile(null).initials).toBe("LP");
});
