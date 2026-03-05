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
		expect(layout.domain[0]).toBeCloseTo(95.5, 5);
		expect(layout.domain[1]).toBeCloseTo(154.5, 5);
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
	});
});
