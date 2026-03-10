import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CashLedgerAdjustmentPanel } from "./CashLedgerAdjustmentPanel";

afterEach(() => {
	cleanup();
});

describe("CashLedgerAdjustmentPanel", () => {
	it("submits manual ledger adjustments with parsed numeric amount", () => {
		const handleCreate = vi.fn();

		render(
			<CashLedgerAdjustmentPanel
				accounts={[
					{
						id: 1,
						name: "主账户",
						platform: "Bank",
						currency: "CNY",
						balance: 100,
						account_type: "BANK",
					},
				]}
				entries={[]}
				onCreate={handleCreate}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "新增调整" }));
		fireEvent.change(screen.getByLabelText("现金账户"), {
			target: { value: "1" },
		});
		fireEvent.change(screen.getByLabelText("调整金额 (CNY)"), {
			target: { value: "-12.5" },
		});
		fireEvent.click(screen.getByRole("button", { name: "确认调整" }));

		expect(handleCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				cash_account_id: 1,
				amount: -12.5,
			}),
		);
	});
});
