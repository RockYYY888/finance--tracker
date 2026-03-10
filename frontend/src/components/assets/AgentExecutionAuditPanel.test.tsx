import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AgentExecutionAuditPanel } from "./AgentExecutionAuditPanel";

afterEach(() => {
	cleanup();
});

describe("AgentExecutionAuditPanel", () => {
	it("renders agent tasks together with linked mutation audits", () => {
		render(
			<AgentExecutionAuditPanel
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
				audits={[
					{
						id: 1,
						agent_task_id: 7,
						entity_type: "CASH_TRANSFER",
						entity_id: 3,
						operation: "UPDATE",
						after_state: JSON.stringify({ source_amount: 80 }),
						reason: "TRANSFER_EDIT",
						created_at: "2026-03-10T10:00:01.000Z",
					},
				]}
			/>,
		);

		expect(screen.getByText("修正账户划转 · 任务 #7")).toBeTruthy();
		expect(screen.getByText("CASH_TRANSFER · UPDATE")).toBeTruthy();
		expect(screen.getByText(/TRANSFER_EDIT/)).toBeTruthy();
	});
});
