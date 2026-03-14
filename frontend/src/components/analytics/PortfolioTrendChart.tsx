import { useEffect, useMemo, useState } from "react";
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
	buildPreparedTimelineSeriesByRange,
	calculateDynamicAxisLayout,
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
	summarizeCompoundedStepRate,
	summarizeTimeline,
} from "../../utils/portfolioAnalytics";
import "./analytics.css";
import {
	buildThresholdSegmentedChartData,
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
	referenceValue: number;
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
	day: "30天",
	month: "12月",
	year: "年",
};

const MODE_LABELS: Record<PortfolioTrendDisplayMode, string> = {
	value: "总额",
	return: "收益率",
};

const COMPOUNDED_STEP_LABELS: Record<TimelineRange, string> = {
	hour: "小时平均环比",
	day: "日均环比",
	month: "月均环比",
	year: "年均环比",
};

const POSITIVE_TREND_COLOR = "#009BC1";
const NEGATIVE_TREND_COLOR = "#D7336C";
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

function formatSignedRatio(ratio: number | null): string {
	if (ratio === null || !Number.isFinite(ratio)) {
		return "--";
	}

	const prefix = ratio > 0 ? "+" : "";
	return `${prefix}${formatPercentage(ratio)}`;
}

function findPointIndexByLabel(
	series: TimelinePoint[],
	label: string | null,
): number | null {
	if (!label) {
		return null;
	}

	const matchedIndex = series.findIndex((point) => point.label === label);
	return matchedIndex >= 0 ? matchedIndex : null;
}

function buildSummaryStateFromSeries(
	series: TimelinePoint[],
	activeLabel: string | null,
	endFallbackLabel = "最新周期",
): TimelineSummaryState {
	const matchedIndex = findPointIndexByLabel(series, activeLabel);
	const visibleSeries =
		matchedIndex === null ? series : series.slice(0, matchedIndex + 1);
	const endPoint = visibleSeries[visibleSeries.length - 1] ?? null;

	return {
		summary: summarizeTimeline(visibleSeries),
		periodLabel: formatTimelineRangeLabel(series[0], endPoint, endFallbackLabel),
		selected: matchedIndex !== null,
	};
}

