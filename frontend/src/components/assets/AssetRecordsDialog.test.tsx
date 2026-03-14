import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssetRecordsDialog } from "./AssetRecordsDialog";
import type { AssetRecordRecord } from "../../types/assets";

const CASH_RECORD: AssetRecordRecord = {
	id: 1,
	source: "USER",
	asset_class: "cash",
	operation_kind: "NEW",
	entity_type: "CASH_ACCOUNT",
	entity_id: 1,
	title: "支付宝",
	summary: "新增现金账户",
	effective_date: "2026-03-09",
	amount: 6896.6,
	currency: "CNY",
	created_at: "2026-03-09T13:00:00Z",
};

const SELL_RECORD: AssetRecordRecord = {
	id: 9,
	source: "AGENT",
	asset_class: "investment",
	operation_kind: "SELL",
	entity_type: "HOLDING_TRANSACTION",
	entity_id: 9,
	title: "腾讯控股 (0700.HK)",
	summary: "新增卖出 · 数量 4 · 价格 120 HKD",
	symbol: "0700.HK",
	effective_date: "2026-03-10",
	amount: 120,
	currency: "HKD",
	profit_amount: 80,
	profit_currency: "HKD",
	profit_rate_pct: 20,
	created_at: "2026-03-10T13:00:00Z",
};

function createDeferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
} {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((nextResolve) => {
		resolve = nextResolve;
	});
	return { promise, resolve };
}

describe("AssetRecordsDialog", () => {
	afterEach(() => {
		cleanup();
	});

	it("loads cash records with all filters by default on open", async () => {
		const onLoadRecords = vi.fn().mockResolvedValue([]);

		render(
			<AssetRecordsDialog
				open
				onClose={() => undefined}
				onLoadRecords={onLoadRecords}
			/>,
		);

		await waitFor(() => {
			expect(onLoadRecords).toHaveBeenCalledWith({
				limit: 200,
				assetClass: "cash",
				operationKind: undefined,
				source: undefined,
			});
		});

		expect(screen.getByText("记录")).not.toBeNull();
		expect(screen.getByRole("button", { name: "现金类" })).not.toBeNull();
		expect(screen.getAllByRole("button", { name: "全部" })).toHaveLength(2);
		expect(document.querySelector(".feedback-modal")).not.toBeNull();
	});

	it("supports secondary filters and shows investment profit in project colors", async () => {
		const onLoadRecords = vi
			.fn()
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([SELL_RECORD])
			.mockResolvedValueOnce([SELL_RECORD]);

		render(
			<AssetRecordsDialog
				open
				onClose={() => undefined}
				onLoadRecords={onLoadRecords}
			/>,
		);

		await waitFor(() => {
			expect(onLoadRecords).toHaveBeenCalledTimes(1);
		});

		fireEvent.click(screen.getByRole("button", { name: "投资类" }));

		await waitFor(() => {
			expect(onLoadRecords).toHaveBeenLastCalledWith({
				limit: 200,
				assetClass: "investment",
				operationKind: undefined,
				source: undefined,
			});
		});

		fireEvent.click(screen.getByRole("button", { name: "卖出" }));

		await waitFor(() => {
			expect(onLoadRecords).toHaveBeenLastCalledWith({
				limit: 200,
				assetClass: "investment",
				operationKind: "SELL",
				source: undefined,
			});
		});

		const recordTitle = await screen.findByText("腾讯控股 (0700.HK)");
		const recordCard = recordTitle.closest(".asset-manager__card");
		expect(recordCard).not.toBeNull();
		expect(within(recordCard as HTMLElement).getByText("Agent")).not.toBeNull();
		expect(within(recordCard as HTMLElement).getByText("收益率 20.00%")).not.toBeNull();
		expect(within(recordCard as HTMLElement).getByText("操作时间")).not.toBeNull();
		expect(within(recordCard as HTMLElement).getByText("2026/03/10 21:00:00.000")).not.toBeNull();
		expect(
			within(recordCard as HTMLElement)
				.getByText("80 HKD")
				.closest(".asset-records__profit-chip"),
		).not.toBeNull();
	});

	it("keeps the previous result visible while filters refresh and reuses cached filters", async () => {
		const investmentRequest = createDeferred<AssetRecordRecord[]>();
		const cashRefreshRequest = createDeferred<AssetRecordRecord[]>();
		const onLoadRecords = vi
			.fn()
			.mockResolvedValueOnce([CASH_RECORD])
			.mockImplementationOnce(() => investmentRequest.promise)
			.mockImplementationOnce(() => cashRefreshRequest.promise);

		render(
			<AssetRecordsDialog
				open
				onClose={() => undefined}
				onLoadRecords={onLoadRecords}
			/>,
		);

		await screen.findByText("支付宝");

		fireEvent.click(screen.getByRole("button", { name: "投资类" }));

		expect(screen.getByText("支付宝")).not.toBeNull();
		expect(screen.getByText("正在更新记录...")).not.toBeNull();
		expect(screen.queryByText("正在加载记录...")).toBeNull();

		investmentRequest.resolve([SELL_RECORD]);
		await screen.findByText("腾讯控股 (0700.HK)");

		fireEvent.click(screen.getByRole("button", { name: "现金类" }));

		expect(screen.getByText("支付宝")).not.toBeNull();
		expect(screen.getByText("正在更新记录...")).not.toBeNull();
		expect(screen.queryByText("正在加载记录...")).toBeNull();

		cashRefreshRequest.resolve([CASH_RECORD]);
		await waitFor(() => {
			expect(onLoadRecords).toHaveBeenCalledTimes(3);
		});
	});

	it("renders records inside a dedicated scroll region while header and filters stay outside", async () => {
		const onLoadRecords = vi.fn().mockResolvedValue([CASH_RECORD, SELL_RECORD]);

		render(
			<AssetRecordsDialog
				open
				onClose={() => undefined}
				onLoadRecords={onLoadRecords}
			/>,
		);

		const scrollRegion = await waitFor(() => {
			const nextScrollRegion = document.querySelector(".asset-records__scroll-region");
			expect(nextScrollRegion).not.toBeNull();
			return nextScrollRegion as HTMLElement;
		});

		expect(scrollRegion.querySelector(".asset-records__list")).not.toBeNull();
		expect(scrollRegion.textContent).toContain("支付宝");
		expect(scrollRegion.textContent).toContain("腾讯控股 (0700.HK)");
		expect(scrollRegion.textContent).not.toContain("资产类别");
		expect(scrollRegion.textContent).not.toContain("操作类型");
		expect(scrollRegion.textContent).not.toContain("来源");
	});
});
