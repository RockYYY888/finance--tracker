import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PortfolioTrendChart } from "./PortfolioTrendChart";
import {
	ReturnTrendChart,
	createAggregateReturnOption,
} from "./ReturnTrendChart";

const rechartsState = vi.hoisted(() => ({
	composedCharts: [] as Array<Record<string, unknown>>,
}));

vi.mock("recharts", () => ({
	ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
		<>{children}</>
	),
	ComposedChart: ({
		children,
		...props
	}: {
		children?: ReactNode;
		onMouseMove?: (state: Record<string, unknown>) => void;
		onMouseLeave?: () => void;
	}) => {
		rechartsState.composedCharts.push(props);
		return <div data-testid="composed-chart">{children}</div>;
	},
	CartesianGrid: () => null,
	Tooltip: () => null,
	XAxis: () => null,
	YAxis: () => null,
	ReferenceLine: () => null,
	Area: () => null,
	Line: () => null,
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
						width: 360,
						height: 260,
						x: 0,
						y: 0,
						top: 0,
						left: 0,
						bottom: 260,
						right: 360,
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

function getLatestChartHandlers(): {
	onMouseMove?: (state: Record<string, unknown>) => void;
	onMouseLeave?: () => void;
} {
	const latestChart =
		rechartsState.composedCharts[rechartsState.composedCharts.length - 1];
	expect(latestChart).toBeDefined();
	return latestChart as {
		onMouseMove?: (state: Record<string, unknown>) => void;
		onMouseLeave?: () => void;
	};
}

function expectPillToContain(
	label: string,
	expectedText: string,
	occurrence = 0,
): void {
	const pill = screen.getAllByText(label)[occurrence]?.parentElement;
	expect(pill).not.toBeNull();
	expect(pill?.textContent).toContain(expectedText);
}

describe("timeline hover summaries", () => {
	beforeEach(() => {
		rechartsState.composedCharts.length = 0;
		vi.stubGlobal("ResizeObserver", MockResizeObserver);
		vi
			.spyOn(HTMLElement.prototype, "getBoundingClientRect")
			.mockImplementation(() => ({
				width: 360,
				height: 260,
				top: 0,
				left: 0,
				bottom: 260,
				right: 360,
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

	it("updates portfolio trend summary pills while hovering a timeline point", async () => {
		render(
			<PortfolioTrendChart
				defaultRange="day"
				hour_series={[]}
				day_series={[
					{ label: "03-01", value: 100 },
					{ label: "03-02", value: 120 },
					{ label: "03-03", value: 150 },
				]}
				holdings_return_hour_series={[]}
				holdings_return_day_series={[
					{ label: "03-01", value: 10 },
					{ label: "03-02", value: 12 },
					{ label: "03-03", value: 15 },
				]}
				holdings_return_month_series={[]}
				month_series={[]}
				holdings_return_year_series={[]}
				year_series={[]}
			/>,
		);

		expectPillToContain("最新净值", "¥150.00");
		expectPillToContain("03-01→03-03", "增加¥50.00 / +50.00%", 0);
		expectPillToContain("日均环比", "+22.47%");
		expect(screen.queryByText("当前投资类收益率")).toBeNull();
		expect(screen.getAllByText("03-01→03-03")).toHaveLength(1);

		const { onMouseMove, onMouseLeave } = getLatestChartHandlers();
		expect(onMouseMove).toBeDefined();
		expect(onMouseLeave).toBeDefined();

		act(() => {
			onMouseMove?.({
				isTooltipActive: true,
				activeTooltipIndex: 1,
			});
		});

		await waitFor(() => {
			expectPillToContain("所选净值", "¥120.00");
		});
		expectPillToContain("03-01→03-02", "增加¥20.00 / +20.00%", 0);
		expectPillToContain("至该点日均环比", "+20.00%");

		act(() => {
			onMouseLeave?.();
		});

		await waitFor(() => {
			expectPillToContain("最新净值", "¥150.00");
		});

		await act(async () => {
			screen.getByRole("button", { name: "投资类收益率" }).click();
		});

		expectPillToContain("当前投资类收益率", "15.00%");
		expectPillToContain("03-01→03-03", "+5.00%", 0);
		expectPillToContain("日均变动", "+2.50%");
		expect(screen.queryByText("最新净值")).toBeNull();
		expect(screen.getAllByText("03-01→03-03")).toHaveLength(1);

		act(() => {
			onMouseMove?.({
				isTooltipActive: true,
				activeTooltipIndex: 1,
			});
		});

		await waitFor(() => {
			expectPillToContain("所选投资类收益率", "12.00%");
		});
		expectPillToContain("03-01→03-02", "+2.00%", 0);
		expectPillToContain("至该点日均变动", "+2.00%");

		act(() => {
			onMouseLeave?.();
		});

		await waitFor(() => {
			expectPillToContain("当前投资类收益率", "15.00%");
		});
	});

	it("updates return trend summary pills while hovering and restores after leaving", async () => {
		render(
			<ReturnTrendChart
				title="收益趋势"
				description="测试"
				defaultRange="day"
				showCompoundedStepRate
				seriesOptions={[
					createAggregateReturnOption(
						"非现金资产",
						[],
						[
							{ label: "03-01", value: 10 },
							{ label: "03-02", value: 12 },
							{ label: "03-03", value: 15 },
						],
						[],
						[],
					),
				]}
			/>,
		);

		expectPillToContain("当前收益率", "15.00%");
		expectPillToContain("03-01→03-03", "+5.00%");
		expectPillToContain("日均变动", "+2.50%");

		const { onMouseMove, onMouseLeave } = getLatestChartHandlers();

		act(() => {
			onMouseMove?.({
				isTooltipActive: true,
				activeTooltipIndex: 1,
			});
		});

		await waitFor(() => {
			expectPillToContain("所选收益率", "12.00%");
		});
		expectPillToContain("03-01→03-02", "+2.00%");
		expectPillToContain("至该点日均变动", "+2.00%");

		act(() => {
			onMouseLeave?.();
		});

		await waitFor(() => {
			expectPillToContain("当前收益率", "15.00%");
		});
	});

	it("ignores synthetic window boundary points when hovering timeline intersections", async () => {
		render(
			<ReturnTrendChart
				title="收益趋势"
				description="测试"
				defaultRange="hour"
				showCompoundedStepRate
				seriesOptions={[
					createAggregateReturnOption(
						"非现金资产",
						[
							{
								label: "03-14 21:00",
								value: -7.56,
								timestamp_utc: "2026-03-14T13:00:00Z",
							},
						],
						[
							{
								label: "03-13",
								value: -6.82,
								timestamp_utc: "2026-03-12T16:00:00Z",
							},
							{
								label: "03-14",
								value: -7.12,
								timestamp_utc: "2026-03-13T16:00:00Z",
							},
						],
						[],
						[],
					),
				]}
			/>,
		);

		const { onMouseMove } = getLatestChartHandlers();

		act(() => {
			onMouseMove?.({
				isTooltipActive: true,
				activeTooltipIndex: 0,
			});
		});

		await waitFor(() => {
			expectPillToContain("当前收益率", "-7.56%");
		});
		expect(screen.queryByText("所选收益率")).toBeNull();
	});
});
