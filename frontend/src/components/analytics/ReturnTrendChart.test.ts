import { describe, expect, it } from "vitest";

import { buildReturnTrendChartData } from "./ReturnTrendChart";

describe("buildReturnTrendChartData", () => {
	it("splits positive and negative regions while keeping original values", () => {
		const source = [
			{ label: "03-01 10:00", value: 1.8 },
			{ label: "03-01 11:00", value: 0 },
			{ label: "03-01 12:00", value: -2.4 },
		];

		expect(buildReturnTrendChartData(source)).toEqual([
			{
				label: "03-01 10:00",
				value: 1.8,
				positiveValue: 1.8,
				negativeValue: 0,
			},
			{
				label: "03-01 11:00",
				value: 0,
				positiveValue: 0,
				negativeValue: 0,
			},
			{
				label: "03-01 12:00",
				value: -2.4,
				positiveValue: 0,
				negativeValue: -2.4,
			},
		]);
	});
});
