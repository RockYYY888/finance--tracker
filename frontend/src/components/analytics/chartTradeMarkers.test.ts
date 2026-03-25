import { describe, expect, it } from "vitest";

import {
	buildChartTradeMarkers,
	TRADE_MARKER_NEGATIVE_COLOR,
	TRADE_MARKER_POSITIVE_COLOR,
} from "./chartTradeMarkers";

describe("buildChartTradeMarkers", () => {
	const daySeries = [
		{
			label: "03-02",
			value: 1.2,
			timestamp_utc: "2026-03-01T16:00:00.000Z",
		},
		{
			label: "03-03",
			value: 1.8,
			timestamp_utc: "2026-03-02T16:00:00.000Z",
		},
	];
	const chartPoints = daySeries.map((point) => ({
		xValue: Date.parse(point.timestamp_utc),
		value: point.value,
	}));

	it("groups buy and sell transactions into one marker per bucket and uses the dominant side tone", () => {
		const markers = buildChartTradeMarkers({
			range: "day",
			series: daySeries,
			chartPoints,
			transactions: [
				{
					id: 1,
					symbol: "BABA.US",
					name: "阿里巴巴",
					side: "BUY",
					quantity: 100,
					fallback_currency: "USD",
					market: "US",
					traded_on: "2026-03-02",
					created_at: "2026-03-02T01:30:00.000Z",
				},
				{
					id: 2,
					symbol: "BABA.US",
					name: "阿里巴巴",
					side: "SELL",
					quantity: 25,
					fallback_currency: "USD",
					market: "US",
					traded_on: "2026-03-02",
					created_at: "2026-03-02T02:00:00.000Z",
				},
				{
					id: 3,
					symbol: "BABA.US",
					name: "阿里巴巴",
					side: "BUY",
					quantity: 40,
					fallback_currency: "USD",
					market: "US",
					traded_on: "2026-03-02",
					created_at: "2026-03-02T03:00:00.000Z",
				},
				{
					id: 4,
					symbol: "TCEHY.US",
					name: "腾讯控股",
					side: "SELL",
					quantity: 10,
					fallback_currency: "USD",
					market: "US",
					traded_on: "2026-03-03",
					created_at: "2026-03-03T01:00:00.000Z",
				},
				{
					id: 5,
					symbol: "TCEHY.US",
					name: "腾讯控股",
					side: "ADJUST",
					quantity: 1,
					fallback_currency: "USD",
					market: "US",
					traded_on: "2026-03-03",
					created_at: "2026-03-03T02:00:00.000Z",
				},
			],
		});

		expect(markers).toHaveLength(2);
		expect(markers[0]).toMatchObject({
			xValue: Date.parse("2026-03-01T16:00:00.000Z"),
			yValue: 1.2,
			label: "B/S",
			dominantSide: "BUY",
			stroke: TRADE_MARKER_POSITIVE_COLOR,
		});
		expect(markers[0]?.events.map((event) => event.description)).toEqual([
			"B · 阿里巴巴 (BABA.US) · 100 股/份",
			"S · 阿里巴巴 (BABA.US) · 25 股/份",
			"B · 阿里巴巴 (BABA.US) · 40 股/份",
		]);
		expect(markers[1]).toMatchObject({
			xValue: Date.parse("2026-03-02T16:00:00.000Z"),
			yValue: 1.8,
			label: "S",
			dominantSide: "SELL",
			stroke: TRADE_MARKER_NEGATIVE_COLOR,
		});
	});

	it("filters markers to the selected holding symbol for single-holding charts", () => {
		const markers = buildChartTradeMarkers({
			range: "day",
			series: daySeries,
			chartPoints,
			symbol: "BABA.US",
			transactions: [
				{
					id: 1,
					symbol: "BABA.US",
					name: "阿里巴巴",
					side: "BUY",
					quantity: 100,
					fallback_currency: "USD",
					market: "US",
					traded_on: "2026-03-02",
					created_at: "2026-03-02T01:30:00.000Z",
				},
				{
					id: 2,
					symbol: "TCEHY.US",
					name: "腾讯控股",
					side: "SELL",
					quantity: 25,
					fallback_currency: "USD",
					market: "US",
					traded_on: "2026-03-02",
					created_at: "2026-03-02T02:00:00.000Z",
				},
			],
		});

		expect(markers).toHaveLength(1);
		expect(markers[0]?.label).toBe("B");
		expect(markers[0]?.events).toHaveLength(1);
		expect(markers[0]?.events[0]?.description).toContain("阿里巴巴");
		expect(markers[0]?.events[0]?.description).not.toContain("腾讯控股");
	});
});
