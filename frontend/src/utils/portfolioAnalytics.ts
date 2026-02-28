import type {
	AllocationSlice,
	BreakdownChartItem,
	ChartLegendItem,
	PortfolioInsightSummary,
	TimelinePoint,
	TimelineRange,
	ValuedCashAccount,
	ValuedHolding,
} from "../types/portfolioAnalytics";

const CHART_COLORS = [
	"#ef476f",
	"#118ab2",
	"#ffd166",
	"#06d6a0",
	"#f78c6b",
	"#73d2de",
];

export const ANALYTICS_TOOLTIP_STYLE = {
	backgroundColor: "#161615",
	border: "1px solid rgba(255,255,255,0.08)",
	borderRadius: 16,
	boxShadow: "0 18px 36px rgba(0, 0, 0, 0.28)",
	padding: "0.85rem 1rem",
};

/**
 * Formats numbers with the same CNY presentation used by the current dashboard.
 */
export function formatCny(value: number): string {
	return new Intl.NumberFormat("zh-CN", {
		style: "currency",
		currency: "CNY",
		maximumFractionDigits: 2,
	}).format(value);
}

/**
 * Formats large CNY values into compact, axis-friendly labels.
 */
export function formatCompactCny(value: number): string {
	const absoluteValue = Math.abs(value);
	if (absoluteValue >= 1_000_000_000) {
		return `${(value / 1_000_000_000).toFixed(1)}B`;
	}
	if (absoluteValue >= 1_000_000) {
		return `${(value / 1_000_000).toFixed(1)}M`;
	}
	if (absoluteValue >= 1_000) {
		return `${(value / 1_000).toFixed(0)}k`;
	}
	return `${Math.round(value)}`;
}

/**
 * Formats a ratio as a percentage with at most one decimal place.
 */
export function formatPercentage(value: number): string {
	return new Intl.NumberFormat("zh-CN", {
		style: "percent",
		maximumFractionDigits: 1,
	}).format(Number.isFinite(value) ? value : 0);
}

export function getChartColors(): string[] {
	return CHART_COLORS;
}

export function getTimelineSeries(
	range: TimelineRange,
	hourSeries: TimelinePoint[],
	daySeries: TimelinePoint[],
	monthSeries: TimelinePoint[],
	yearSeries: TimelinePoint[],
): TimelinePoint[] {
	if (range === "hour") {
		return hourSeries;
	}
	if (range === "month") {
		return monthSeries;
	}
	if (range === "year") {
		return yearSeries;
	}
	return daySeries;
}

export function getBarChartHeight(itemCount: number): number {
	return Math.max(260, itemCount * 52);
}

export function truncateLabel(label: string, maxLength = 10): string {
	if (label.length <= maxLength) {
		return label;
	}
	return `${label.slice(0, maxLength - 1)}…`;
}

export function summarizeTimeline(series: TimelinePoint[]): {
	latestLabel: string | null;
	latestValue: number;
	changeValue: number;
	changeRatio: number;
} {
	const latestPoint = series[series.length - 1];
	const previousPoint = series[series.length - 2];
	const latestValue = latestPoint?.value ?? 0;
	const previousValue = previousPoint?.value ?? 0;
	const changeValue = latestValue - previousValue;

	return {
		latestLabel: latestPoint?.label ?? null,
		latestValue,
		changeValue,
		changeRatio: previousValue > 0 ? changeValue / previousValue : 0,
	};
}

export function buildAllocationLegend(
	allocation: AllocationSlice[],
	totalValueCny: number,
): ChartLegendItem[] {
	const denominator = totalValueCny > 0
		? totalValueCny
		: allocation.reduce((sum, slice) => sum + slice.value, 0);

	return allocation
		.filter((slice) => slice.value > 0)
		.map((slice, index) => ({
			label: slice.label,
			value_cny: slice.value,
			percentage: denominator > 0 ? slice.value / denominator : 0,
			color: CHART_COLORS[index % CHART_COLORS.length],
		}));
}

