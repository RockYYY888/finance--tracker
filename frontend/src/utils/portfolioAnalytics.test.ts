import { describe, expect, it } from "vitest";

import { calculateDynamicAxisLayout } from "./portfolioAnalytics";

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
