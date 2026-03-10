import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AgentExecutionAuditPanel } from "./AgentExecutionAuditPanel";

afterEach(() => {
	cleanup();
});

describe("AgentExecutionAuditPanel", () => {
	it("renders registered agents, tasks, and linked agent records", () => {
		render(
			<AgentExecutionAuditPanel
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
				apiDocUrl="https://github.com/RockYYY888/finance--tracker/blob/main/docs/agent-api.md"
			/>,
		);

		expect(screen.getByText("quant-runner")).toBeTruthy();
		expect(screen.getByText("接入账号：alice")).toBeTruthy();
		expect(screen.getByText("编辑账户划转 · 任务 #7")).toBeTruthy();
		expect(screen.getByText("账户划转")).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "打开 API 文档" }).getAttribute("href"),
		).toBe("https://github.com/RockYYY888/finance--tracker/blob/main/docs/agent-api.md");
	});
});
