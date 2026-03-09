import type {
	AllocationSlice,
	BreakdownChartItem,
	ChartLegendItem,
	PortfolioInsightSummary,
	TimelinePoint,
	TimelineRange,
	ValuedCashAccount,
	ValuedFixedAsset,
	ValuedHolding,
	ValuedLiability,
	ValuedOtherAsset,
} from "../types/portfolioAnalytics";
import {
	getFixedAssetCategoryLabel,
	getLiabilityCategoryLabel,
	getOtherAssetCategoryLabel,
} from "../types/assets";

const CHART_COLORS = [
	"#63e8ff",
	"#7a8cff",
	"#37f0c8",
	"#ffd166",
	"#ff8ab3",
	"#7ecbff",
];

export const ANALYTICS_TOOLTIP_STYLE = {
	backgroundColor: "rgba(8, 18, 34, 0.96)",
	border: "1px solid rgba(122,214,255,0.16)",
	borderRadius: 16,
	boxShadow: "0 18px 36px rgba(0, 0, 0, 0.32)",
	color: "#ecf7ff",
	padding: "0.85rem 1rem",
};

export const ANALYTICS_TOOLTIP_LABEL_STYLE = {
	color: "#ecf7ff",
	fontWeight: 600,
};

export const ANALYTICS_TOOLTIP_ITEM_STYLE = {
	color: "#d5eeff",
	fontSize: "0.92rem",
};

