import { createApiClient } from "./apiClient";
import type {
	ActionMessage,
	AuthLoginCredentials,
	AuthRegisterCredentials,
	AuthSession,
	PasswordResetPayload,
} from "../types/auth";

const authApiClient = createApiClient();

function toJsonBody(
	payload: AuthLoginCredentials | AuthRegisterCredentials | PasswordResetPayload,
): string {
	return JSON.stringify(payload);
}

export async function getAuthSession(): Promise<AuthSession> {
	return authApiClient.request<AuthSession>("/api/auth/session");
}

export async function loginWithPassword(payload: AuthLoginCredentials): Promise<AuthSession> {
	return authApiClient.request<AuthSession>("/api/auth/login", {
		method: "POST",
		body: toJsonBody(payload),
	});
}

export async function registerWithPassword(payload: AuthRegisterCredentials): Promise<AuthSession> {
	return authApiClient.request<AuthSession>("/api/auth/register", {
		method: "POST",
		body: toJsonBody(payload),
	});
}

export async function resetPasswordWithEmail(
	payload: PasswordResetPayload,
): Promise<ActionMessage> {
	return authApiClient.request<ActionMessage>("/api/auth/reset-password", {
		method: "POST",
		body: toJsonBody(payload),
	});
}

export async function logoutCurrentUser(): Promise<void> {
	return authApiClient.request<void>("/api/auth/logout", {
		method: "POST",
	});
}
