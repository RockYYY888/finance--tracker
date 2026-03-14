import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssetRecordsDialog } from "./AssetRecordsDialog";
import type { AssetRecordRecord } from "../../types/assets";

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
		expect(
			within(recordCard as HTMLElement)
				.getByText("80 HKD")
				.closest(".asset-records__profit-chip"),
		).not.toBeNull();
	});
});
