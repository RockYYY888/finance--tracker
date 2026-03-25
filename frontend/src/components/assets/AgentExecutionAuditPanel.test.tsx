import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentExecutionAuditPanel } from "./AgentExecutionAuditPanel";

afterEach(() => {
	cleanup();
});

describe("AgentExecutionAuditPanel", () => {
	it("renders registered agents, tasks, and linked agent records", () => {
		render(
			<AgentExecutionAuditPanel
				apiKeys={[]}
				registrations={[
					{
						id: 3,
						user_id: "alice",
						name: "quant-runner",
						status: "ACTIVE",
						active_token_count: 1,
						total_token_count: 2,
						latest_token_hint: "...a1b2c3",
						last_used_at: "2026-03-11T10:00:02.000Z",
						last_seen_at: "2026-03-11T10:00:03.000Z",
						created_at: "2026-03-10T10:00:00.000Z",
						updated_at: "2026-03-11T10:00:03.000Z",
					},
				]}
				tasks={[
					{
						id: 7,
						task_type: "UPDATE_CASH_TRANSFER",
						status: "DONE",
						payload: { transfer_id: 3, source_amount: 80 },
						result: { transfer: { id: 3, source_amount: 80 } },
						created_at: "2026-03-10T10:00:00.000Z",
						completed_at: "2026-03-10T10:00:01.000Z",
					},
				]}
				records={[
					{
						id: 1,
						source: "AGENT",
						agent_task_id: 7,
						asset_class: "cash",
						operation_kind: "TRANSFER",
						entity_type: "CASH_TRANSFER",
						entity_id: 3,
						title: "账户划转",
						summary: "账户 #2 → 账户 #9 · 80 CNY",
						effective_date: "2026-03-10",
						amount: 80,
						currency: "CNY",
						created_at: "2026-03-10T10:00:01.000Z",
					},
				]}
				apiDocUrl="https://github.com/RockYYY888/opentrifi/blob/main/docs/agent-api.md"
			/>,
		);

		expect(screen.getByText("quant-runner")).toBeTruthy();
		expect(screen.getByText("接入账号：alice")).toBeTruthy();
		expect(screen.getByText("编辑账户划转 · 任务 #7")).toBeTruthy();
		expect(screen.getByText("账户划转")).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "打开 API 文档" }).getAttribute("href"),
		).toBe("https://github.com/RockYYY888/opentrifi/blob/main/docs/agent-api.md");
	});

	it("renders the workspace summary as a dedicated four-card grid and separates direct api records", () => {
		render(
			<AgentExecutionAuditPanel
				apiKeys={[
					{
						id: 8,
						name: "local-cli",
						token_hint: "...abc123",
						created_at: "2026-03-14T10:00:00.000Z",
						updated_at: "2026-03-14T10:00:00.000Z",
						last_used_at: "2026-03-14T10:05:00.000Z",
						expires_at: null,
						revoked_at: null,
					},
				]}
				registrations={[
					{
						id: 3,
						user_id: "admin",
						name: "rebalancer-bot",
						status: "ACTIVE",
						active_token_count: 1,
						total_token_count: 1,
						latest_token_hint: "...a1b2c3",
						last_used_at: "2026-03-14T10:00:02.000Z",
						last_seen_at: "2026-03-14T10:00:03.000Z",
						created_at: "2026-03-14T10:00:00.000Z",
						updated_at: "2026-03-14T10:00:03.000Z",
					},
					{
						id: 4,
						user_id: "admin",
						name: "history-audit-bot",
						status: "INACTIVE",
						active_token_count: 0,
						total_token_count: 1,
						latest_token_hint: "...d4e5f6",
						last_used_at: "2026-03-14T09:55:02.000Z",
						last_seen_at: "2026-03-14T09:55:03.000Z",
						created_at: "2026-03-14T09:55:00.000Z",
						updated_at: "2026-03-14T09:56:03.000Z",
					},
				]}
				tasks={[
					{
						id: 7,
						task_type: "UPDATE_CASH_TRANSFER",
						status: "DONE",
						payload: { transfer_id: 3, source_amount: 80 },
						result: { transfer: { id: 3, source_amount: 80 } },
						created_at: "2026-03-10T10:00:00.000Z",
						completed_at: "2026-03-10T10:00:01.000Z",
					},
				]}
				records={[
					{
						id: 1,
						source: "AGENT",
						agent_task_id: 7,
						asset_class: "cash",
						operation_kind: "TRANSFER",
						entity_type: "CASH_TRANSFER",
						entity_id: 3,
						title: "账户划转",
						summary: "账户 #2 → 账户 #9 · 80 CNY",
						effective_date: "2026-03-10",
						amount: 80,
						currency: "CNY",
						created_at: "2026-03-10T10:00:01.000Z",
					},
					{
						id: 2,
						source: "AGENT",
						asset_class: "cash",
						operation_kind: "NEW",
						entity_type: "CASH_ACCOUNT",
						entity_id: 18,
						title: "Agent API 沙盒账户",
						summary: "Agent 直连 API 创建的演示账户",
						effective_date: "2026-03-14",
						amount: 20,
						currency: "CNY",
						created_at: "2026-03-14T10:05:01.000Z",
					},
				]}
				apiDocUrl="https://github.com/RockYYY888/opentrifi/blob/main/docs/agent-api.md"
			/>,
		);

		const summary = screen.getByTestId("agent-workspace-summary");
		expect(summary.querySelectorAll(".asset-manager__summary-card")).toHaveLength(4);
		expect(within(summary).getByText("已注册 Agent")).toBeTruthy();
		expect(within(summary).getAllByText("2")).toHaveLength(2);
		expect(within(summary).getAllByText("1")).toHaveLength(2);
		expect(screen.getByText("直连 API 记录")).toBeTruthy();
		expect(screen.getByText("Agent API 沙盒账户")).toBeTruthy();
		expect(screen.getByText("Agent 直连 API 创建的演示账户")).toBeTruthy();
		expect(screen.getByText("账户 API Keys")).toBeTruthy();
		expect(
			screen.getByRole("heading", {
				name: "local-cli",
			}),
		).toBeTruthy();
		expect(screen.getByText("...abc123")).toBeTruthy();
	});

	it("creates, copies, and revokes API keys through the provided callbacks", async () => {
		const createApiKey = vi.fn();
		const revokeApiKey = vi.fn();
		const clipboardWriteText = vi.fn().mockResolvedValue(undefined);
		Object.assign(globalThis.navigator, {
			clipboard: {
				writeText: clipboardWriteText,
			},
		});

		render(
			<AgentExecutionAuditPanel
				apiKeys={[
					{
						id: 8,
						name: "local-cli",
						token_hint: "...abc123",
						created_at: "2026-03-14T10:00:00.000Z",
						updated_at: "2026-03-14T10:00:00.000Z",
						last_used_at: "2026-03-14T10:05:00.000Z",
						expires_at: null,
						revoked_at: null,
					},
				]}
				registrations={[]}
				tasks={[]}
				records={[]}
				apiDocUrl="https://github.com/RockYYY888/opentrifi/blob/main/docs/agent-api.md"
				issuedApiKey={{
					id: 9,
					name: "daily-sync",
					token_hint: "...def456",
					access_token: "atrk_secret_key",
					created_at: "2026-03-14T10:10:00.000Z",
					updated_at: "2026-03-14T10:10:00.000Z",
					last_used_at: null,
					expires_at: null,
					revoked_at: null,
				}}
				onCreateApiKey={createApiKey}
				onRevokeApiKey={revokeApiKey}
			/>,
		);

		fireEvent.change(screen.getByLabelText("Key 名称"), {
			target: { value: "nightly-worker" },
		});
		fireEvent.click(screen.getByRole("button", { name: "生成 API Key" }));
		expect(createApiKey).toHaveBeenCalledWith("nightly-worker");

		fireEvent.click(screen.getByRole("button", { name: "复制到剪贴板" }));
		expect(clipboardWriteText).toHaveBeenCalledWith("atrk_secret_key");

		fireEvent.click(screen.getByRole("button", { name: "撤销" }));
		expect(revokeApiKey).toHaveBeenCalledWith(8);
	});
});
