import { describe, expect, it } from "vitest";

import { buildPortfolioTrendChartData } from "./PortfolioTrendChart";

describe("buildPortfolioTrendChartData", () => {
	it("keeps timeline points visible for both positive and negative values", () => {
		const source = [
			{ label: "03-01 10:00", value: 12_300 },
			{ label: "03-01 11:00", value: 0 },
			{ label: "03-01 12:00", value: -2_500 },
		];

		expect(buildPortfolioTrendChartData(source)).toEqual([
			{
				label: "03-01 10:00",
				value: 12_300,
				positiveValue: 12_300,
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
				value: -2_500,
				positiveValue: 0,
				negativeValue: -2_500,
			},
		]);
	});

	it("supports splitting around a custom center value", () => {
		const source = [
			{ label: "03-01 10:00", value: 12_300 },
			{ label: "03-01 11:00", value: 11_500 },
			{ label: "03-01 12:00", value: 10_100 },
		];

		expect(buildPortfolioTrendChartData(source, 11_500)).toEqual([
			{
				label: "03-01 10:00",
				value: 12_300,
				positiveValue: 12_300,
				negativeValue: 11_500,
			},
			{
				label: "03-01 11:00",
				value: 11_500,
				positiveValue: 11_500,
				negativeValue: 11_500,
			},
			{
				label: "03-01 12:00",
				value: 10_100,
				positiveValue: 11_500,
				negativeValue: 10_100,
			},
		]);
	});
});
