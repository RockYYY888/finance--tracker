const DEFAULT_API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";
const DEFAULT_API_TOKEN = import.meta.env.VITE_API_TOKEN ?? "";

export interface ApiClient {
	request: <T>(path: string, init?: RequestInit) => Promise<T>;
}

export interface ApiClientOptions {
	baseUrl?: string;
	apiToken?: string;
	fetcher?: typeof fetch;
}

function parsePayload<T>(responseText: string): T {
	if (!responseText.trim()) {
		return undefined as T;
	}

	try {
		return JSON.parse(responseText) as T;
	} catch {
		return responseText as T;
	}
}

type ApiErrorDetailItem = {
	msg?: string;
};

function extractValidationErrorMessage(detail: unknown): string | null {
	if (!Array.isArray(detail)) {
		return null;
	}

	const messages = detail
		.map((item) => {
			if (!item || typeof item !== "object") {
				return null;
			}

			const message = (item as ApiErrorDetailItem).msg;
			if (typeof message !== "string") {
				return null;
			}

			return message.replace(/^Value error,\s*/, "").trim() || null;
		})
		.filter((message): message is string => message !== null);

	if (messages.length === 0) {
		return null;
	}

	return Array.from(new Set(messages)).join("；");
}

function extractErrorMessage(responseText: string, statusCode: number): string {
	if (!responseText.trim()) {
		return `Request failed with status ${statusCode}`;
	}

	try {
		const parsed = JSON.parse(responseText) as { detail?: string | unknown[] };
		if (typeof parsed.detail === "string" && parsed.detail.trim()) {
			return parsed.detail;
		}

		const validationMessage = extractValidationErrorMessage(parsed.detail);
		if (validationMessage) {
			return validationMessage;
		}
	} catch {
		return responseText;
	}

	return `Request failed with status ${statusCode}`;
}

/**
 * Creates a lightweight request wrapper shared by feature modules.
 */
export function createApiClient(options: ApiClientOptions = {}): ApiClient {
	const baseUrl = options.baseUrl ?? DEFAULT_API_BASE_URL;
	const apiToken = options.apiToken ?? DEFAULT_API_TOKEN;
	const fetcher = options.fetcher ?? fetch;

	return {
		async request<T>(path: string, init?: RequestInit): Promise<T> {
			const requestHeaders = new Headers(init?.headers ?? undefined);
			if (!requestHeaders.has("Content-Type") && init?.body) {
				requestHeaders.set("Content-Type", "application/json");
			}
			if (apiToken) {
				requestHeaders.set("X-API-Key", apiToken);
			}

			const response = await fetcher(`${baseUrl}${path}`, {
				...init,
				credentials: init?.credentials ?? "include",
				headers: requestHeaders,
			});
			const responseText = await response.text();

			if (!response.ok) {
				throw new Error(extractErrorMessage(responseText, response.status));
			}

			return parsePayload<T>(responseText);
		},
	};
}

/**
 * Normalizes thrown values into user-facing copy.
 */
export function toErrorMessage(error: unknown, fallbackMessage: string): string {
	if (error instanceof Error && error.message.trim()) {
		return error.message;
	}

	return fallbackMessage;
}
