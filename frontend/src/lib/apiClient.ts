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

function translateValidationMessage(message: string): string {
	const normalizedMessage = message.replace(/^Value error,\s*/, "").trim();
	if (!normalizedMessage) {
		return "输入内容不符合要求。";
	}

	if (normalizedMessage === "Field required") {
		return "请完整填写必填项。";
	}

	const minLengthMatch = normalizedMessage.match(
		/^String should have at least (\d+) characters?$/,
	);
	if (minLengthMatch) {
		return `输入内容至少需要 ${minLengthMatch[1]} 个字符。`;
	}

	const maxLengthMatch = normalizedMessage.match(
		/^String should have at most (\d+) characters?$/,
	);
	if (maxLengthMatch) {
		return `输入内容不能超过 ${maxLengthMatch[1]} 个字符。`;
	}

	if (normalizedMessage === "Input should be a valid string") {
		return "输入格式不正确。";
	}

	return normalizedMessage;
}

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

			return translateValidationMessage(message);
		})
		.filter((message): message is string => message !== null);

	if (messages.length === 0) {
		return null;
	}

	return Array.from(new Set(messages)).join("；");
}

function getStatusFallbackMessage(statusCode: number): string {
	switch (statusCode) {
		case 400:
			return "请求内容不正确，请检查后重试。";
		case 401:
			return "登录状态无效或已过期，请重新登录。";
		case 403:
			return "当前请求被服务器拒绝。";
		case 404:
			return "请求的内容不存在。";
		case 409:
			return "当前内容已存在或状态冲突。";
		case 422:
			return "输入内容不符合要求，请检查后重试。";
		case 429:
			return "请求过于频繁，请稍后再试。";
		default:
			if (statusCode >= 500) {
				return "服务器暂时不可用，请稍后再试。";
			}

			return `请求失败（${statusCode}）。`;
	}
}

function extractErrorMessage(responseText: string, statusCode: number): string {
	if (!responseText.trim()) {
		return getStatusFallbackMessage(statusCode);
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
		return responseText.trim() || getStatusFallbackMessage(statusCode);
	}

	return getStatusFallbackMessage(statusCode);
}

function toNetworkErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		const normalizedMessage = error.message.trim();
		if (
			normalizedMessage === "Failed to fetch"
			|| normalizedMessage === "Load failed"
			|| normalizedMessage === "NetworkError when attempting to fetch resource."
		) {
			return "无法连接到服务器，请检查网络或服务状态。";
		}

		if (normalizedMessage) {
			return normalizedMessage;
		}
	}

	return "无法连接到服务器，请检查网络或服务状态。";
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

			let response: Response;
			try {
				response = await fetcher(`${baseUrl}${path}`, {
					...init,
					credentials: init?.credentials ?? "include",
					headers: requestHeaders,
				});
			} catch (error) {
				throw new Error(toNetworkErrorMessage(error));
			}
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
