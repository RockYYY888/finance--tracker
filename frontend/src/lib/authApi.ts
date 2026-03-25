import { clearStoredRuntimeApiKey, createApiClient, getStoredRuntimeApiKey, setStoredRuntimeApiKey } from "./apiClient";
import type {
	ActionMessage,
	ApiKeyAuthCredentials,
	AuthSession,
	UserEmailUpdate,
} from "../types/auth";

const authApiClient = createApiClient();
let authSessionRequestInFlight: Promise<AuthSession> | null = null;

export function hasStoredApiKey(): boolean {
	return getStoredRuntimeApiKey() !== null;
}

export async function authenticateWithApiKey(
	payload: ApiKeyAuthCredentials,
): Promise<AuthSession> {
	setStoredRuntimeApiKey(payload.api_key);

	try {
		const session = await authApiClient.request<AuthSession>("/api/auth/session");
		return session;
	} catch (error) {
		clearStoredRuntimeApiKey();
		throw error;
	}
}

export async function getAuthSession(): Promise<AuthSession> {
	if (!hasStoredApiKey()) {
		throw new Error("请先输入 API Key。");
	}
	if (authSessionRequestInFlight !== null) {
		return authSessionRequestInFlight;
	}

	authSessionRequestInFlight = authApiClient.request<AuthSession>("/api/auth/session");
	try {
		return await authSessionRequestInFlight;
	} finally {
		authSessionRequestInFlight = null;
	}
}

export async function updateCurrentUserEmail(payload: UserEmailUpdate): Promise<AuthSession> {
	return authApiClient.request<AuthSession>("/api/auth/email", {
		method: "PATCH",
		body: JSON.stringify(payload),
	});
}

export async function logoutCurrentUser(): Promise<ActionMessage> {
	clearStoredRuntimeApiKey();
	return { message: "已清除本地 API Key。" };
}
