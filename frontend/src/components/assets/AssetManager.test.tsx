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

		rerender(
			<AssetManager
				defaultSection="investment"
				initialHoldings={[]}
				title="资产管理"
			/>,
		);

		expect(screen.getByRole("heading", { name: "编辑投资持仓" })).not.toBeNull();
		expect(screen.getByRole("button", { name: "保存资料" })).not.toBeNull();
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
});
