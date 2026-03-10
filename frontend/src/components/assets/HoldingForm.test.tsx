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

describe("HoldingForm create defaults", () => {
	it("does not prefill market, currency, or quantity before choosing a security", () => {
		render(<HoldingForm maxStartedOnDate="2026-03-09" />);

		expect((screen.getByLabelText("市场") as HTMLSelectElement).value).toBe("");
		expect((screen.getByLabelText("计价币种") as HTMLInputElement).value).toBe("");
		expect((screen.getByLabelText("数量") as HTMLInputElement).value).toBe("");
	});
});

describe("HoldingForm reset behavior", () => {
	it("keeps user input when upstream props refresh without a new editor session", () => {
		const { rerender } = render(
			<HoldingForm
				resetKey={0}
				maxStartedOnDate="2026-03-09"
				value={{
					side: "BUY",
				}}
			/>,
		);

		fireEvent.change(screen.getByLabelText("数量"), {
			target: { value: "12" },
		});
		fireEvent.change(screen.getByLabelText("备注"), {
			target: { value: "等回调完成再确认" },
		});

		rerender(
			<HoldingForm
				resetKey={0}
				maxStartedOnDate="2026-03-10"
				value={{
					side: "BUY",
					symbol: "AAPL",
				}}
			/>,
		);

		expect((screen.getByLabelText("数量") as HTMLInputElement).value).toBe("12");
		expect((screen.getByLabelText("备注") as HTMLTextAreaElement).value).toBe(
			"等回调完成再确认",
		);
	});
});

describe("HoldingForm started_on guard", () => {
	it("allows editing holding metadata without validating transaction date fields", async () => {
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

		fireEvent.change(screen.getByLabelText("账户 / 来源"), {
			target: { value: "Futu" },
		});
		fireEvent.click(screen.getByRole("button", { name: "保存资料" }));

		await waitFor(() => {
			expect(onEdit).toHaveBeenCalledTimes(1);
		});
	});
});

describe("HoldingForm edit intent", () => {
	it("keeps metadata-only editing when the holding is backed by multiple transactions", () => {
		render(
			<HoldingForm
				mode="edit"
				recordId={1}
				relatedTransactions={[
					{
						id: 10,
						symbol: "AAPL",
						name: "Apple",
						side: "BUY",
						quantity: 2,
						price: 180,
						fallback_currency: "USD",
						market: "US",
						traded_on: "2026-03-05",
					},
					{
						id: 11,
						symbol: "AAPL",
						name: "Apple",
						side: "BUY",
						quantity: 1,
						price: 181,
						fallback_currency: "USD",
						market: "US",
						traded_on: "2026-03-06",
					},
				]}
				value={{
					symbol: "AAPL",
					name: "Apple",
					quantity: "2",
					fallback_currency: "USD",
					market: "US",
					started_on: "2026-03-05",
				}}
				onCancel={vi.fn()}
			/>,
		);

		expect(screen.queryByLabelText("卖出回款去向")).toBeNull();
		expect(screen.queryByText("交易类型")).toBeNull();
		expect(screen.queryByLabelText("交易日")).toBeNull();
		expect(screen.queryByLabelText("数量（股/支）")).toBeNull();
		expect(screen.getByText(/当前持仓由 2 笔交易构成/)).not.toBeNull();
		expect(screen.getByRole("button", { name: "保存资料" })).not.toBeNull();
		expect(screen.getByRole("button", { name: "取消编辑" })).not.toBeNull();
	});

	it("allows correcting quantity price and traded_on when the holding maps to one buy transaction", async () => {
		const onEdit = vi.fn().mockResolvedValue(undefined);

		render(
			<HoldingForm
				mode="edit"
				recordId={1}
				editableTransaction={{
					id: 10,
					symbol: "AAPL",
					name: "Apple",
					side: "BUY",
					quantity: 2,
					price: 180,
					fallback_currency: "USD",
					market: "US",
					traded_on: "2026-03-05",
				}}
				relatedTransactions={[
					{
						id: 10,
						symbol: "AAPL",
						name: "Apple",
						side: "BUY",
						quantity: 2,
						price: 180,
						fallback_currency: "USD",
						market: "US",
						traded_on: "2026-03-05",
					},
				]}
				value={{
					symbol: "AAPL",
					name: "Apple",
					quantity: "2",
					fallback_currency: "USD",
					cost_basis_price: "180",
					market: "US",
					started_on: "2026-03-05",
				}}
				onEdit={onEdit}
				onCancel={vi.fn()}
			/>,
		);

		fireEvent.change(screen.getByLabelText("买入数量（股/支）"), {
			target: { value: "3" },
		});
		fireEvent.change(screen.getByLabelText("买入价（计价币种）"), {
			target: { value: "182" },
		});
		fireEvent.click(screen.getByRole("button", { name: "保存资料" }));

		await waitFor(() => {
			expect(onEdit).toHaveBeenCalledWith(
				1,
				expect.objectContaining({
					quantity: 3,
					cost_basis_price: 182,
					started_on: "2026-03-05",
				}),
			);
		});

		expect(screen.getByText(/当前持仓仅关联一笔买入/)).not.toBeNull();
	});
});

