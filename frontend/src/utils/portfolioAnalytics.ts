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

function resolveTimelineTickCount(
	chartWidth: number,
	{
		compact = false,
		minTickCount = compact ? 3 : 4,
		maxTickCount = compact ? 5 : 8,
	}: ChartTickIntervalOptions = {},
): number {
	if (chartWidth <= 0) {
		return clamp(compact ? 4 : 6, minTickCount, maxTickCount);
	}

	let resolvedTickCount = compact ? 4 : 6;
	if (chartWidth <= 280) {
		resolvedTickCount = 3;
	} else if (chartWidth <= 420) {
		resolvedTickCount = 4;
	} else if (chartWidth <= 640) {
		resolvedTickCount = compact ? 4 : 5;
	} else if (chartWidth <= 860) {
		resolvedTickCount = compact ? 5 : 6;
	} else {
		resolvedTickCount = compact ? 5 : 7;
	}

	return clamp(resolvedTickCount, minTickCount, maxTickCount);
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
	startValue: number;
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
		startValue,
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
	referenceValue: number;
	domain: [number, number];
	minValue: number;
	maxValue: number;
	tickValues: number[];
};

type DynamicAxisOptions = {
	referenceValue?: number;
	includeReference?: boolean;
	paddingRatio?: number;
	minSpan?: number;
	targetTickCount?: number;
};

function clamp(value: number, minValue: number, maxValue: number): number {
	return Math.min(Math.max(value, minValue), maxValue);
}

function resolveNiceStep(rawStep: number): number {
	if (!Number.isFinite(rawStep) || rawStep <= 0) {
		return 1;
	}

	const magnitude = 10 ** Math.floor(Math.log10(rawStep));
	const normalizedStep = rawStep / magnitude;
	if (normalizedStep <= 1) {
		return magnitude;
	}
	if (normalizedStep <= 2) {
		return 2 * magnitude;
	}
	if (normalizedStep <= 2.5) {
		return 2.5 * magnitude;
	}
	if (normalizedStep <= 5) {
		return 5 * magnitude;
	}
	return 10 * magnitude;
}

function buildAxisTicks(
	domainMin: number,
	domainMax: number,
	step: number,
): number[] {
	const tickValues: number[] = [];
	const safeStep = Math.max(step, 1e-9);
	const maxTickCount = 12;
	let currentValue = domainMin;
	let guard = 0;

	while (currentValue <= domainMax + safeStep / 2 && guard < maxTickCount) {
		tickValues.push(Number(currentValue.toFixed(6)));
		currentValue += safeStep;
		guard += 1;
	}

	if (tickValues.length === 0 || tickValues[tickValues.length - 1] !== domainMax) {
		tickValues.push(Number(domainMax.toFixed(6)));
	}

	return tickValues;
}

function pickEvenlyDistributedIndices(itemCount: number, targetTickCount: number): number[] {
	if (itemCount <= 0) {
		return [];
	}

	if (itemCount <= targetTickCount) {
		return Array.from({ length: itemCount }, (_, index) => index);
	}

	const lastIndex = itemCount - 1;
	const selectedIndices = new Set<number>();
	for (let tickIndex = 0; tickIndex < targetTickCount; tickIndex += 1) {
		selectedIndices.add(
			Math.round((lastIndex * tickIndex) / Math.max(targetTickCount - 1, 1)),
		);
	}

	while (selectedIndices.size < targetTickCount) {
		let bestIndex = 0;
		let bestDistance = -1;
		for (let candidateIndex = 0; candidateIndex < itemCount; candidateIndex += 1) {
			if (selectedIndices.has(candidateIndex)) {
				continue;
			}

			let nearestDistance = Number.POSITIVE_INFINITY;
			for (const selectedIndex of selectedIndices) {
				nearestDistance = Math.min(
					nearestDistance,
					Math.abs(candidateIndex - selectedIndex),
				);
			}

			if (nearestDistance > bestDistance) {
				bestDistance = nearestDistance;
				bestIndex = candidateIndex;
			}
		}

		selectedIndices.add(bestIndex);
	}

	return [...selectedIndices].sort((left, right) => left - right);
}

export function getTimelineChartTicks(
	series: Pick<TimelinePoint, "label">[],
	chartWidth: number,
	options: ChartTickIntervalOptions = {},
): string[] {
	const labels = series
		.map((point) => point.label.trim())
		.filter((label) => label.length > 0);
	if (labels.length <= 1) {
		return labels;
	}

	const targetTickCount = resolveTimelineTickCount(chartWidth, options);
	return pickEvenlyDistributedIndices(labels.length, targetTickCount).map(
		(index) => labels[index]!,
	);
}

/**
 * Builds a key-point-driven y-axis from period start/end, visible min/max, and the reference line.
 */
export function calculateDynamicAxisLayout(
	series: TimelinePoint[],
	{
		referenceValue,
		includeReference = true,
		paddingRatio = 0.12,
		minSpan = 1,
		targetTickCount = 5,
	}: DynamicAxisOptions = {},
): DynamicAxisLayout {
	const numericValues = series
		.map((point) => point.value)
		.filter((value) => Number.isFinite(value));

	if (numericValues.length === 0) {
		const fallbackReferenceValue = referenceValue ?? 0;
		return {
			referenceValue: fallbackReferenceValue,
			domain: [-1, 1],
			minValue: 0,
			maxValue: 0,
			tickValues: [-1, 0, 1],
		};
	}

	const startValue = series[0]?.value ?? numericValues[0]!;
	const endValue = series[series.length - 1]?.value ?? numericValues[numericValues.length - 1]!;
	const minValue = Math.min(...numericValues);
	const maxValue = Math.max(...numericValues);
	const safeMinSpan = Math.max(minSpan, 1e-6);
	const explicitReferenceValue =
		typeof referenceValue === "number" && Number.isFinite(referenceValue)
			? referenceValue
			: undefined;
	const resolvedReferenceValue = explicitReferenceValue ?? startValue;
	const anchorValues = [startValue, endValue, minValue, maxValue];
	if (includeReference) {
		anchorValues.push(resolvedReferenceValue);
	}

	const anchorMin = Math.min(...anchorValues);
	const anchorMax = Math.max(...anchorValues);
	const anchorSpan = Math.max(anchorMax - anchorMin, safeMinSpan);
	const edgePadding = Math.max(anchorSpan * Math.max(paddingRatio, 0), safeMinSpan * 0.45);
	let domainMin = anchorMin - edgePadding;
	let domainMax = anchorMax + edgePadding;

	const rawStep = Math.max(
		(domainMax - domainMin) / Math.max(targetTickCount - 1, 1),
		safeMinSpan / 2,
	);
	const step = resolveNiceStep(rawStep);
	domainMin = Math.floor(domainMin / step) * step;
	domainMax = Math.ceil(domainMax / step) * step;

	if (anchorMin === 0 && anchorValues.every((value) => value >= 0)) {
		domainMin = 0;
	}
	if (anchorMax === 0 && anchorValues.every((value) => value <= 0)) {
		domainMax = 0;
	}

	if (domainMin === domainMax) {
		domainMin -= safeMinSpan;
		domainMax += safeMinSpan;
	}

	return {
		referenceValue: resolvedReferenceValue,
		domain: [domainMin, domainMax],
		minValue,
		maxValue,
		tickValues: buildAxisTicks(domainMin, domainMax, step),
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
