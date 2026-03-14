import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AllocationChart } from "./AllocationChart";
import { HoldingsBreakdownChart } from "./HoldingsBreakdownChart";
import { PlatformBreakdownChart } from "./PlatformBreakdownChart";
import { PortfolioAnalytics } from "./PortfolioAnalytics";
import { PortfolioTrendChart } from "./PortfolioTrendChart";
import {
	ReturnTrendChart,
	createAggregateReturnOption,
} from "./ReturnTrendChart";

const rechartsState = vi.hoisted(() => ({
	responsiveContainers: [] as Array<{
		width?: string | number;
		height?: string | number;
	}>,
	xAxes: [] as Array<Record<string, unknown>>,
	yAxes: [] as Array<Record<string, unknown>>,
	pies: [] as Array<Record<string, unknown>>,
	cartesianGrids: [] as Array<Record<string, unknown>>,
	referenceLines: [] as Array<Record<string, unknown>>,
}));

vi.mock("recharts", () => ({
	ResponsiveContainer: ({
		children,
		...props
	}: {
		children?: ReactNode;
		width?: string | number;
		height?: string | number;
	}) => {
		rechartsState.responsiveContainers.push(props);
		return <>{children}</>;
	},
	ComposedChart: ({ children }: { children?: ReactNode }) => <>{children}</>,
	BarChart: ({ children }: { children?: ReactNode }) => <>{children}</>,
	PieChart: ({ children }: { children?: ReactNode }) => <>{children}</>,
	CartesianGrid: (props: Record<string, unknown>) => {
		rechartsState.cartesianGrids.push(props);
		return null;
	},
	Tooltip: () => null,
	ReferenceLine: (props: Record<string, unknown>) => {
		rechartsState.referenceLines.push(props);
		return null;
	},
	Area: () => null,
	Line: () => null,
	XAxis: (props: Record<string, unknown>) => {
		rechartsState.xAxes.push(props);
		return null;
	},
	YAxis: (props: Record<string, unknown>) => {
		rechartsState.yAxes.push(props);
		return null;
	},
	Pie: ({
		children,
		...props
	}: {
		children?: ReactNode;
		innerRadius?: number;
		outerRadius?: number;
	}) => {
		rechartsState.pies.push(props);
		return <>{children}</>;
	},
	Bar: ({ children }: { children?: ReactNode }) => <>{children}</>,
	Cell: () => null,
}));

function getLastRecordedProps<T>(items: T[]): T {
	expect(items.length).toBeGreaterThan(0);
	return items[items.length - 1]!;
}

let currentChartWidth = 220;

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
						width: currentChartWidth,
						height: 260,
						x: 0,
						y: 0,
						top: 0,
						left: 0,
						bottom: 260,
						right: currentChartWidth,
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

