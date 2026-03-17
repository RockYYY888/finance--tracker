import { describe, expect, it, vi } from "vitest";

import { createApiClient } from "./apiClient";

describe("apiClient server error handling", () => {
	it("replaces generic 5xx error text with a friendly fallback", async () => {
		const fetcher = vi.fn().mockResolvedValue(
			new Response("Internal Server Error", {
				status: 500,
				headers: {
					"Content-Type": "text/plain",
				},
			}),
		);
		const client = createApiClient({ fetcher });

		await expect(client.request("/api/dashboard")).rejects.toThrow(
			"服务器暂时不可用，请稍后再试。",
		);
	});

	it("keeps custom server detail when the backend provides user-facing 5xx copy", async () => {
		const fetcher = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ detail: "系统维护中，请稍后重试。" }), {
				status: 503,
				headers: {
					"Content-Type": "application/json",
				},
			}),
		);
		const client = createApiClient({ fetcher });

		await expect(client.request("/api/dashboard")).rejects.toThrow(
			"系统维护中，请稍后重试。",
		);
	});

	it("preserves authentication errors instead of masking them as server errors", async () => {
		const fetcher = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ detail: "请先登录。" }), {
				status: 401,
				headers: {
					"Content-Type": "application/json",
				},
			}),
		);
		const client = createApiClient({ fetcher });

		await expect(client.request("/api/auth/session")).rejects.toThrow("请先登录。");
	});
});
