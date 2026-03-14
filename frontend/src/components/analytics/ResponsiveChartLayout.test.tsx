import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AllocationChart } from "./AllocationChart";
import { HoldingsBreakdownChart } from "./HoldingsBreakdownChart";
import { PlatformBreakdownChart } from "./PlatformBreakdownChart";
import { PortfolioTrendChart } from "./PortfolioTrendChart";
import { ReturnTrendChart, createAggregateReturnOption } from "./ReturnTrendChart";

const rechartsState = vi.hoisted(() => ({
	responsiveContainers: [] as Array<{ width?: string | number; height?: string | number }>,
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
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
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

	it("falls back to the first renderable portfolio trend range and disables sparse ranges", async () => {
		render(
			<PortfolioTrendChart
				defaultRange="hour"
				hour_series={[
					{ label: "03-14 14:00", value: 100_000 },
				]}
				day_series={[
					{ label: "03-13", value: 98_000 },
					{ label: "03-14", value: 100_000 },
				]}
				month_series={[
					{ label: "2026-03", value: 100_000 },
				]}
				year_series={[
					{ label: "2026", value: 100_000 },
				]}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "30天" }).className).toContain("active");
		});

		expect((screen.getByRole("button", { name: "24H" }) as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByRole("button", { name: "12月" }) as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByRole("button", { name: "年" }) as HTMLButtonElement).disabled).toBe(true);
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

	it("falls back to the first renderable return trend range and disables sparse ranges", async () => {
		render(
			<ReturnTrendChart
				defaultRange="hour"
				title="收益趋势"
				description="测试"
				seriesOptions={[
					createAggregateReturnOption(
						"组合",
						[
							{ label: "03-14 14:00", value: 1.2 },
						],
						[
							{ label: "03-13", value: 0.6 },
							{ label: "03-14", value: 1.2 },
						],
						[
							{ label: "2026-03", value: 1.2 },
						],
						[
							{ label: "2026", value: 1.2 },
						],
					),
				]}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "30天" }).className).toContain("active");
		});

		expect((screen.getByRole("button", { name: "24H" }) as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByRole("button", { name: "12月" }) as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByRole("button", { name: "年" }) as HTMLButtonElement).disabled).toBe(true);
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
			expect(getLastRecordedProps(rechartsState.responsiveContainers).height).toBeLessThan(260);
		});

		const responsiveContainerProps = getLastRecordedProps(rechartsState.responsiveContainers);
		const pieProps = getLastRecordedProps(rechartsState.pies) as {
			innerRadius: number;
			outerRadius: number;
		};

		expect(responsiveContainerProps.height).toBe(220);
		expect(pieProps.outerRadius).toBeLessThan(102);
		expect(pieProps.innerRadius).toBeLessThan(72);
	});
});
