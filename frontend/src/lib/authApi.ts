import { createApiClient } from "./apiClient";
import type {
	ActionMessage,
	AuthLoginCredentials,
	AuthRegisterCredentials,
	AuthSession,
	PasswordResetPayload,
	UserEmailUpdate,
} from "../types/auth";

const authApiClient = createApiClient();
const CLIENT_DEVICE_ID_STORAGE_KEY = "asset-tracker-client-device-id";
let inMemoryClientDeviceId: string | null = null;
let authSessionRequestInFlight: Promise<AuthSession> | null = null;

function generateClientDeviceId(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}

	const randomChunk = Math.random().toString(16).slice(2, 10);
	return `device-${Date.now().toString(36)}-${randomChunk}`;
}

function getOrCreateClientDeviceId(): string {
	if (inMemoryClientDeviceId) {
		return inMemoryClientDeviceId;
	}

	const generatedId = generateClientDeviceId();
	if (typeof window === "undefined") {
		inMemoryClientDeviceId = generatedId;
		return generatedId;
	}

	try {
		const storedId = window.localStorage.getItem(CLIENT_DEVICE_ID_STORAGE_KEY);
		if (storedId && storedId.trim()) {
			inMemoryClientDeviceId = storedId;
			return storedId;
		}

		window.localStorage.setItem(CLIENT_DEVICE_ID_STORAGE_KEY, generatedId);
		inMemoryClientDeviceId = generatedId;
		return generatedId;
	} catch {
		inMemoryClientDeviceId = generatedId;
		return generatedId;
	}
}

function toJsonBody(
	payload:
		| AuthLoginCredentials
		| AuthRegisterCredentials
		| PasswordResetPayload
		| UserEmailUpdate,
): string {
	return JSON.stringify(payload);
}

export async function getAuthSession(): Promise<AuthSession> {
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

export async function loginWithPassword(payload: AuthLoginCredentials): Promise<AuthSession> {
	return authApiClient.request<AuthSession>("/api/auth/login", {
		method: "POST",
		body: toJsonBody(payload),
		headers: {
			"X-Client-Device-Id": getOrCreateClientDeviceId(),
		},
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

export async function updateCurrentUserEmail(payload: UserEmailUpdate): Promise<AuthSession> {
	return authApiClient.request<AuthSession>("/api/auth/email", {
		method: "PATCH",
		body: toJsonBody(payload),
	});
}

export async function logoutCurrentUser(): Promise<void> {
	return authApiClient.request<void>("/api/auth/logout", {
		method: "POST",
	});
}