describe("HoldingForm sell proceeds handling", () => {
	const existingHoldings = [
		{
			id: 1,
			side: "BUY" as const,
			symbol: "AAPL",
			name: "Apple",
			quantity: 3,
			fallback_currency: "USD",
			cost_basis_price: 80,
			market: "US" as const,
			broker: "Futu",
			started_on: "2026-03-01",
			price: 188,
			price_currency: "USD",
		},
	];

	it("requires selecting an existing cash account when sell proceeds are merged", async () => {
		const onCreate = vi.fn().mockResolvedValue(undefined);

		render(
			<HoldingForm
				intent="sell"
				maxStartedOnDate="2026-03-09"
				existingHoldings={existingHoldings}
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

		expect(screen.queryByLabelText("搜索投资标的")).toBeNull();

		fireEvent.change(screen.getByLabelText("卖出持仓"), {
			target: { value: "AAPL::US" },
		});
		fireEvent.change(screen.getByLabelText("卖出回款去向"), {
			target: { value: "ADD_TO_EXISTING_CASH" },
		});
		fireEvent.change(screen.getByLabelText(/数量/), {
			target: { value: "1" },
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
				maxStartedOnDate="2026-03-09"
				existingHoldings={existingHoldings}
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

		fireEvent.change(screen.getByLabelText("卖出持仓"), {
			target: { value: "AAPL::US" },
		});
		fireEvent.change(screen.getByLabelText("卖出回款去向"), {
			target: { value: "ADD_TO_EXISTING_CASH" },
		});
		fireEvent.change(screen.getByLabelText(/数量/), {
			target: { value: "1" },
		});
		fireEvent.change(screen.getByLabelText("目标现金账户"), {
			target: { value: "9" },
		});
		fireEvent.click(screen.getByRole("button", { name: "确认卖出" }));

		await waitFor(() => {
			expect(onCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					side: "SELL",
					symbol: "AAPL",
					market: "US",
					fallback_currency: "USD",
					cost_basis_price: 188,
					started_on: "2026-03-09",
					sell_proceeds_handling: "ADD_TO_EXISTING_CASH",
					sell_proceeds_account_id: 9,
				}),
			);
		});
	});

	it("clamps sell quantity to the available holding quantity while typing", () => {
		render(
			<HoldingForm
				intent="sell"
				maxStartedOnDate="2026-03-09"
				existingHoldings={existingHoldings}
			/>,
		);

		fireEvent.change(screen.getByLabelText("卖出持仓"), {
			target: { value: "AAPL::US" },
		});
		fireEvent.change(screen.getByLabelText(/数量/), {
			target: { value: "5" },
		});

		expect((screen.getByLabelText(/数量/) as HTMLInputElement).value).toBe("3");
	});

	it("disables merging into an existing cash account when no cash account exists", () => {
		render(
			<HoldingForm
				intent="sell"
				existingHoldings={existingHoldings}
				maxStartedOnDate="2026-03-09"
			/>,
		);

		fireEvent.change(screen.getByLabelText("卖出持仓"), {
			target: { value: "AAPL::US" },
		});

		expect(screen.queryByRole("option", { name: "并入现有现金账户" })).toBeNull();
		expect(
			screen.getByText("当前没有现金账户 如需并入现有账户 请先新增现金账户"),
		).not.toBeNull();
		expect((screen.getByLabelText("卖出价（计价币种）") as HTMLInputElement).value).toBe("188");
	});

	it("falls back to auto create cash when stale sell proceeds selection has no cash account", async () => {
		render(
			<HoldingForm
				intent="sell"
				existingHoldings={existingHoldings}
				maxStartedOnDate="2026-03-09"
				value={{
					side: "SELL",
					symbol: "AAPL",
					name: "Apple",
					market: "US",
					fallback_currency: "USD",
					sell_proceeds_handling: "ADD_TO_EXISTING_CASH",
				}}
			/>,
		);

		await waitFor(() => {
			expect(
				(screen.getByLabelText("卖出回款去向") as HTMLSelectElement).value,
			).toBe("CREATE_NEW_CASH");
		});
	});
});
