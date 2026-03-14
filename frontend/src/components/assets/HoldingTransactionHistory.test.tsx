import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HoldingTransactionHistory } from "./HoldingTransactionHistory";

afterEach(() => {
	cleanup();
});

describe("HoldingTransactionHistory", () => {
	it("renders read-only transaction cards and shows adjustment records as edits", () => {
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
						note: "首次买入",
					},
					{
						id: 2,
						symbol: "AAPL",
						name: "Apple",
						side: "ADJUST",
						quantity: 2,
						price: 182,
						fallback_currency: "USD",
						market: "US",
						traded_on: "2026-03-10",
						note: "修正持仓",
					},
				]}
			/>,
		);

		expect(screen.getByText("交易记录用于留痕和核对 持仓纠错请回到左侧持仓卡片点击编辑")).not.toBeNull();
		expect(screen.queryByRole("button", { name: "修正记录" })).toBeNull();
		expect(screen.getByText("编辑")).not.toBeNull();
		expect(screen.getByText("首次买入")).not.toBeNull();
		expect(screen.getByText("修正持仓")).not.toBeNull();
	});

	it("keeps transaction cards visible while history refreshes", () => {
		render(
			<HoldingTransactionHistory
				loading
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
						note: "首次买入",
					},
				]}
			/>,
		);

		expect(screen.getByText("首次买入")).not.toBeNull();
		expect(screen.getByText("正在更新交易记录...")).not.toBeNull();
		expect(screen.queryByText("正在加载交易记录...")).toBeNull();
	});
});
