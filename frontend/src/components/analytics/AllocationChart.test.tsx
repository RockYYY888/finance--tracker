import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AllocationChart } from "./AllocationChart";

vi.mock("recharts", () => ({
	ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
		<>{children}</>
	),
	PieChart: ({ children }: { children?: ReactNode }) => <>{children}</>,
	Pie: ({ children }: { children?: ReactNode }) => <>{children}</>,
	BarChart: ({ children }: { children?: ReactNode }) => <>{children}</>,
	Bar: ({ children }: { children?: ReactNode }) => <>{children}</>,
	CartesianGrid: () => null,
	XAxis: () => null,
	YAxis: () => null,
	Tooltip: () => null,
	Cell: () => null,
}));

class MockResizeObserver {
	private readonly callback: ResizeObserverCallback;

	constructor(callback: ResizeObserverCallback) {
		this.callback = callback;
	}

	observe(target: Element) {
		this.callback(
			[
				{
					target,
					contentRect: {
						width: 320,
						height: 240,
						x: 0,
						y: 0,
						top: 0,
						left: 0,
						bottom: 240,
						right: 320,
						toJSON() {
							return {};
						},
					},
				} as ResizeObserverEntry,
			],
			this as unknown as ResizeObserver,
		);
	}

	unobserve() {}

	disconnect() {}
}

describe("AllocationChart", () => {
	beforeEach(() => {
		vi.stubGlobal("ResizeObserver", MockResizeObserver);
		vi
			.spyOn(HTMLElement.prototype, "getBoundingClientRect")
			.mockImplementation(() => ({
				width: 320,
				height: 240,
				top: 0,
				left: 0,
				bottom: 240,
				right: 320,
				x: 0,
				y: 0,
				toJSON() {
					return {};
				},
			}));
	});

	it("locks the category breakdown on click instead of hover", () => {
		render(
			<AllocationChart
				total_value_cny={640_000}
				allocation={[
					{ label: "现金", value: 120_000 },
					{ label: "投资类", value: 300_000 },
					{ label: "固定资产", value: 200_000 },
					{ label: "其他", value: 20_000 },
				]}
				cash_accounts={[
					{
						id: 1,
						name: "支付宝",
						platform: "支付宝",
						balance: 120_000,
						currency: "CNY",
						account_type: "ALIPAY",
						fx_to_cny: 1,
						value_cny: 120_000,
					},
				]}
				holdings={[
					{
						id: 1,
						symbol: "0700.HK",
						name: "腾讯控股",
						quantity: 10,
						fallback_currency: "HKD",
						market: "HK",
						price: 210,
						price_currency: "HKD",
						fx_to_cny: 0.91,
						value_cny: 210_000,
						last_updated: null,
					},
					{
						id: 2,
						symbol: "9988.HK",
						name: "阿里巴巴",
						quantity: 10,
						fallback_currency: "HKD",
						market: "HK",
						price: 90,
						price_currency: "HKD",
						fx_to_cny: 0.91,
						value_cny: 90_000,
						last_updated: null,
					},
				]}
				fixed_assets={[
					{
						id: 1,
						name: "房产",
						category: "REAL_ESTATE",
						current_value_cny: 200_000,
						value_cny: 200_000,
					},
				]}
				other_assets={[
					{
						id: 1,
						name: "应收账款",
						category: "RECEIVABLE",
						current_value_cny: 20_000,
						value_cny: 20_000,
					},
				]}
			/>,
		);

		fireEvent.mouseEnter(screen.getByRole("button", { name: /投资类/ }));

		expect(screen.queryByText("腾讯控股")).toBeNull();
		expect(screen.queryByText("阿里巴巴")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: /投资类/ }));

		expect(screen.getByText("点击大类后切换对应柱状图")).toBeTruthy();
		expect(screen.getAllByText("投资类").length).toBeGreaterThan(1);
	});
});
