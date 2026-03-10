import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetManager } from "./AssetManager";

afterEach(() => {
	window.sessionStorage.clear();
	cleanup();
});

const baseHolding = {
	id: 1,
	side: "BUY" as const,
	symbol: "AAPL",
	name: "Apple",
	quantity: 2,
	fallback_currency: "USD",
	cost_basis_price: 180,
	market: "US" as const,
	broker: "Futu",
	started_on: "2026-03-08",
	note: "长期",
	price: 188,
	price_currency: "USD",
	value_cny: 2710,
	return_pct: 4.44,
	last_updated: "2026-03-10T12:00:00Z",
};

describe("AssetManager refresh stability", () => {
	it("keeps buy form input when upstream asset props refresh", () => {
		const { rerender } = render(
			<AssetManager
				defaultSection="investment"
				initialHoldings={[baseHolding]}
				title="资产管理"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "新增买入" }));
		expect(screen.queryByRole("heading", { name: "投资类持仓" })).toBeNull();
		expect(screen.queryByRole("heading", { name: "交易记录" })).toBeNull();
		fireEvent.change(screen.getByLabelText("数量"), {
			target: { value: "12" },
		});
		fireEvent.change(screen.getByLabelText("备注"), {
			target: { value: "等下一轮行情确认" },
		});

		rerender(
			<AssetManager
				defaultSection="investment"
				initialHoldings={[
					{
						...baseHolding,
						price: 190,
						value_cny: 2739,
						last_updated: "2026-03-10T12:01:00Z",
					},
				]}
				title="资产管理"
			/>,
		);

		expect(screen.getByRole("heading", { name: "新增买入" })).not.toBeNull();
		expect((screen.getByLabelText("数量") as HTMLInputElement).value).toBe("12");
		expect((screen.getByLabelText("备注") as HTMLTextAreaElement).value).toBe(
			"等下一轮行情确认",
		);
	});

	it("keeps edit mode stable when upstream holdings refresh while editing", () => {
		const { rerender } = render(
			<AssetManager
				defaultSection="investment"
				initialHoldings={[baseHolding]}
				title="资产管理"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "编辑" }));
		expect(screen.getByRole("heading", { name: "编辑投资持仓" })).not.toBeNull();
		expect(screen.queryByRole("heading", { name: "交易记录" })).toBeNull();

		rerender(
			<AssetManager
				defaultSection="investment"
				initialHoldings={[]}
				title="资产管理"
			/>,
		);

		expect(screen.getByRole("heading", { name: "编辑投资持仓" })).not.toBeNull();
		expect(screen.getByRole("button", { name: "保存编辑" })).not.toBeNull();
	});

	it("uses the holding card edit flow instead of transaction-level repair", async () => {
		const holdingUpdate = vi.fn().mockResolvedValue({
			...baseHolding,
			quantity: 3,
			cost_basis_price: 182,
			started_on: "2026-03-07",
		});
		const transactionEdit = vi.fn();
		const holdingTransactionRefresh = vi.fn().mockResolvedValue([
			{
				id: 9,
				symbol: "AAPL",
				name: "Apple",
				side: "ADJUST" as const,
				quantity: 3,
				price: 182,
				fallback_currency: "USD",
				market: "US" as const,
				traded_on: "2026-03-07",
				note: "修正持仓",
			},
		]);

		render(
			<AssetManager
				defaultSection="investment"
				initialHoldings={[baseHolding]}
				holdingActions={{ onEdit: holdingUpdate }}
				holdingTransactionActions={{
					onRefresh: holdingTransactionRefresh,
					onEdit: transactionEdit,
				}}
				title="资产管理"
			/>,
		);

		expect(screen.queryByRole("button", { name: "修正记录" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "编辑" }));
		fireEvent.change(screen.getByLabelText("持仓数量（股/支）"), {
			target: { value: "3" },
		});
		fireEvent.change(screen.getByLabelText("持仓价（计价币种）"), {
			target: { value: "182" },
		});
		fireEvent.click(screen.getByRole("button", { name: "保存编辑" }));

		await waitFor(() => {
			expect(holdingUpdate).toHaveBeenCalledWith(
				1,
				expect.objectContaining({
					quantity: 3,
					cost_basis_price: 182,
					started_on: "2026-03-08",
				}),
			);
		});
		expect(transactionEdit).not.toHaveBeenCalled();
	});

	it("loads each section once and does not refetch a loaded tab on revisit", async () => {
		const cashRefresh = vi.fn().mockResolvedValue([]);
		const holdingRefresh = vi.fn().mockResolvedValue([baseHolding]);

		render(
			<AssetManager
				defaultSection="investment"
				loadOnMount
				cashActions={{ onRefresh: cashRefresh }}
				holdingActions={{ onRefresh: holdingRefresh }}
				title="资产管理"
			/>,
		);

		await waitFor(() => {
			expect(holdingRefresh).toHaveBeenCalledTimes(1);
		});
		expect(cashRefresh).toHaveBeenCalledTimes(1);

		fireEvent.click(screen.getByRole("tab", { name: /现金/ }));

		await waitFor(() => {
			expect(cashRefresh).toHaveBeenCalledTimes(1);
		});

		fireEvent.click(screen.getByRole("tab", { name: /投资类/ }));

		await waitFor(() => {
			expect(holdingRefresh).toHaveBeenCalledTimes(1);
		});
	});

	it("does not refetch the active section on unrelated parent rerender", async () => {
		const holdingRefresh = vi.fn().mockResolvedValue([baseHolding]);
		const { rerender } = render(
			<AssetManager
				defaultSection="investment"
				loadOnMount
				holdingActions={{ onRefresh: holdingRefresh }}
				title="资产管理"
			/>,
		);

		await waitFor(() => {
			expect(holdingRefresh).toHaveBeenCalledTimes(1);
		});

		rerender(
			<AssetManager
				defaultSection="investment"
				loadOnMount
				holdingActions={{ onRefresh: holdingRefresh }}
				title="资产管理（刷新摘要）"
			/>,
		);

		await waitFor(() => {
			expect(holdingRefresh).toHaveBeenCalledTimes(1);
		});
	});

	it("shows cash transfer entry from the cash list instead of standalone transfer panels", () => {
		render(
			<AssetManager
				defaultSection="cash"
				initialCashAccounts={[
					{
						id: 1,
						name: "主账户",
						platform: "Bank",
						currency: "CNY",
						balance: 100,
						account_type: "BANK",
						value_cny: 100,
					},
					{
						id: 2,
						name: "备用金",
						platform: "Cash",
						currency: "CNY",
						balance: 10,
						account_type: "CASH",
						value_cny: 10,
					},
				]}
				title="资产管理"
			/>,
		);

		expect(screen.getByRole("button", { name: "账户划转" })).not.toBeNull();
		expect(screen.queryByRole("heading", { name: "手工账本调整" })).toBeNull();
		expect(screen.queryByText("还没有账户划转记录。")).toBeNull();
	});

	it("submits a cash transfer without waiting for the cash ledger panel refresh path", async () => {
		const cashRefresh = vi.fn().mockResolvedValue([
			{
				id: 1,
				name: "主账户",
				platform: "Bank",
				currency: "CNY",
				balance: 70,
				account_type: "BANK" as const,
				value_cny: 70,
			},
			{
				id: 2,
				name: "备用金",
				platform: "Cash",
				currency: "CNY",
				balance: 40,
				account_type: "CASH" as const,
				value_cny: 40,
			},
		]);
		const transferCreate = vi.fn().mockResolvedValue(undefined);
		const ledgerRefreshForAccount = vi.fn().mockResolvedValue([]);

		render(
			<AssetManager
				defaultSection="cash"
				initialCashAccounts={[
					{
						id: 1,
						name: "主账户",
						platform: "Bank",
						currency: "CNY",
						balance: 100,
						account_type: "BANK",
						value_cny: 100,
					},
					{
						id: 2,
						name: "备用金",
						platform: "Cash",
						currency: "CNY",
						balance: 10,
						account_type: "CASH",
						value_cny: 10,
					},
				]}
				cashActions={{ onRefresh: cashRefresh }}
				cashTransferActions={{ onCreate: transferCreate }}
				cashLedgerAdjustmentActions={{ onRefreshForAccount: ledgerRefreshForAccount }}
				title="资产管理"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "账户划转" }));
		fireEvent.change(screen.getByLabelText("转出账户"), {
			target: { value: "1" },
		});
		fireEvent.change(screen.getByLabelText("转入账户"), {
			target: { value: "2" },
		});
		fireEvent.change(screen.getByLabelText("划转金额"), {
			target: { value: "30" },
		});
		fireEvent.click(screen.getByRole("button", { name: "确认划转" }));

		await waitFor(() => {
			expect(transferCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					from_account_id: 1,
					to_account_id: 2,
					source_amount: 30,
				}),
			);
		});
		await waitFor(() => {
			expect(cashRefresh).toHaveBeenCalledTimes(1);
		});
		expect(ledgerRefreshForAccount).not.toHaveBeenCalled();
	});
});