export const ANALYTICS_TOOLTIP_CURSOR_STYLE = {
	fill: "rgba(99, 232, 255, 0.10)",
	stroke: "rgba(99, 232, 255, 0.18)",
	strokeWidth: 1,
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
 * Formats a ratio as a percentage with two decimal places.
 */
export function formatPercentage(value: number): string {
	return new Intl.NumberFormat("zh-CN", {
		style: "percent",
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(Number.isFinite(value) ? value : 0);
}

export function formatPercentMetric(value: number, withSign = false): string {
	if (!Number.isFinite(value)) {
		return "0.00%";
	}

	const prefix = withSign && value > 0 ? "+" : "";
	return `${prefix}${value.toFixed(2)}%`;
}

export function formatCompactPercentMetric(value: number): string {
	if (!Number.isFinite(value)) {
		return "0.00%";
	}

	return `${value.toFixed(2)}%`;
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

function toSortableTimestamp(point: TimelinePoint, fallbackIndex: number): number {
	if (!point.timestamp_utc) {
		return fallbackIndex;
	}

	const parsedTimestamp = Date.parse(point.timestamp_utc);
	if (!Number.isFinite(parsedTimestamp)) {
		return fallbackIndex;
	}

	return parsedTimestamp;
}

function trimLeadingInactivePoints(series: TimelinePoint[]): TimelinePoint[] {
	if (series.length <= 2) {
		return series;
	}

	const firstActiveIndex = series.findIndex((point) => Math.abs(point.value) > 1e-6);
	if (firstActiveIndex <= 0) {
		return series;
	}

	const leadingPoints = series.slice(0, firstActiveIndex);
	const areLeadingPointsInactive = leadingPoints.every((point) => Math.abs(point.value) <= 1e-6);
	if (!areLeadingPointsInactive) {
		return series;
	}

	return series.slice(firstActiveIndex);
}

function trimLeadingDiscontinuityPoints(series: TimelinePoint[]): TimelinePoint[] {
	if (series.length <= 2) {
		return series;
	}

	for (let index = 1; index < series.length; index += 1) {
		const previousMagnitude = Math.max(Math.abs(series[index - 1].value), 1e-6);
		const currentMagnitude = Math.abs(series[index].value);
		if (currentMagnitude < 10_000) {
			continue;
		}

		const jumpRatio = currentMagnitude / previousMagnitude;
		if (jumpRatio < 20) {
			continue;
		}

		const leadingPoints = series.slice(0, index);
		if (leadingPoints.length === 0 || series.length - index < 2) {
			continue;
		}

		const lowValueThreshold = Math.max(currentMagnitude * 0.05, 1_000);
		const areLeadingPointsLowValue = leadingPoints.every(
			(point) => Math.abs(point.value) < lowValueThreshold,
		);
		if (areLeadingPointsLowValue) {
			return series.slice(index);
		}
	}

	return series;
}

export function prepareTimelineSeries(series: TimelinePoint[]): TimelinePoint[] {
	const normalizedPoints = series
		.filter((point) => Number.isFinite(point.value))
		.map((point) => ({ ...point }));
	const indexedPoints = normalizedPoints.map((point, index) => ({ point, index }));
	indexedPoints.sort(
		(left, right) =>
			toSortableTimestamp(left.point, left.index) - toSortableTimestamp(right.point, right.index),
	);

	const chronologicallySorted = indexedPoints.map((entry) => entry.point);
	return trimLeadingDiscontinuityPoints(trimLeadingInactivePoints(chronologicallySorted));
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

export function formatTimelinePointLabel(
	point: Pick<TimelinePoint, "label"> | null | undefined,
	fallbackLabel = "该点",
): string {
	const normalizedLabel = point?.label?.trim() ?? "";
	return normalizedLabel || fallbackLabel;
}

export function formatTimelineRangeLabel(
	startPoint: Pick<TimelinePoint, "label"> | null | undefined,
	endPoint: Pick<TimelinePoint, "label"> | null | undefined,
	endFallbackLabel = "该点",
): string {
	return `${formatTimelinePointLabel(startPoint, "起点")}→${formatTimelinePointLabel(
		endPoint,
		endFallbackLabel,
	)}`;
}

type TimelineAxisLabelOptions = {
	compact?: boolean;
	range?: TimelineRange;
};

/**
 * Formats timeline labels for narrow viewports to prevent axis overflow.
 */
export function formatTimelineAxisLabel(
	label: string,
	options: TimelineAxisLabelOptions | boolean = false,
): string {
	const compact = typeof options === "boolean" ? options : (options.compact ?? false);
	const range = typeof options === "boolean" ? undefined : options.range;
	const normalizedLabel = label.trim();
	if (!compact) {
		return normalizedLabel;
	}

	if (!range && normalizedLabel.length <= 8) {
		return normalizedLabel;
	}

	if (range === "hour") {
		const timeMatch = normalizedLabel.match(/(\d{1,2}:\d{2})$/);
		if (timeMatch) {
			return timeMatch[1];
		}
	}

	if (range === "day") {
		const dayMatch = normalizedLabel.match(/(\d{2}-\d{2})(?:\s+\d{1,2}:\d{2})?$/);
		if (dayMatch) {
			return dayMatch[1];
		}
	}

	if (range === "month") {
		const monthMatch = normalizedLabel.match(/(\d{4}-\d{2})$/);
		if (monthMatch) {
			return monthMatch[1];
		}
	}

	if (range === "year") {
		const yearMatch = normalizedLabel.match(/(\d{4})/);
		if (yearMatch) {
			return yearMatch[1];
		}
	}

	const parts = normalizedLabel.split(/\s+/);
	const lastPart = parts[parts.length - 1] ?? normalizedLabel;
	if (/^\d{1,2}:\d{2}$/.test(lastPart)) {
		return lastPart;
	}

	if (/^\d{2}-\d{2}$/.test(normalizedLabel) || /^\d{4}-\d{2}$/.test(normalizedLabel)) {
		return normalizedLabel;
	}

	return truncateLabel(normalizedLabel, 8);
}

type AdaptiveYAxisWidthOptions = {
	minWidth?: number;
	maxWidth?: number;
	padding?: number;
	perCharWidth?: number;
};

/**
 * Estimates axis width from formatted tick labels so long negatives are not clipped.
 */
export function getAdaptiveYAxisWidth(
	labels: string[],
	{
		minWidth = 52,
		maxWidth = 72,
		padding = 12,
		perCharWidth = 7,
	}: AdaptiveYAxisWidthOptions = {},
): number {
	const longestLabelLength = labels.reduce(
		(maxLength, label) => Math.max(maxLength, label.length),
		0,
	);
	const estimatedWidth = longestLabelLength * perCharWidth + padding;
	return clamp(estimatedWidth, minWidth, maxWidth);
}

type CategoryAxisLabelOptions = {
	compact?: boolean;
	compactMaxLength?: number;
	regularMaxLength?: number;
};

export function formatCategoryAxisLabel(
	label: string,
	{
		compact = false,
		compactMaxLength = 8,
		regularMaxLength = 14,
	}: CategoryAxisLabelOptions = {},
): string {
	const normalizedLabel = label.trim();
	if (!normalizedLabel) {
		return "";
	}

	return truncateLabel(normalizedLabel, compact ? compactMaxLength : regularMaxLength);
}

type AdaptiveCategoryAxisWidthOptions = AdaptiveYAxisWidthOptions & {
	compact?: boolean;
	compactMaxLength?: number;
	regularMaxLength?: number;
};

export function getAdaptiveCategoryAxisWidth(
	labels: string[],
	{
		compact = false,
		compactMaxLength = 8,
		regularMaxLength = 14,
		minWidth,
		maxWidth,
		padding = compact ? 20 : 24,
		perCharWidth = compact ? 9 : 8,
	}: AdaptiveCategoryAxisWidthOptions = {},
): number {
	const formattedLabels = labels.map((label) =>
		formatCategoryAxisLabel(label, {
			compact,
			compactMaxLength,
			regularMaxLength,
		}),
	);

	return getAdaptiveYAxisWidth(formattedLabels, {
		minWidth: minWidth ?? (compact ? 88 : 104),
		maxWidth: maxWidth ?? (compact ? 120 : 168),
		padding,
		perCharWidth,
	});
}

type ChartTickIntervalOptions = {
	compact?: boolean;
	minLabelSpacing?: number;
	minTickCount?: number;
	maxTickCount?: number;
};

export function getChartTickInterval(
	itemCount: number,
	chartWidth: number,
	{
		compact = false,
		minLabelSpacing = compact ? 72 : 96,
		minTickCount = compact ? 3 : 4,
		maxTickCount = compact ? 5 : 8,
	}: ChartTickIntervalOptions = {},
): number {
	if (itemCount <= 1) {
		return 0;
	}

	const estimatedTickCount = chartWidth > 0
		? Math.floor(chartWidth / Math.max(minLabelSpacing, 1))
		: maxTickCount;
	const visibleTickCount = clamp(estimatedTickCount, minTickCount, maxTickCount);
	if (itemCount <= visibleTickCount) {
		return 0;
	}

	return Math.ceil(itemCount / visibleTickCount) - 1;
}

export function getAllocationDonutLayout(
	chartWidth: number,
): {
	height: number;
	innerRadius: number;
	outerRadius: number;
} {
	const safeWidth = chartWidth > 0 ? chartWidth : 260;
	const outerRadius = clamp(Math.floor((safeWidth - 24) / 2), 72, 102);
	const innerRadius = clamp(outerRadius - 30, 42, 72);

	return {
		height: clamp(outerRadius * 2 + 40, 220, 260),
		innerRadius,
		outerRadius,
	};
}

export function summarizeTimeline(series: TimelinePoint[]): {
	startLabel: string | null;
	latestLabel: string | null;
	latestValue: number;
	changeValue: number;
	changeRatio: number | null;
} {
	const latestPoint = series[series.length - 1];
	const startPoint = series[0];
	const latestValue = latestPoint?.value ?? 0;
	const startValue = startPoint?.value ?? latestValue;
	const changeValue = latestValue - startValue;
	const changeRatio = Math.abs(startValue) > 1e-6 ? changeValue / startValue : null;

	return {
		startLabel: startPoint?.label ?? null,
		latestLabel: latestPoint?.label ?? null,
		latestValue,
		changeValue,
		changeRatio,
	};
}

/**
 * Calculates the geometric mean of step-over-step return changes for the active timeline grain.
 * Timeline values are stored as return percentages, so they are converted into growth factors first.
 */
export function summarizeCompoundedStepRate(series: TimelinePoint[]): number {
	const validPoints = series.filter(
		(point) => Number.isFinite(point.value) && (1 + point.value / 100) > 0,
	);

	if (validPoints.length < 2) {
		return 0;
	}

	let cumulativeRatio = 1;
	let intervalCount = 0;

	for (let index = 1; index < validPoints.length; index += 1) {
		const previousFactor = 1 + validPoints[index - 1].value / 100;
		const currentFactor = 1 + validPoints[index].value / 100;

		if (previousFactor <= 0 || currentFactor <= 0) {
			continue;
		}

		cumulativeRatio *= currentFactor / previousFactor;
		intervalCount += 1;
	}

	if (intervalCount === 0) {
		return 0;
	}

	return (Math.pow(cumulativeRatio, 1 / intervalCount) - 1) * 100;
}

export type DynamicAxisLayout = {
	centerValue: number;
	domain: [number, number];
	minValue: number;
	maxValue: number;
	tickCount: number;
};

type DynamicAxisOptions = {
	includeZero?: boolean;
	paddingRatio?: number;
	minSpan?: number;
};

function getMedian(values: number[]): number {
	if (values.length === 0) {
		return 0;
	}

	const sortedValues = [...values].sort((left, right) => left - right);
	const middleIndex = Math.floor(sortedValues.length / 2);
	if (sortedValues.length % 2 === 1) {
		return sortedValues[middleIndex];
	}

	return (sortedValues[middleIndex - 1] + sortedValues[middleIndex]) / 2;
}

function clamp(value: number, minValue: number, maxValue: number): number {
	return Math.min(Math.max(value, minValue), maxValue);
}

function getQuantile(sortedValues: number[], quantile: number): number {
	if (sortedValues.length === 0) {
		return 0;
	}

	const safeQuantile = clamp(quantile, 0, 1);
	const position = (sortedValues.length - 1) * safeQuantile;
	const lowerIndex = Math.floor(position);
	const upperIndex = Math.ceil(position);
	if (lowerIndex === upperIndex) {
		return sortedValues[lowerIndex];
	}

	const ratio = position - lowerIndex;
	return sortedValues[lowerIndex] * (1 - ratio) + sortedValues[upperIndex] * ratio;
}

function summarizeRelativeStepVolatility(values: number[], scale: number): number {
	if (values.length < 2) {
		return 0;
	}

	let totalChange = 0;
	for (let index = 1; index < values.length; index += 1) {
		totalChange += Math.abs(values[index] - values[index - 1]) / scale;
	}
	return totalChange / (values.length - 1);
}

function resolveDynamicTickCount(relativeVolatility: number): number {
	if (relativeVolatility >= 0.25) {
		return 7;
	}
	if (relativeVolatility >= 0.14) {
		return 6;
	}
	if (relativeVolatility >= 0.05) {
		return 5;
	}
	return 4;
}

/**
 * Builds a visually stable y-axis from the visible timeline window using a median centerline.
 */
export function calculateDynamicAxisLayout(
	series: TimelinePoint[],
	{
		includeZero = false,
		paddingRatio = 0.18,
		minSpan = 1,
	}: DynamicAxisOptions = {},
): DynamicAxisLayout {
	const numericValues = series
		.map((point) => point.value)
		.filter((value) => Number.isFinite(value));

	if (numericValues.length === 0) {
		return {
			centerValue: 0,
			domain: [-1, 1],
			minValue: 0,
			maxValue: 0,
			tickCount: 4,
		};
	}

	const minValue = Math.min(...numericValues);
	const maxValue = Math.max(...numericValues);
	const sortedValues = [...numericValues].sort((left, right) => left - right);
	const centerValue = getMedian(numericValues);

	const safeMinSpan = Math.max(minSpan, 1e-6);
	const fullSpread = Math.max(
		Math.abs(maxValue - centerValue),
		Math.abs(minValue - centerValue),
	);
	const lowerQuantile = getQuantile(sortedValues, 0.1);
	const upperQuantile = getQuantile(sortedValues, 0.9);
	const robustSpread = Math.max(
		Math.abs(lowerQuantile - centerValue),
		Math.abs(upperQuantile - centerValue),
	);
	const outlierRatio = fullSpread / Math.max(robustSpread, safeMinSpan);
	const spreadBlendRatio = outlierRatio <= 1.8 ? 1 : 0.45;
	const effectiveSpread = Math.max(
		robustSpread + (fullSpread - robustSpread) * spreadBlendRatio,
		safeMinSpan,
	);

	const volatilityScale = Math.max(Math.abs(centerValue), fullSpread, 1);
	const relativeVolatility = summarizeRelativeStepVolatility(numericValues, volatilityScale);
	const adaptivePaddingRatio = clamp(
		Math.max(paddingRatio, 0) - relativeVolatility * 0.08,
		0.08,
		0.28,
	);
	const halfRange = effectiveSpread * (1 + adaptivePaddingRatio);
	const tickCount = resolveDynamicTickCount(relativeVolatility);

	let domainMin = centerValue - halfRange;
	let domainMax = centerValue + halfRange;

	if (includeZero) {
		domainMin = Math.min(domainMin, 0);
		domainMax = Math.max(domainMax, 0);
	}

	if (domainMin === domainMax) {
		domainMin -= safeMinSpan;
		domainMax += safeMinSpan;
	}

	return {
		centerValue,
		domain: [domainMin, domainMax],
		minValue,
		maxValue,
		tickCount,
	};
}

export function buildAllocationLegend(
	allocation: AllocationSlice[],
	totalValueCny: number,
): ChartLegendItem[] {
	const positiveAssetTotal = allocation.reduce((sum, slice) => sum + Math.max(slice.value, 0), 0);
	const denominator = positiveAssetTotal > 0 ? positiveAssetTotal : Math.max(totalValueCny, 0);

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
	fixedAssets: ValuedFixedAsset[],
	liabilities: ValuedLiability[],
	otherAssets: ValuedOtherAsset[],
): BreakdownChartItem[] {
	const platformTotals = new Map<string, number>();

	for (const account of cashAccounts) {
		const key = account.platform.trim() || "未命名平台";
		platformTotals.set(key, (platformTotals.get(key) ?? 0) + account.value_cny);
	}

	for (const holding of holdings) {
		if (holding.value_cny <= 0) {
			continue;
		}

		const key = holding.broker?.trim() || "投资类（未标记来源）";
		platformTotals.set(
			key,
			(platformTotals.get(key) ?? 0) + holding.value_cny,
		);
	}

	for (const asset of fixedAssets) {
		if (asset.value_cny <= 0) {
			continue;
		}

		const key = `固定资产 · ${getFixedAssetCategoryLabel(asset.category)}`;
		platformTotals.set(key, (platformTotals.get(key) ?? 0) + asset.value_cny);
	}

	for (const entry of liabilities) {
		if (entry.value_cny <= 0) {
			continue;
		}

		const key = `负债 · ${getLiabilityCategoryLabel(entry.category)}`;
		platformTotals.set(key, (platformTotals.get(key) ?? 0) + entry.value_cny);
	}

	for (const asset of otherAssets) {
		if (asset.value_cny <= 0) {
			continue;
		}

		const key = `其他 · ${getOtherAssetCategoryLabel(asset.category)}`;
		platformTotals.set(key, (platformTotals.get(key) ?? 0) + asset.value_cny);
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
