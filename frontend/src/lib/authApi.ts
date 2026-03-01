import { createApiClient } from "./apiClient";
import type { AuthCredentials, AuthSession } from "../types/auth";

const authApiClient = createApiClient();

function toJsonBody(payload: AuthCredentials): string {
	return JSON.stringify(payload);
}

export async function getAuthSession(): Promise<AuthSession> {
	return authApiClient.request<AuthSession>("/api/auth/session");
}

export async function loginWithPassword(payload: AuthCredentials): Promise<AuthSession> {
	return authApiClient.request<AuthSession>("/api/auth/login", {
		method: "POST",
		body: toJsonBody(payload),
	});
}

export async function registerWithPassword(payload: AuthCredentials): Promise<AuthSession> {
	return authApiClient.request<AuthSession>("/api/auth/register", {
		method: "POST",
		body: toJsonBody(payload),
	});
}

export async function logoutCurrentUser(): Promise<void> {
	return authApiClient.request<void>("/api/auth/logout", {
		method: "POST",
	});
}
