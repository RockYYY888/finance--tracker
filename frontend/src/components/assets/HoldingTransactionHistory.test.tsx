import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HoldingTransactionHistory } from "./HoldingTransactionHistory";

afterEach(() => {
	cleanup();
});

describe("HoldingTransactionHistory", () => {
	it("submits buy funding account updates for buy transactions", async () => {
		const onEdit = vi.fn().mockResolvedValue({
			id: 1,
			symbol: "AAPL",
			name: "Apple",
			side: "BUY",
			quantity: 1,
			price: 180,
			fallback_currency: "USD",
			market: "US",
			traded_on: "2026-03-09",
			buy_funding_handling: "DEDUCT_FROM_EXISTING_CASH",
			buy_funding_account_id: 9,
		});

		render(
			<HoldingTransactionHistory
				transactions={[
					{
						id: 1,
						symbol: "AAPL",
						name: "Apple",
						side: "BUY",
						quantity: 1,
						price: 180,
						fallback_currency: "USD",
						market: "US",
						traded_on: "2026-03-09",
					},
				]}
				cashAccounts={[
					{
						id: 9,
						name: "主账户",
						platform: "Bank",
						currency: "CNY",
						balance: 1200,
						account_type: "BANK",
					},
				]}
				onEdit={onEdit}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "修正记录" }));
		fireEvent.change(screen.getByLabelText("扣款现金账户"), {
			target: { value: "9" },
		});
		fireEvent.click(screen.getByRole("button", { name: "保存修正" }));

		await waitFor(() => {
			expect(onEdit).toHaveBeenCalledWith(
				1,
				expect.objectContaining({
					quantity: 1,
					buy_funding_handling: "DEDUCT_FROM_EXISTING_CASH",
					buy_funding_account_id: 9,
				}),
			);
		});
	});
});
