import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HoldingForm } from "./HoldingForm";

afterEach(() => {
	cleanup();
});

describe("HoldingForm search results", () => {
	it("shows only real provider labels in search results", async () => {
		const onSearch = vi.fn().mockResolvedValue([
			{
				symbol: "688256.SS",
				name: "寒武纪-U",
				market: "CN",
				currency: "CNY",
				exchange: "SHH",
				source: "本地映射",
			},
			{
				symbol: "BTC-USD",
				name: "Bitcoin",
				market: "CRYPTO",
				currency: "USD",
				exchange: "BITGET",
				source: "Bitget",
			},
			{
				symbol: "AAPL",
				name: "Apple Inc.",
				market: "US",
				currency: "USD",
				exchange: "NMS",
				source: "代码推断",
			},
		]);

		render(<HoldingForm onSearch={onSearch} />);

		fireEvent.change(screen.getByLabelText("搜索投资标的"), {
			target: { value: "比特币" },
		});

		await waitFor(() => {
			expect(onSearch).toHaveBeenCalledWith("比特币");
		}, { timeout: 1000 });

		expect(screen.getByText("Bitcoin")).not.toBeNull();
		expect(screen.queryByText(/本地映射/)).toBeNull();
		expect(screen.queryByText(/代码推断/)).toBeNull();
		expect(screen.getByText(/Bitget/)).not.toBeNull();
	});
});

describe("HoldingForm started_on guard", () => {
	it("blocks submit when started_on is later than server date", async () => {
		const onEdit = vi.fn().mockResolvedValue(undefined);

		render(
			<HoldingForm
				mode="edit"
				recordId={1}
				maxStartedOnDate="2026-03-05"
				value={{
					symbol: "AAPL",
					name: "Apple",
					quantity: "2",
					fallback_currency: "USD",
					market: "US",
					started_on: "2026-03-06",
				}}
				onEdit={onEdit}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "保存编辑" }));

		await waitFor(() => {
			expect(
				screen.getByText("持仓日不能晚于服务器今日日期（2026-03-05）。"),
			).not.toBeNull();
		});
		expect(onEdit).not.toHaveBeenCalled();
	});
});

describe("HoldingForm edit intent", () => {
	it("hides transaction-only controls when editing a holding", () => {
		render(
			<HoldingForm
				mode="edit"
				recordId={1}
				value={{
					symbol: "AAPL",
					name: "Apple",
					quantity: "2",
					fallback_currency: "USD",
					market: "US",
					started_on: "2026-03-05",
				}}
			/>,
		);

		expect(screen.queryByLabelText("卖出回款去向")).toBeNull();
		expect(screen.queryByText("交易类型")).toBeNull();
		expect(screen.getByRole("button", { name: "保存编辑" })).not.toBeNull();
	});
});

describe("HoldingForm sell proceeds handling", () => {
	it("requires selecting an existing cash account when sell proceeds are merged", async () => {
		const onCreate = vi.fn().mockResolvedValue(undefined);

		render(
			<HoldingForm
				intent="sell"
				value={{
					side: "SELL",
					symbol: "AAPL",
					name: "Apple",
					quantity: "1",
					fallback_currency: "USD",
					market: "US",
					started_on: "2026-03-05",
				}}
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
				onCreate={onCreate}
			/>,
		);

		fireEvent.change(screen.getByLabelText("卖出回款去向"), {
			target: { value: "ADD_TO_EXISTING_CASH" },
		});
		fireEvent.click(screen.getByRole("button", { name: "确认卖出" }));

		await waitFor(() => {
			expect(
				screen.getByText("请选择一个已有现金账户来接收卖出回款。"),
			).not.toBeNull();
		});
		expect(onCreate).not.toHaveBeenCalled();
	});

	it("submits sell proceeds handling and target cash account", async () => {
		const onCreate = vi.fn().mockResolvedValue(undefined);

		render(
			<HoldingForm
				intent="sell"
				value={{
					side: "SELL",
					symbol: "AAPL",
					name: "Apple",
					quantity: "1",
					fallback_currency: "USD",
					market: "US",
					started_on: "2026-03-05",
				}}
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
				onCreate={onCreate}
			/>,
		);

		fireEvent.change(screen.getByLabelText("卖出回款去向"), {
			target: { value: "ADD_TO_EXISTING_CASH" },
		});
		fireEvent.change(screen.getByLabelText("目标现金账户"), {
			target: { value: "9" },
		});
		fireEvent.click(screen.getByRole("button", { name: "确认卖出" }));

		await waitFor(() => {
			expect(onCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					side: "SELL",
					sell_proceeds_handling: "ADD_TO_EXISTING_CASH",
					sell_proceeds_account_id: 9,
				}),
			);
		});
	});
});