describe("analytics charts responsive layout", () => {
	beforeEach(() => {
		rechartsState.responsiveContainers.length = 0;
		rechartsState.xAxes.length = 0;
		rechartsState.yAxes.length = 0;
		rechartsState.pies.length = 0;
		rechartsState.cartesianGrids.length = 0;
		rechartsState.referenceLines.length = 0;
		currentChartWidth = 220;

		vi.stubGlobal("ResizeObserver", MockResizeObserver);
		vi
			.spyOn(HTMLElement.prototype, "getBoundingClientRect")
			.mockImplementation(() => ({
				width: currentChartWidth,
				height: 260,
				top: 0,
				left: 0,
				bottom: 260,
				right: currentChartWidth,
				x: 0,
				y: 0,
				toJSON() {
					return {};
				},
			}));
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("keeps portfolio trend chart compact and range-aware in narrow containers", async () => {
		render(
			<PortfolioTrendChart
				defaultRange="day"
				hour_series={[]}
				day_series={Array.from({ length: 8 }, (_, index) => ({
					label: `03-0${index + 1} 04:00`,
					value: 100_000 + index * 3_000,
				}))}
				month_series={[]}
				year_series={[]}
			/>,
		);

		await waitFor(() => {
			expect(getLastRecordedProps(rechartsState.xAxes).height).toBe(30);
		});

		const xAxisProps = getLastRecordedProps(rechartsState.xAxes) as {
			height: number;
			interval: number;
			ticks: string[];
			padding: { left: number; right: number };
			tickFormatter: (label: string) => string;
		};
		expect(xAxisProps.interval).toBe(0);
		expect(xAxisProps.ticks).toHaveLength(3);
		expect(xAxisProps.padding.right).toBeGreaterThan(0);
		expect(xAxisProps.tickFormatter("03-08 04:00")).toBe("03-08");
	});

	it("falls back to the first renderable portfolio trend range and hides sparse ranges", async () => {
		render(
			<PortfolioTrendChart
				defaultRange="hour"
				hour_series={[{ label: "03-14 14:00", value: 100_000 }]}
				day_series={[
					{ label: "03-13", value: 98_000 },
					{ label: "03-14", value: 100_000 },
				]}
				month_series={[{ label: "2026-03", value: 100_000 }]}
				year_series={[{ label: "2026", value: 100_000 }]}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "30天" }).className).toContain(
				"active",
			);
		});

		expect(screen.queryByRole("button", { name: "24H" })).toBeNull();
		expect(screen.queryByRole("button", { name: "12月" })).toBeNull();
		expect(screen.queryByRole("button", { name: "年" })).toBeNull();
	});

	it("switches the portfolio trend card between total value and aggregate return", async () => {
		render(
			<PortfolioTrendChart
				defaultRange="day"
				hour_series={[]}
				day_series={[
					{ label: "03-01", value: 100_000 },
					{ label: "03-02", value: 108_000 },
					{ label: "03-03", value: 112_000 },
				]}
				month_series={[]}
				year_series={[]}
				holdings_return_hour_series={[]}
				holdings_return_day_series={[
					{ label: "03-01", value: 8 },
					{ label: "03-02", value: 10 },
					{ label: "03-03", value: 12 },
				]}
				holdings_return_month_series={[]}
				holdings_return_year_series={[]}
			/>,
		);

		expect(screen.getByRole("button", { name: "资产总额" }).className).toContain(
			"active",
		);

		screen.getByRole("button", { name: "投资类收益率" }).click();

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "投资类收益率" }).className).toContain(
				"active",
			);
		});

		expect(screen.getByText("基准线上方区域")).toBeTruthy();
		expect(screen.queryByText("最新净值")).toBeNull();
		expect(screen.getByText("当前投资类收益率")).toBeTruthy();
		expect(screen.getAllByText("03-01→03-03")).toHaveLength(1);
		expect(screen.getByText("+2.00%")).toBeTruthy();
	});

	it("shows return deltas as direct percent changes instead of exploding relative ratios", async () => {
		render(
			<PortfolioTrendChart
				defaultRange="day"
				hour_series={[]}
				day_series={[
					{ label: "03-01", value: 250_000 },
					{ label: "03-14", value: 230_000 },
				]}
				month_series={[]}
				year_series={[]}
				holdings_return_hour_series={[]}
				holdings_return_day_series={[
					{ label: "03-01", value: 0.01 },
					{ label: "03-14", value: -7.55 },
				]}
				holdings_return_month_series={[]}
				holdings_return_year_series={[]}
			/>,
		);

		screen.getByRole("button", { name: "投资类收益率" }).click();

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "投资类收益率" }).className).toContain(
				"active",
			);
		});

		const summaryPill = screen.getByText("03-01→03-14").parentElement;
		expect(summaryPill?.textContent).toContain("-7.56%");
		expect(summaryPill?.textContent).not.toContain("75600.00%");
	});

	it("keeps headroom above the zero reference in aggregate and holding return charts", async () => {
		render(
			<PortfolioTrendChart
				defaultRange="day"
				hour_series={[]}
				day_series={[
					{ label: "03-01", value: 250_000 },
					{ label: "03-14", value: 230_000 },
				]}
				month_series={[]}
				year_series={[]}
				holdings_return_hour_series={[]}
				holdings_return_day_series={[
					{ label: "03-01", value: -4.2 },
					{ label: "03-14", value: -7.55 },
				]}
				holdings_return_month_series={[]}
				holdings_return_year_series={[]}
			/>,
		);

		screen.getByRole("button", { name: "投资类收益率" }).click();

		await waitFor(() => {
			const axisProps = getLastRecordedProps(rechartsState.yAxes) as {
				domain: [number, number];
			};
			expect(axisProps.domain[1]).toBeGreaterThan(0);
		});

		render(
			<ReturnTrendChart
				defaultRange="day"
				title="单只持仓收益率"
				description="测试"
				seriesOptions={[
					createAggregateReturnOption(
						"腾讯控股",
						[],
						[
							{ label: "03-01", value: -3.4 },
							{ label: "03-14", value: -7.8 },
						],
						[],
						[],
					),
				]}
			/>,
		);

		await waitFor(() => {
			const axisProps = getLastRecordedProps(rechartsState.yAxes) as {
				domain: [number, number];
			};
			expect(axisProps.domain[1]).toBeGreaterThan(0);
		});
	});

	it("keeps return trend chart compact and compresses yearly labels in narrow containers", async () => {
		render(
			<ReturnTrendChart
				defaultRange="year"
				title="收益趋势"
				description="测试"
				seriesOptions={[
					createAggregateReturnOption(
						"组合",
						[],
						[],
						[],
						Array.from({ length: 8 }, (_, index) => ({
							label: `2026-0${index + 1}`,
							value: index - 4,
						})),
					),
				]}
			/>,
		);

		await waitFor(() => {
			expect(getLastRecordedProps(rechartsState.xAxes).height).toBe(30);
		});

		const xAxisProps = getLastRecordedProps(rechartsState.xAxes) as {
			height: number;
			interval: number;
			ticks: string[];
			padding: { left: number; right: number };
			tickFormatter: (label: string) => string;
		};
		expect(xAxisProps.interval).toBe(0);
		expect(xAxisProps.ticks).toHaveLength(3);
		expect(xAxisProps.padding.right).toBeGreaterThan(0);
		expect(xAxisProps.tickFormatter("2026-03")).toBe("2026");
	});

	it("falls back to the first renderable return trend range and hides sparse ranges", async () => {
		render(
			<ReturnTrendChart
				defaultRange="hour"
				title="收益趋势"
				description="测试"
				seriesOptions={[
					createAggregateReturnOption(
						"组合",
						[{ label: "03-14 14:00", value: 1.2 }],
						[
							{ label: "03-13", value: 0.6 },
							{ label: "03-14", value: 1.2 },
						],
						[{ label: "2026-03", value: 1.2 }],
						[{ label: "2026", value: 1.2 }],
					),
				]}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "30天" }).className).toContain(
				"active",
			);
		});

		expect(screen.queryByRole("button", { name: "24H" })).toBeNull();
		expect(screen.queryByRole("button", { name: "12月" })).toBeNull();
		expect(screen.queryByRole("button", { name: "年" })).toBeNull();
	});

	it("does not render dashed helper lines in timeline charts", async () => {
		render(
			<PortfolioTrendChart
				defaultRange="day"
				hour_series={[]}
				day_series={[
					{ label: "03-01", value: 100_000 },
					{ label: "03-02", value: 110_000 },
				]}
				month_series={[]}
				year_series={[]}
			/>,
		);

		render(
			<ReturnTrendChart
				defaultRange="day"
				title="收益趋势"
				description="测试"
				seriesOptions={[
					createAggregateReturnOption(
						"组合",
						[],
						[
							{ label: "03-01", value: 2 },
							{ label: "03-02", value: 3.5 },
						],
						[],
						[],
					),
				]}
			/>,
		);

		await waitFor(() => {
			expect(rechartsState.cartesianGrids.length).toBeGreaterThanOrEqual(2);
			expect(rechartsState.referenceLines.length).toBeGreaterThanOrEqual(2);
		});

		rechartsState.cartesianGrids.forEach((gridProps) => {
			expect(gridProps.strokeDasharray).toBeUndefined();
		});
		rechartsState.referenceLines.forEach((lineProps) => {
			expect(lineProps.strokeDasharray).toBeUndefined();
		});
	});

	it("expands holdings category axis width instead of keeping a fixed narrow rail", async () => {
		render(
			<HoldingsBreakdownChart
				holdings={[
					{
						id: 1,
						symbol: "LONG",
						name: "Global Brokerage Account",
						quantity: 1,
						fallback_currency: "USD",
						market: "US",
						price: 100,
						price_currency: "USD",
						fx_to_cny: 7,
						value_cny: 12_345,
						broker: null,
						started_on: "2026-03-01",
						last_updated: "2026-03-01T00:00:00Z",
					},
				]}
			/>,
		);

		await waitFor(() => {
			expect(getLastRecordedProps(rechartsState.yAxes).width).toBeGreaterThan(88);
		});

		const yAxisProps = getLastRecordedProps(rechartsState.yAxes) as {
			width: number;
			tickFormatter: (label: string) => string;
		};
		expect(yAxisProps.tickFormatter("Global Brokerage Account")).toBe("Global …");
	});

	it("expands platform category axis width under the same narrow layout rules", async () => {
		render(
			<PlatformBreakdownChart
				cash_accounts={[
					{
						id: 1,
						name: "Cash",
						platform: "Global Brokerage Account",
						currency: "USD",
						balance: 100,
						account_type: "BANK",
						fx_to_cny: 7,
						value_cny: 700,
					},
				]}
				holdings={[]}
				fixed_assets={[]}
				liabilities={[]}
				other_assets={[]}
			/>,
		);

		await waitFor(() => {
			expect(getLastRecordedProps(rechartsState.yAxes).width).toBeGreaterThan(88);
		});

		const yAxisProps = getLastRecordedProps(rechartsState.yAxes) as {
			width: number;
			tickFormatter: (label: string) => string;
		};
		expect(yAxisProps.tickFormatter("Global Brokerage Account")).toBe("Global …");
	});

	it("shrinks allocation donut geometry in very narrow containers", async () => {
		currentChartWidth = 180;

		render(
			<AllocationChart
				total_value_cny={10_000}
				allocation={[
					{ label: "股票", value: 6_000 },
					{ label: "现金", value: 4_000 },
				]}
			/>,
		);

		await waitFor(() => {
			expect(
				rechartsState.responsiveContainers.some(
					(props) => typeof props.height === "number" && props.height < 260,
				),
			).toBe(true);
		});

		const responsiveContainerProps = rechartsState.responsiveContainers.find(
			(props) => typeof props.height === "number" && props.height < 260,
		);
		const pieProps = getLastRecordedProps(rechartsState.pies) as {
			innerRadius: number;
			outerRadius: number;
		};

		expect(responsiveContainerProps?.height).toBe(244);
		expect(pieProps.outerRadius).toBeLessThan(102);
		expect(pieProps.innerRadius).toBeLessThan(72);
	});

	it("renders analytics without the duplicate aggregate return card", () => {
		render(
			<PortfolioAnalytics
				total_value_cny={120_000}
				cash_accounts={[]}
				holdings={[]}
				fixed_assets={[]}
				liabilities={[]}
				other_assets={[]}
				allocation={[
					{ label: "现金", value: 20_000 },
					{ label: "投资类", value: 100_000 },
				]}
				hour_series={[]}
				day_series={[
					{ label: "03-01", value: 100_000 },
					{ label: "03-02", value: 120_000 },
				]}
				month_series={[]}
				year_series={[]}
				holdings_return_hour_series={[]}
				holdings_return_day_series={[
					{ label: "03-01", value: 8 },
					{ label: "03-02", value: 12 },
				]}
				holdings_return_month_series={[]}
				holdings_return_year_series={[]}
				holding_return_series={[]}
			/>,
		);

		expect(screen.queryByText("非现金资产收益率")).toBeNull();
		expect(screen.getByText("单只持仓收益率")).toBeTruthy();
		expect(screen.getByText("资产分布")).toBeTruthy();
		expect(screen.queryByText("持仓拆解")).toBeNull();
	});
});
