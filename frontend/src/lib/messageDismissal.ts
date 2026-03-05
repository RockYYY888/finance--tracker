const DISMISSED_STORAGE_PREFIX = "feedback-dismissed-messages-v1";
const DISMISS_CONFIRM_COOKIE = "feedback_dismiss_skip_confirm_v1";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export type MessageDismissScope = "admin-inbox" | "user-inbox";

function canUseBrowserStorage(): boolean {
	return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function canUseDocumentCookie(): boolean {
	return typeof document !== "undefined" && typeof document.cookie === "string";
}

function buildStorageKey(scope: MessageDismissScope, userId: string): string {
	return `${DISMISSED_STORAGE_PREFIX}:${scope}:${userId}`;
}

export function loadDismissedMessageKeys(
	scope: MessageDismissScope,
	userId: string,
): Set<string> {
	if (!canUseBrowserStorage()) {
		return new Set<string>();
	}

	const storageKey = buildStorageKey(scope, userId);
	const rawValue = window.localStorage.getItem(storageKey);
	if (!rawValue) {
		return new Set<string>();
	}

	try {
		const parsedValue = JSON.parse(rawValue);
		if (!Array.isArray(parsedValue)) {
			return new Set<string>();
		}
		return new Set(
			parsedValue
				.filter((item): item is string => typeof item === "string")
				.map((item) => item.trim())
				.filter(Boolean),
		);
	} catch {
		return new Set<string>();
	}
}

export function saveDismissedMessageKeys(
	scope: MessageDismissScope,
	userId: string,
	keys: Set<string>,
): void {
	if (!canUseBrowserStorage()) {
		return;
	}

	const storageKey = buildStorageKey(scope, userId);
	const normalizedKeys = Array.from(keys)
		.map((item) => item.trim())
		.filter(Boolean)
		.sort();
	window.localStorage.setItem(storageKey, JSON.stringify(normalizedKeys));
}

export function shouldSkipDismissConfirmation(): boolean {
	if (!canUseDocumentCookie()) {
		return false;
	}

	const cookieEntries = document.cookie.split(";").map((item) => item.trim());
	for (const entry of cookieEntries) {
		if (!entry.startsWith(`${DISMISS_CONFIRM_COOKIE}=`)) {
			continue;
		}
		return entry.slice(DISMISS_CONFIRM_COOKIE.length + 1) === "1";
	}
	return false;
}

export function setSkipDismissConfirmation(skip: boolean): void {
	if (!canUseDocumentCookie()) {
		return;
	}

	if (skip) {
		document.cookie =
			`${DISMISS_CONFIRM_COOKIE}=1; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax`;
		return;
	}

	document.cookie =
		`${DISMISS_CONFIRM_COOKIE}=0; Max-Age=0; Path=/; SameSite=Lax`;
}
