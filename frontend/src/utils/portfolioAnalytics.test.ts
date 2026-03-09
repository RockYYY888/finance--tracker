import { describe, expect, it } from "vitest";

import {
	calculateDynamicAxisLayout,
	formatCategoryAxisLabel,
	formatTimelineAxisLabel,
	getAdaptiveCategoryAxisWidth,
	getAdaptiveYAxisWidth,
	getAllocationDonutLayout,
	getChartTickInterval,
	prepareTimelineSeries,
	summarizeTimeline,
} from "./portfolioAnalytics";

describe("calculateDynamicAxisLayout", () => {
	it("uses the median as center and symmetric padded domain", () => {
		const layout = calculateDynamicAxisLayout(
			[
				{ label: "A", value: 100 },
				{ label: "B", value: 110 },
				{ label: "C", value: 140 },
				{ label: "D", value: 150 },
			],
			{ paddingRatio: 0.18, minSpan: 1 },
		);

		expect(layout.centerValue).toBe(125);
		expect(layout.domain[0]).toBeLessThanOrEqual(100);
		expect(layout.domain[1]).toBeGreaterThanOrEqual(150);
		expect(layout.centerValue - layout.domain[0]).toBeCloseTo(
			layout.domain[1] - layout.centerValue,
			6,
		);
		expect(layout.tickCount).toBeGreaterThanOrEqual(4);
	});

	it("extends domain to include zero when requested", () => {
		const layout = calculateDynamicAxisLayout(
			[
				{ label: "A", value: 12 },
				{ label: "B", value: 15 },
				{ label: "C", value: 17 },
			],
			{ includeZero: true, minSpan: 1 },
		);

		expect(layout.centerValue).toBe(15);
		expect(layout.domain[0]).toBeLessThanOrEqual(0);
		expect(layout.domain[1]).toBeGreaterThan(15);
		expect(layout.tickCount).toBeGreaterThanOrEqual(4);
	});

	it("keeps a visible range for flat data with minSpan", () => {
		const layout = calculateDynamicAxisLayout(
			[
				{ label: "A", value: 10 },
				{ label: "B", value: 10 },
				{ label: "C", value: 10 },
			],
			{ minSpan: 0.5 },
		);

		expect(layout.centerValue).toBe(10);
		expect(layout.domain[1] - layout.domain[0]).toBeGreaterThan(0.5);
		expect(layout.tickCount).toBe(4);
	});

	it("limits outlier influence while keeping dynamic chart detail", () => {
		const baselinePoints = Array.from({ length: 20 }, (_, index) => ({
			label: `P-${index}`,
			value: 100 + index,
		}));
		const seriesWithOutlier = [
			...baselinePoints,
			{
				label: "OUTLIER",
				value: 1000,
			},
		];
		const layout = calculateDynamicAxisLayout(seriesWithOutlier, {
			paddingRatio: 0.18,
			minSpan: 1,
		});
		const outlierCenteredSpread = Math.max(
			Math.abs(1000 - layout.centerValue),
			Math.abs(100 - layout.centerValue),
		);

		expect(layout.centerValue).toBe(110);
		expect(layout.domain[1] - layout.domain[0]).toBeLessThan(
			outlierCenteredSpread * 2 * 1.18,
		);
		expect(layout.tickCount).toBeGreaterThanOrEqual(5);
	});
});

describe("prepareTimelineSeries", () => {
	it("sorts timeline points by timestamp_utc", () => {
		const sorted = prepareTimelineSeries([
			{ label: "03-02", value: 120, timestamp_utc: "2026-03-02T00:00:00Z" },
			{ label: "03-01", value: 100, timestamp_utc: "2026-03-01T00:00:00Z" },
		]);

		expect(sorted.map((point) => point.label)).toEqual(["03-01", "03-02"]);
	});

	it("trims leading inactive zero points when active data follows", () => {
		const normalized = prepareTimelineSeries([
			{ label: "02-28", value: 0, timestamp_utc: "2026-02-28T00:00:00Z" },
			{ label: "03-01", value: 215_000, timestamp_utc: "2026-03-01T00:00:00Z" },
			{ label: "03-02", value: 220_000, timestamp_utc: "2026-03-02T00:00:00Z" },
		]);

		expect(normalized.map((point) => point.label)).toEqual(["03-01", "03-02"]);
	});

	it("trims low-value leading discontinuity points before a large jump", () => {
		const normalized = prepareTimelineSeries([
			{ label: "02-28 18:00", value: 111, timestamp_utc: "2026-02-28T10:00:00Z" },
			{ label: "02-28 19:00", value: 111, timestamp_utc: "2026-02-28T11:00:00Z" },
			{ label: "03-01 03:00", value: 243_088, timestamp_utc: "2026-02-28T19:00:00Z" },
			{ label: "03-01 04:00", value: 241_577, timestamp_utc: "2026-02-28T20:00:00Z" },
		]);

		expect(normalized.map((point) => point.label)).toEqual([
			"03-01 03:00",
			"03-01 04:00",
		]);
	});
});