export function buildHoldingsBreakdown(
	holdings: ValuedHolding[],
	limit = 5,
): BreakdownChartItem[] {
	const sortedHoldings = [...holdings]
		.filter((holding) => holding.value_cny > 0)
		.sort((left, right) => right.value_cny - left.value_cny);
	const totalHoldingsValue = sortedHoldings.reduce(
		(sum, holding) => sum + holding.value_cny,
		0,
	);

	if (totalHoldingsValue === 0) {
		return [];
	}

	const leadingItems = sortedHoldings.slice(0, limit).map((holding, index) => ({
		label: holding.name || holding.symbol,
		value_cny: holding.value_cny,
		percentage: holding.value_cny / totalHoldingsValue,
		color: CHART_COLORS[index % CHART_COLORS.length],
	}));
	const remainingValue = sortedHoldings
		.slice(limit)
		.reduce((sum, holding) => sum + holding.value_cny, 0);

	if (remainingValue <= 0) {
		return leadingItems;
	}

	return [
		...leadingItems,
		{
			label: "其余持仓",
			value_cny: remainingValue,
			percentage: remainingValue / totalHoldingsValue,
			color: CHART_COLORS[leadingItems.length % CHART_COLORS.length],
		},
	];
}

export function buildPlatformBreakdown(
	cashAccounts: ValuedCashAccount[],
	holdings: ValuedHolding[],
): BreakdownChartItem[] {
	const platformTotals = new Map<string, number>();

	for (const account of cashAccounts) {
		const key = account.platform.trim() || "未命名平台";
		platformTotals.set(key, (platformTotals.get(key) ?? 0) + account.value_cny);
	}

	const holdingsValue = holdings.reduce((sum, holding) => sum + holding.value_cny, 0);
	if (holdingsValue > 0) {
		platformTotals.set(
			"证券持仓",
			(platformTotals.get("证券持仓") ?? 0) + holdingsValue,
		);
	}

	const sortedEntries = [...platformTotals.entries()]
		.filter(([, value]) => value > 0)
		.sort((left, right) => right[1] - left[1]);
	const totalValue = sortedEntries.reduce((sum, [, value]) => sum + value, 0);

	return sortedEntries.map(([label, value], index) => ({
		label,
		value_cny: value,
		percentage: totalValue > 0 ? value / totalValue : 0,
		color: CHART_COLORS[index % CHART_COLORS.length],
	}));
}

export function summarizePortfolioInsights(
	totalValueCny: number,
	cashAccounts: ValuedCashAccount[],
	holdings: ValuedHolding[],
): PortfolioInsightSummary {
	const sortedHoldings = [...holdings]
		.filter((holding) => holding.value_cny > 0)
		.sort((left, right) => right.value_cny - left.value_cny);
	const topHolding = sortedHoldings[0] ?? null;
	const topThreeValue = sortedHoldings
		.slice(0, 3)
		.reduce((sum, holding) => sum + holding.value_cny, 0);
	const totalCashValue = cashAccounts.reduce((sum, account) => sum + account.value_cny, 0);
	const safeDenominator = totalValueCny > 0 ? totalValueCny : totalCashValue + topThreeValue;
	const uniquePlatforms = new Set(
		cashAccounts
			.map((account) => account.platform.trim())
			.filter((platform) => platform.length > 0),
	);

	return {
		cashRatio: safeDenominator > 0 ? totalCashValue / safeDenominator : 0,
		topHolding,
		topHoldingRatio: topHolding && safeDenominator > 0
			? topHolding.value_cny / safeDenominator
			: 0,
		topThreeRatio: safeDenominator > 0 ? topThreeValue / safeDenominator : 0,
		holdingsCount: sortedHoldings.length,
		cashAccountCount: cashAccounts.length,
		platformCount: uniquePlatforms.size,
	};
}
