import { useEffect, useMemo, useRef, useState } from "react";
import {
	Area,
	CartesianGrid,
	ComposedChart,
	Line,
	ReferenceLine,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

import type {
	TimelinePoint,
	TimelineRange,
} from "../../types/portfolioAnalytics";
import {
	ANALYTICS_TOOLTIP_ITEM_STYLE,
	ANALYTICS_TOOLTIP_LABEL_STYLE,
	ANALYTICS_TOOLTIP_STYLE,
	buildDisplayTimelineSeriesByRange,
	calculateTimelineReferenceAxisLayout,
	formatCompactCny,
	formatCompactPercentMetric,
	formatCny,
	formatPercentMetric,
	formatPercentage,
	formatTimelineAxisLabel,
	formatTimelineRangeLabel,
	getAdaptiveYAxisWidth,
	getFirstRenderableTimelineRange,
	getTimelineChartTicks,
	isSyntheticTimelinePoint,
	summarizeAverageStepDelta,
	summarizeCompoundedValueStepRate,
	summarizeTimeline,
} from "../../utils/portfolioAnalytics";
import "./analytics.css";
import {
	buildThresholdSegmentedAreaData,
	buildThresholdSegmentedChartData,
	isThresholdSegmentedCrossingPoint,
	type ThresholdSegmentedPoint,
} from "./chartSegmentation";
import { useChartInteractionLock } from "./useChartInteractionLock";
import { useResponsiveChartFrame } from "./useResponsiveChartFrame";

type PortfolioTrendChartProps = {
	hour_series: TimelinePoint[];
	day_series: TimelinePoint[];
	month_series: TimelinePoint[];
	year_series: TimelinePoint[];
	holdings_return_hour_series?: TimelinePoint[];
	holdings_return_day_series?: TimelinePoint[];
	holdings_return_month_series?: TimelinePoint[];
	holdings_return_year_series?: TimelinePoint[];
	defaultRange?: TimelineRange;
	loading?: boolean;
	title?: string;
	description?: string;
};

type PortfolioTrendDisplayMode = "value" | "return";

type PortfolioTrendChartPoint = ThresholdSegmentedPoint;

type TooltipPayloadEntry = {
	dataKey?: string;
	value?: number;
	payload?: { value?: number };
};

type TimelineSummaryState = {
	summary: ReturnType<typeof summarizeTimeline>;
	periodLabel: string;
	selected: boolean;
};

type TrendMetricConfig = {
	referenceMode: "series-start" | "zero";
	minSpan: number;
	valueFormatter: (value: number) => string;
	compactValueFormatter: (value: number) => string;
	tooltipLabel: string;
	referenceLabel: string;
	referenceLineStroke: string;
	positiveLegend: string;
	negativeLegend: string;
};

const RANGE_LABELS: Record<TimelineRange, string> = {
	hour: "24H",
	day: "7天",
	month: "30天",
	year: "年",
};

const MODE_LABELS: Record<PortfolioTrendDisplayMode, string> = {
	value: "资产总额",
	return: "投资类收益率",
};

const VALUE_STEP_LABELS: Record<TimelineRange, string> = {
	hour: "小时平均环比",
	day: "日均环比",
	month: "日均环比",
	year: "月均环比",
};

const RETURN_STEP_LABELS: Record<TimelineRange, string> = {
	hour: "小时均变动",
	day: "日均变动",
	month: "日均变动",
	year: "月均变动",
};

const POSITIVE_TREND_FILL = "rgba(0, 155, 193, 0.22)";
const NEGATIVE_TREND_FILL = "rgba(215, 51, 108, 0.22)";
const TREND_LINE_COLOR = "rgba(230, 235, 241, 0.95)";
const ZERO_RETURN_THRESHOLD = 0;

export function buildPortfolioTrendChartData(
	series: TimelinePoint[],
	thresholdValue = 0,
): PortfolioTrendChartPoint[] {
	return buildThresholdSegmentedChartData(series, thresholdValue);
}

export function buildPortfolioTrendAreaData(
	series: TimelinePoint[],
	thresholdValue = 0,
): PortfolioTrendChartPoint[] {
	return buildThresholdSegmentedAreaData(series, thresholdValue);
}

function formatSignedRatio(ratio: number | null): string {
	if (ratio === null || !Number.isFinite(ratio)) {
		return "--";
	}

	const prefix = ratio > 0 ? "+" : "";
	return `${prefix}${formatPercentage(ratio)}`;
}

function findPointIndexByLabel(
	series: TimelinePoint[],
	point: Pick<TimelinePoint, "label" | "timestamp_utc"> | null,
): number | null {
	if (!point) {
		return null;
	}

	if (point.timestamp_utc) {
		const matchedTimestampIndex = series.findIndex(
			(candidate) => candidate.timestamp_utc === point.timestamp_utc,
		);
		if (matchedTimestampIndex >= 0) {
			return matchedTimestampIndex;
		}
	}

	if (!point.label) {
		return null;
	}

	const matchedIndex = series.findIndex((candidate) => candidate.label === point.label);
	return matchedIndex >= 0 ? matchedIndex : null;
}

function buildSummaryStateFromSeries(
	series: TimelinePoint[],
	activePoint: Pick<TimelinePoint, "label" | "timestamp_utc"> | null,
	endFallbackLabel = "最新周期",
): TimelineSummaryState {
	const matchedIndex = findPointIndexByLabel(series, activePoint);
	const visibleSeries =
		matchedIndex === null ? series : series.slice(0, matchedIndex + 1);
	const endPoint = visibleSeries[visibleSeries.length - 1] ?? null;

	return {
		summary: summarizeTimeline(visibleSeries),
		periodLabel: formatTimelineRangeLabel(series[0], endPoint, endFallbackLabel),
		selected: matchedIndex !== null,
	};
}

function buildDerivedMetricState(
	series: TimelinePoint[],
	activePoint: Pick<TimelinePoint, "label" | "timestamp_utc"> | null,
	summarize: (points: TimelinePoint[]) => number,
): { value: number; selected: boolean } {
	const matchedIndex = findPointIndexByLabel(series, activePoint);
	const visibleSeries =
		matchedIndex === null ? series : series.slice(0, matchedIndex + 1);

	return {
		value: summarize(visibleSeries),
		selected: matchedIndex !== null,
	};
}

function getChangeDirection(changeValue: number): string {
	if (changeValue > 0) {
		return "增加";
	}
	if (changeValue < 0) {
		return "减少";
	}
	return "变化";
}

function isInteractiveTrendPoint(
	point: PortfolioTrendChartPoint | null | undefined,
): boolean {
	return !isThresholdSegmentedCrossingPoint(point) && !isSyntheticTimelinePoint(point);
}

export function PortfolioTrendChart({
	hour_series,
	day_series,
	month_series,
	year_series,
	holdings_return_hour_series = [],
	holdings_return_day_series = [],
	holdings_return_month_series = [],
	holdings_return_year_series = [],
	defaultRange = "hour",
	loading = false,
	title = "资产变化趋势",
	description = "查看资产总额与投资类收益率在 24 小时、7 天、30 天和近一年内的变化。",
}: PortfolioTrendChartProps) {
	const [displayMode, setDisplayMode] =
		useState<PortfolioTrendDisplayMode>("value");
	const [range, setRange] = useState<TimelineRange>(defaultRange);
	const [activePointIndex, setActivePointIndex] = useState<number | null>(null);
	const lastAutoResolvedModeRef = useRef<PortfolioTrendDisplayMode | null>(null);

	const valueSeriesByRange = useMemo(
		() =>
			buildDisplayTimelineSeriesByRange(
				hour_series,
				day_series,
				month_series,
				year_series,
			),
		[day_series, hour_series, month_series, year_series],
	);
	const returnSeriesByRange = useMemo(
		() =>
			buildDisplayTimelineSeriesByRange(
				holdings_return_hour_series,
				holdings_return_day_series,
				holdings_return_month_series,
				holdings_return_year_series,
			),
		[
			holdings_return_day_series,
			holdings_return_hour_series,
			holdings_return_month_series,
			holdings_return_year_series,
		],
	);
	const fallbackRangeByMode = useMemo(
		() => ({
			value: getFirstRenderableTimelineRange(valueSeriesByRange),
			return: getFirstRenderableTimelineRange(returnSeriesByRange),
		}),
		[returnSeriesByRange, valueSeriesByRange],
	);
	const activeSeriesByRange =
		displayMode === "value" ? valueSeriesByRange : returnSeriesByRange;
	const activeFallbackRange = fallbackRangeByMode[displayMode];
	const activeRange = range;
	const activeSeries = activeSeriesByRange[activeRange];
	const valueRangeSeries = valueSeriesByRange[activeRange];
	const valueRangeSummary = summarizeTimeline(valueRangeSeries);
	const valueBaseline = valueRangeSummary.startValue;
	const valueChartData = buildPortfolioTrendChartData(
		valueRangeSeries,
		valueBaseline,
	);
	const valueAreaData = buildPortfolioTrendAreaData(
		valueRangeSeries,
		valueBaseline,
	);
	const returnRangeSeries = returnSeriesByRange[activeRange];
	const returnChartData = buildPortfolioTrendChartData(
		returnRangeSeries,
		ZERO_RETURN_THRESHOLD,
	);
	const returnAreaData = buildPortfolioTrendAreaData(
		returnRangeSeries,
		ZERO_RETURN_THRESHOLD,
	);
	const activeChartData =
		displayMode === "value" ? valueChartData : returnChartData;
	const activeAreaData =
		displayMode === "value" ? valueAreaData : returnAreaData;
	const activePoint =
		activePointIndex === null
			? null
			: (activeChartData[activePointIndex] ?? null);
	const selectedPoint = isInteractiveTrendPoint(activePoint) ? activePoint : null;
	const activeSummaryState = buildSummaryStateFromSeries(
		activeSeries,
		selectedPoint,
		"最新周期",
	);
	const valueStepRateState = buildDerivedMetricState(
		valueRangeSeries,
		displayMode === "value" ? selectedPoint : null,
		summarizeCompoundedValueStepRate,
	);
	const returnStepDeltaState = buildDerivedMetricState(
		returnRangeSeries,
		displayMode === "return" ? selectedPoint : null,
		summarizeAverageStepDelta,
	);
	const hasActiveSummaryData = activeSeries.length >= 1;
	const hasActiveStepMetric = activeSeries.length >= 2;

	const activeMetricConfig: TrendMetricConfig =
		displayMode === "value"
			? {
					referenceMode: "series-start",
					minSpan: Math.max(Math.abs(valueRangeSummary.latestValue) * 0.02, 100),
					valueFormatter: formatCny,
					compactValueFormatter: formatCompactCny,
					tooltipLabel: "资产总额",
					referenceLabel: "期初资产",
					referenceLineStroke: "rgba(214, 212, 203, 0.38)",
					positiveLegend: "期初资产上方区域",
					negativeLegend: "期初资产下方区域",
				}
			: {
					referenceMode: "zero",
					minSpan: 0.3,
					valueFormatter: (value) => formatPercentMetric(value),
					compactValueFormatter: formatCompactPercentMetric,
					tooltipLabel: "投资类收益率",
					referenceLabel: "基准线",
					referenceLineStroke: "rgba(0, 155, 193, 0.65)",
					positiveLegend: "基准线上方区域",
					negativeLegend: "基准线下方区域",
				};
	const axisLayout = useMemo(
		() =>
			calculateTimelineReferenceAxisLayout(activeSeries, {
				referenceMode: activeMetricConfig.referenceMode,
				minSpan: activeMetricConfig.minSpan,
			}),
		[activeMetricConfig.minSpan, activeMetricConfig.referenceMode, activeSeries],
	);
	const { chartContainerRef, chartWidth, compactAxisMode } =
		useResponsiveChartFrame();
	const { chartInteractionHandlers } = useChartInteractionLock();
	const hasData = activeSeries.length >= 2;
	const yAxisWidth = getAdaptiveYAxisWidth(
		[
			activeMetricConfig.compactValueFormatter(axisLayout.minValue),
			activeMetricConfig.compactValueFormatter(axisLayout.referenceValue),
			activeMetricConfig.compactValueFormatter(axisLayout.maxValue),
		],
		{
			minWidth: compactAxisMode ? 64 : 60,
			maxWidth: compactAxisMode ? 84 : 80,
		},
	);
	const xAxisTicks = getTimelineChartTicks(activeSeries, chartWidth, {
		compact: compactAxisMode,
		minTickCount: compactAxisMode ? 3 : 4,
		maxTickCount: compactAxisMode ? 5 : 7,
	});
	const chartDataKey = `${displayMode}:${activeRange}:${activeChartData.length}:${activeChartData[0]?.label ?? ""}:${activeChartData[activeChartData.length - 1]?.label ?? ""}`;

	useEffect(() => {
		if (
			fallbackRangeByMode[displayMode] === null &&
			fallbackRangeByMode.value !== null
		) {
			setDisplayMode("value");
		}
	}, [displayMode, fallbackRangeByMode]);

	useEffect(() => {
		if (lastAutoResolvedModeRef.current === displayMode) {
			return;
		}
		lastAutoResolvedModeRef.current = displayMode;

		if (activeFallbackRange !== null && activeSeriesByRange[range].length < 2) {
			setRange(activeFallbackRange);
		}
	}, [activeFallbackRange, activeSeriesByRange, displayMode, range]);

	useEffect(() => {
		setActivePointIndex(null);
	}, [chartDataKey]);

	function renderActiveDot(props: {
		cx?: number;
		cy?: number;
		fill?: string;
		payload?: PortfolioTrendChartPoint;
		stroke?: string;
	}): JSX.Element | null {
		if (
			typeof props.cx !== "number" ||
			typeof props.cy !== "number" ||
			!isInteractiveTrendPoint(props.payload)
		) {
			return null;
		}

		return (
			<circle
				cx={props.cx}
				cy={props.cy}
				r={4}
				fill={props.fill ?? TREND_LINE_COLOR}
				stroke={props.stroke ?? "none"}
			/>
		);
	}

	const activeValueLabel =
		displayMode === "value"
			? activeSummaryState.selected
				? "所选净值"
				: "最新净值"
			: activeSummaryState.selected
				? "所选投资类收益率"
				: "当前投资类收益率";
	const activePeriodValue =
		!hasActiveSummaryData
			? "--"
			: displayMode === "value"
				? `${getChangeDirection(activeSummaryState.summary.changeValue)}${formatCny(Math.abs(activeSummaryState.summary.changeValue))} / ${formatSignedRatio(activeSummaryState.summary.changeRatio)}`
				: formatPercentMetric(activeSummaryState.summary.changeValue, true);
	const activeStepMetricLabel =
		displayMode === "value"
			? valueStepRateState.selected
				? `至该点${VALUE_STEP_LABELS[activeRange]}`
				: VALUE_STEP_LABELS[activeRange]
			: returnStepDeltaState.selected
				? `至该点${RETURN_STEP_LABELS[activeRange]}`
				: RETURN_STEP_LABELS[activeRange];
	const activeStepMetricValue =
		!hasActiveStepMetric
			? "--"
			: displayMode === "value"
				? formatPercentMetric(valueStepRateState.value, true)
				: formatPercentMetric(returnStepDeltaState.value, true);

	return (
		<section className="analytics-card">
			<div className="analytics-card__header">
				<div>
					<p className="analytics-card__eyebrow">TREND</p>
					<h2 className="analytics-card__title">{title}</h2>
					<p className="analytics-card__description">{description}</p>
				</div>
				<div className="analytics-card__controls">
					<div
						className="analytics-segmented"
						role="tablist"
						aria-label="选择趋势周期"
					>
						{(Object.keys(RANGE_LABELS) as TimelineRange[]).map((item) => (
							<button
								key={item}
								type="button"
								className={activeRange === item ? "active" : ""}
								onClick={() => setRange(item)}
							>
								{RANGE_LABELS[item]}
							</button>
						))}
					</div>
				</div>
			</div>

			<div className="portfolio-trend-card__summary">
				<div
					className="analytics-segmented"
					role="tablist"
					aria-label="选择趋势维度"
				>
					{(Object.keys(MODE_LABELS) as PortfolioTrendDisplayMode[]).map((mode) => (
						<button
							key={mode}
							type="button"
							className={displayMode === mode ? "active" : ""}
							onClick={() => setDisplayMode(mode)}
							disabled={fallbackRangeByMode[mode] === null}
						>
							{MODE_LABELS[mode]}
						</button>
					))}
				</div>
				<div className="analytics-card__meta analytics-card__meta--trend">
					<div className="analytics-pill">
						<span>{activeValueLabel}</span>
						<strong>
							{displayMode === "value"
								? formatCny(activeSummaryState.summary.latestValue)
								: hasActiveSummaryData
									? formatPercentMetric(activeSummaryState.summary.latestValue)
									: "--"}
						</strong>
					</div>
					<div className="analytics-pill">
						<span>
							{hasActiveSummaryData
								? activeSummaryState.periodLabel
								: displayMode === "value"
									? "暂无净值数据"
									: "暂无投资类收益率数据"}
						</span>
						<strong>{activePeriodValue}</strong>
					</div>
					<div className="analytics-pill">
						<span>{activeStepMetricLabel}</span>
						<strong>{activeStepMetricValue}</strong>
					</div>
				</div>
			</div>

			{loading ? (
				<div className="analytics-empty-state">正在加载趋势数据...</div>
			) : !hasData ? (
				<div className="analytics-empty-state">
					{displayMode === "value"
						? "当前所选周期的资产总额数据还在累计中。"
						: "当前所选周期的投资类收益率数据还在累计中。"}
				</div>
			) : (
				<div
					className="analytics-chart analytics-chart--interactive"
					ref={chartContainerRef}
					{...chartInteractionHandlers}
				>
					<ResponsiveContainer width="100%" height={320}>
						<ComposedChart
							data={activeChartData}
							onMouseMove={({ activeTooltipIndex, isTooltipActive }) => {
								if (!isTooltipActive || typeof activeTooltipIndex !== "number") {
									setActivePointIndex(null);
									return;
								}

								if (
									!isInteractiveTrendPoint(activeChartData[activeTooltipIndex])
								) {
									setActivePointIndex(null);
									return;
								}

								setActivePointIndex(activeTooltipIndex);
							}}
							onMouseLeave={() => setActivePointIndex(null)}
							margin={{
								top: 18,
								right: compactAxisMode ? 28 : 20,
								left: compactAxisMode ? 16 : 10,
								bottom: compactAxisMode ? 16 : 8,
							}}
						>
							<CartesianGrid stroke="rgba(255,255,255,0.08)" />
							<XAxis
								dataKey="label"
								stroke="#d6d4cb"
								tickLine={false}
								axisLine={false}
								height={compactAxisMode ? 30 : 24}
								ticks={xAxisTicks}
								interval={0}
								minTickGap={compactAxisMode ? 24 : 12}
								tickMargin={compactAxisMode ? 10 : 8}
								padding={{
									left: compactAxisMode ? 8 : 14,
									right: compactAxisMode ? 16 : 24,
								}}
								tickFormatter={(label: string) =>
									formatTimelineAxisLabel(label, {
										compact: compactAxisMode,
										range: activeRange,
									})
								}
							/>
							<YAxis
								stroke="#d6d4cb"
								tickLine={false}
								axisLine={false}
								width={yAxisWidth}
								domain={axisLayout.domain}
								ticks={axisLayout.tickValues}
								tickMargin={compactAxisMode ? 8 : 6}
								tickFormatter={activeMetricConfig.compactValueFormatter}
							/>
							<ReferenceLine
								y={axisLayout.referenceValue}
								stroke={activeMetricConfig.referenceLineStroke}
							/>
							<Tooltip
								content={({ active, payload, label }) => {
									if (!active || !payload || payload.length === 0) {
										return null;
									}

									const entries = payload as TooltipPayloadEntry[];
									const primaryEntry = entries.find(
										(entry) => entry.dataKey === "value",
									);
									const rawValue = Number(
										primaryEntry?.value ?? primaryEntry?.payload?.value ?? 0,
									);
									const sourcePoint = primaryEntry?.payload as
										| PortfolioTrendChartPoint
										| undefined;
									if (!isInteractiveTrendPoint(sourcePoint)) {
										return null;
									}
									const periodLabel = String(label ?? "");

									return (
										<div style={ANALYTICS_TOOLTIP_STYLE}>
											<p style={ANALYTICS_TOOLTIP_LABEL_STYLE}>周期: {periodLabel}</p>
											<p style={ANALYTICS_TOOLTIP_ITEM_STYLE}>
												{activeMetricConfig.tooltipLabel}:{" "}
												{activeMetricConfig.valueFormatter(rawValue)}
											</p>
											<p style={ANALYTICS_TOOLTIP_ITEM_STYLE}>
												{activeMetricConfig.referenceLabel}:{" "}
												{activeMetricConfig.valueFormatter(axisLayout.referenceValue)}
											</p>
										</div>
									);
								}}
								contentStyle={ANALYTICS_TOOLTIP_STYLE}
								itemStyle={ANALYTICS_TOOLTIP_ITEM_STYLE}
								labelStyle={ANALYTICS_TOOLTIP_LABEL_STYLE}
							/>
							<Area
								type="linear"
								data={activeAreaData}
								dataKey="positiveValue"
								stroke="none"
								fill={POSITIVE_TREND_FILL}
								baseValue={axisLayout.referenceValue}
								connectNulls
							/>
							<Area
								type="linear"
								data={activeAreaData}
								dataKey="negativeValue"
								stroke="none"
								fill={NEGATIVE_TREND_FILL}
								baseValue={axisLayout.referenceValue}
								connectNulls
							/>
							<Line
								type="linear"
								dataKey="value"
								stroke={TREND_LINE_COLOR}
								strokeWidth={2.4}
								dot={false}
								activeDot={renderActiveDot}
							/>
						</ComposedChart>
					</ResponsiveContainer>
					<div
						className="return-trend-legend"
						role="list"
						aria-label={displayMode === "value" ? "净值图例" : "投资类收益率图例"}
					>
						<span
							className="return-trend-legend__item return-trend-legend__item--positive"
							role="listitem"
						>
							{activeMetricConfig.positiveLegend}
						</span>
						<span
							className="return-trend-legend__item return-trend-legend__item--negative"
							role="listitem"
						>
							{activeMetricConfig.negativeLegend}
						</span>
					</div>
				</div>
			)}
		</section>
	);
}