describe("summarizeTimeline", () => {
	it("computes change across the visible period", () => {
		const summary = summarizeTimeline([
			{ label: "03-01", value: 100 },
			{ label: "03-02", value: 120 },
			{ label: "03-03", value: 150 },
		]);

		expect(summary.startLabel).toBe("03-01");
		expect(summary.latestLabel).toBe("03-03");
		expect(summary.changeValue).toBe(50);
		expect(summary.changeRatio).toBe(0.5);
	});

	it("returns null ratio when period start value is zero", () => {
		const summary = summarizeTimeline([
			{ label: "2026-02", value: 0 },
			{ label: "2026-03", value: 239_687.62 },
		]);

		expect(summary.changeValue).toBe(239_687.62);
		expect(summary.changeRatio).toBeNull();
	});
});

describe("formatTimelineAxisLabel", () => {
	it("keeps full label on regular viewport mode", () => {
		expect(formatTimelineAxisLabel("03-01 04:00", false)).toBe("03-01 04:00");
	});

	it("keeps time part in compact mode for datetime labels", () => {
		expect(
			formatTimelineAxisLabel("03-01 04:00", {
				compact: true,
				range: "hour",
			}),
		).toBe("04:00");
	});

	it("keeps date part in compact mode for day labels", () => {
		expect(
			formatTimelineAxisLabel("03-01 04:00", {
				compact: true,
				range: "day",
			}),
		).toBe("03-01");
	});

	it("reduces yearly labels to the year in compact mode", () => {
		expect(
			formatTimelineAxisLabel("2026-03", {
				compact: true,
				range: "year",
			}),
		).toBe("2026");
	});

	it("truncates long custom labels in compact mode", () => {
		expect(formatTimelineAxisLabel("custom-label-long", true)).toBe("custom-…");
	});
});

describe("getAdaptiveYAxisWidth", () => {
	it("expands width for long negative labels and caps at max width", () => {
		expect(getAdaptiveYAxisWidth(["-12500k", "120k"], { minWidth: 52, maxWidth: 72 })).toBe(61);
		expect(getAdaptiveYAxisWidth(["-1234567890.12%"], { minWidth: 52, maxWidth: 72 })).toBe(72);
	});

	it("respects min width for short labels", () => {
		expect(getAdaptiveYAxisWidth(["0", "-1"], { minWidth: 56, maxWidth: 80 })).toBe(56);
	});
});

describe("formatCategoryAxisLabel", () => {
	it("shows more text on wider layouts while keeping compact mode tighter", () => {
		expect(formatCategoryAxisLabel("Global Brokerage Account", {})).toBe("Global Broker…");
		expect(formatCategoryAxisLabel("Global Brokerage Account", { compact: true })).toBe(
			"Global …",
		);
	});
});

describe("getAdaptiveCategoryAxisWidth", () => {
	it("grows category width within the configured bounds", () => {
		expect(
			getAdaptiveCategoryAxisWidth(["Global Brokerage Account", "现金管理"], {
				compact: false,
			}),
		).toBeGreaterThanOrEqual(104);
		expect(
			getAdaptiveCategoryAxisWidth(["Global Brokerage Account"], {
				compact: true,
			}),
		).toBeLessThanOrEqual(120);
	});
});

describe("getChartTickInterval", () => {
	it("keeps every tick when the chart is wide enough", () => {
		expect(getChartTickInterval(5, 560, { compact: false })).toBe(0);
	});

	it("skips ticks when there are too many labels for the container width", () => {
		expect(getChartTickInterval(24, 220, { compact: true })).toBeGreaterThan(0);
	});
});

describe("getAllocationDonutLayout", () => {
	it("shrinks donut radii on narrow containers and caps them on wide layouts", () => {
		const narrowLayout = getAllocationDonutLayout(180);
		const wideLayout = getAllocationDonutLayout(520);

		expect(narrowLayout.outerRadius).toBeLessThan(wideLayout.outerRadius);
		expect(wideLayout.outerRadius).toBe(102);
		expect(narrowLayout.height).toBeLessThanOrEqual(260);
	});
});
