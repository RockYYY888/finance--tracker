import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CashTransferPanel } from "./CashTransferPanel";

afterEach(() => {
	cleanup();
});

describe("CashTransferPanel", () => {
	it("clamps transfer amount to the selected source account balance", () => {
		render(
			<CashTransferPanel
				accounts={[
					{
						id: 1,
						name: "主账户",
						platform: "Bank",
						currency: "CNY",
						balance: 100,
						account_type: "BANK",
					},
					{
						id: 2,
						name: "备用金",
						platform: "Cash",
						currency: "CNY",
						balance: 0,
						account_type: "CASH",
					},
				]}
				transfers={[]}
				onCreate={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "新增划转" }));
		fireEvent.change(screen.getByLabelText("转出账户"), {
			target: { value: "1" },
		});
		fireEvent.change(screen.getByLabelText("划转金额"), {
			target: { value: "150" },
		});

		expect((screen.getByLabelText("划转金额") as HTMLInputElement).value).toBe("100");
	});
});
