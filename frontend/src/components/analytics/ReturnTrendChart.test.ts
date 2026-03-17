import { describe, expect, it } from "vitest";

import {
	buildReturnTrendAreaData,
	buildReturnTrendChartData,
} from "./ReturnTrendChart";

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

	it("keeps only real timeline points when return series crosses zero", () => {
		const source = [
			{ label: "03-01", value: 2 },
			{ label: "03-05", value: -2 },
		];

		expect(buildReturnTrendChartData(source)).toEqual([
			{
				label: "03-01",
				value: 2,
				positiveValue: 2,
				negativeValue: 0,
			},
			{
				label: "03-05",
				value: -2,
				positiveValue: 0,
				negativeValue: -2,
			},
		]);
	});

	it("adds zero crossings only for the shaded area data", () => {
		const source = [
			{ label: "03-01", value: 2 },
			{ label: "03-05", value: -2 },
		];

		expect(buildReturnTrendAreaData(source)).toEqual([
			{
				label: "03-01",
				value: 2,
				positiveValue: 2,
				negativeValue: 0,
			},
			{
				label: "",
				value: 0,
				corrected: false,
				crossingPoint: true,
				positiveValue: 0,
				negativeValue: 0,
			},
			{
				label: "03-05",
				value: -2,
				positiveValue: 0,
				negativeValue: -2,
			},
		]);
	});
});