function buildCompoundedStepRateState(
	series: TimelinePoint[],
	activeLabel: string | null,
): { value: number; selected: boolean } {
	const matchedIndex = findPointIndexByLabel(series, activeLabel);
	const visibleSeries =
		matchedIndex === null ? series : series.slice(0, matchedIndex + 1);

	return {
		value: summarizeCompoundedStepRate(visibleSeries),
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
	description = "查看总额与收益率在 24 小时、30 天、12 个月和年度维度的变化。",
}: PortfolioTrendChartProps) {
	const [displayMode, setDisplayMode] =
		useState<PortfolioTrendDisplayMode>("value");
	const [range, setRange] = useState<TimelineRange>(defaultRange);
	const [activePointIndex, setActivePointIndex] = useState<number | null>(null);

	const valueSeriesByRange = useMemo(
		() =>
			buildPreparedTimelineSeriesByRange(
				hour_series,
				day_series,
				month_series,
				year_series,
			),
		[day_series, hour_series, month_series, year_series],
	);
	const returnSeriesByRange = useMemo(
		() =>
			buildPreparedTimelineSeriesByRange(
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
	const activeRange =
		activeSeriesByRange[range].length >= 2 || activeFallbackRange === null
			? range
			: activeFallbackRange;
	const activeSeries = activeSeriesByRange[activeRange];

	const valueRangeSeries = valueSeriesByRange[activeRange];
	const valueRangeSummary = summarizeTimeline(valueRangeSeries);
	const valueBaseline = valueRangeSummary.startValue;
	const valueChartData = buildPortfolioTrendChartData(
		valueRangeSeries,
		valueBaseline,
	);
	const returnRangeSeries = returnSeriesByRange[activeRange];
	const returnChartData = buildPortfolioTrendChartData(
		returnRangeSeries,
		ZERO_RETURN_THRESHOLD,
	);
	const activeChartData =
		displayMode === "value" ? valueChartData : returnChartData;
	const activePoint =
		activePointIndex === null
			? null
			: (activeChartData[activePointIndex] ?? null);
	const activeLabel = activePoint?.crossingPoint
		? null
		: (activePoint?.label ?? null);
	const hasReturnSummaryData = returnRangeSeries.length >= 1;
	const hasReturnTrendData = returnRangeSeries.length >= 2;

	const valueSummaryState =
		displayMode === "value"
			? {
					summary:
						activePointIndex === null
							? valueRangeSummary
							: summarizeTimeline(valueChartData.slice(0, activePointIndex + 1)),
					periodLabel: formatTimelineRangeLabel(
						valueChartData[0],
						activePoint ?? valueChartData[valueChartData.length - 1],
						activePoint?.crossingPoint ? "期初资产交点" : "最新周期",
					),
					selected: activePointIndex !== null,
				}
			: buildSummaryStateFromSeries(valueRangeSeries, activeLabel);
	const returnSummaryState =
		displayMode === "return"
			? {
					summary:
						activePointIndex === null
							? summarizeTimeline(returnRangeSeries)
							: summarizeTimeline(returnChartData.slice(0, activePointIndex + 1)),
					periodLabel: formatTimelineRangeLabel(
						returnChartData[0],
						activePoint ?? returnChartData[returnChartData.length - 1],
						activePoint?.crossingPoint ? "基准线交点" : "最新周期",
					),
					selected: activePointIndex !== null,
				}
			: buildSummaryStateFromSeries(returnRangeSeries, activeLabel);
	const compoundedStepRateState = buildCompoundedStepRateState(
		returnRangeSeries,
		activeLabel,
	);

	const activeMetricConfig: TrendMetricConfig =
		displayMode === "value"
			? {
					referenceValue: valueBaseline,
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
					referenceValue: ZERO_RETURN_THRESHOLD,
					minSpan: 0.3,
					valueFormatter: (value) => formatPercentMetric(value),
					compactValueFormatter: formatCompactPercentMetric,
					tooltipLabel: "收益率",
					referenceLabel: "基准线",
					referenceLineStroke: "rgba(0, 155, 193, 0.65)",
					positiveLegend: "基准线上方区域",
					negativeLegend: "基准线下方区域",
				};
	const axisLayout = useMemo(
		() =>
			calculateDynamicAxisLayout(activeSeries, {
				referenceValue: activeMetricConfig.referenceValue,
				minSpan: activeMetricConfig.minSpan,
			}),
		[activeMetricConfig.minSpan, activeMetricConfig.referenceValue, activeSeries],
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
		if (activeRange !== range) {
			setRange(activeRange);
		}
	}, [activeRange, range]);

	useEffect(() => {
		setActivePointIndex(null);
	}, [chartDataKey]);

	const valueChangeDirection = getChangeDirection(
		valueSummaryState.summary.changeValue,
	);
	const returnRateLabel = compoundedStepRateState.selected
		? `至该点${COMPOUNDED_STEP_LABELS[activeRange]}`
		: COMPOUNDED_STEP_LABELS[activeRange];

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
								disabled={activeSeriesByRange[item].length < 2}
							>
								{RANGE_LABELS[item]}
							</button>
						))}
					</div>
				</div>
			</div>

			<div className="analytics-card__meta">
				<div className="analytics-pill">
					<span>{valueSummaryState.selected ? "所选净值" : "最新净值"}</span>
					<strong>{formatCny(valueSummaryState.summary.latestValue)}</strong>
				</div>
				<div className="analytics-pill">
					<span>{valueSummaryState.periodLabel}</span>
					<strong>
						{valueChangeDirection}
						{formatCny(Math.abs(valueSummaryState.summary.changeValue))}
						{" / "}
						{formatSignedRatio(valueSummaryState.summary.changeRatio)}
					</strong>
				</div>
				<div className="analytics-pill">
					<span>{returnSummaryState.selected ? "所选收益率" : "当前收益率"}</span>
					<strong>
						{hasReturnSummaryData
							? formatPercentMetric(returnSummaryState.summary.latestValue)
							: "--"}
					</strong>
				</div>
				<div className="analytics-pill">
					<span>
						{hasReturnSummaryData ? returnSummaryState.periodLabel : "暂无收益率数据"}
					</span>
					<strong>
						{!hasReturnSummaryData
							? "--"
							: returnSummaryState.summary.changeRatio === null
								? `${formatPercentMetric(returnSummaryState.summary.changeValue, true)} / --`
								: `${formatPercentMetric(returnSummaryState.summary.changeValue, true)} / ${formatSignedRatio(returnSummaryState.summary.changeRatio)}`}
					</strong>
				</div>
				<div className="analytics-pill">
					<span>{returnRateLabel}</span>
					<strong>
						{hasReturnTrendData
							? formatPercentMetric(compoundedStepRateState.value, true)
							: "--"}
					</strong>
				</div>
			</div>

			{loading ? (
				<div className="analytics-empty-state">正在加载趋势数据...</div>
			) : !hasData ? (
				<div className="analytics-empty-state">
					{displayMode === "value"
						? "还没有足够的资产快照。随着资产变动，这里会逐步形成趋势。"
						: "暂无整体收益率数据。"}
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
									const periodLabel = sourcePoint?.crossingPoint
										? displayMode === "value"
											? "期初资产交点"
											: "基准线交点"
										: String(label ?? "");

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
								dataKey="positiveValue"
								stroke={POSITIVE_TREND_COLOR}
								fill={POSITIVE_TREND_FILL}
								strokeWidth={1.2}
								baseValue={axisLayout.referenceValue}
								connectNulls
							/>
							<Area
								type="linear"
								dataKey="negativeValue"
								stroke={NEGATIVE_TREND_COLOR}
								fill={NEGATIVE_TREND_FILL}
								strokeWidth={1.2}
								baseValue={axisLayout.referenceValue}
								connectNulls
							/>
							<Line
								type="linear"
								dataKey="value"
								stroke={TREND_LINE_COLOR}
								strokeWidth={2.4}
								dot={false}
								activeDot={{ r: 4, fill: TREND_LINE_COLOR }}
							/>
						</ComposedChart>
					</ResponsiveContainer>
					<div
						className="return-trend-legend"
						role="list"
						aria-label={displayMode === "value" ? "净值图例" : "收益率图例"}
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
