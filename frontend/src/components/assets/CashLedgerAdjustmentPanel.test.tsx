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
		fireEvent.change(screen.getByLabelText("当前币种变动金额"), {
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

	it("shows readonly cny target amount for manual adjustments", () => {
		render(
			<CashLedgerAdjustmentPanel
				accounts={[
					{
						id: 1,
						name: "港币账户",
						platform: "Bank",
						currency: "HKD",
						balance: 100,
						account_type: "BANK",
					},
				]}
				entries={[]}
				fxRates={{ HKD: 0.88 }}
				onCreate={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "新增调整" }));
		fireEvent.change(screen.getByLabelText("现金账户"), {
			target: { value: "1" },
		});
		fireEvent.change(screen.getByLabelText("当前币种变动金额"), {
			target: { value: "10" },
		});

		expect((screen.getByLabelText("目标币种") as HTMLInputElement).value).toBe("CNY");
		expect((screen.getByLabelText("目标币种变动金额（CNY）") as HTMLInputElement).value).toBe("¥8.80");
	});
});
