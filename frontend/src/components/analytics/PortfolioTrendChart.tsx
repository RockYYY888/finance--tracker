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

import type { TimelinePoint, TimelineRange } from "../../types/portfolioAnalytics";
import {
	ANALYTICS_TOOLTIP_ITEM_STYLE,
	ANALYTICS_TOOLTIP_LABEL_STYLE,
	ANALYTICS_TOOLTIP_STYLE,
	calculateDynamicAxisLayout,
	formatTimelineAxisLabel,
	formatTimelineRangeLabel,
	getAdaptiveYAxisWidth,
	getTimelineChartTicks,
	formatCompactCny,
	formatCny,
	formatPercentage,
	getTimelineSeries,
	prepareTimelineSeries,
	summarizeTimeline,
} from "../../utils/portfolioAnalytics";
import "./analytics.css";
import {
	buildThresholdSegmentedChartData,
	type ThresholdSegmentedPoint,
} from "./chartSegmentation";
import { useResponsiveChartFrame } from "./useResponsiveChartFrame";

type PortfolioTrendChartProps = {
	hour_series: TimelinePoint[];
	day_series: TimelinePoint[];
	month_series: TimelinePoint[];
	year_series: TimelinePoint[];
	defaultRange?: TimelineRange;
	loading?: boolean;
	title?: string;
	description?: string;
};

const RANGE_LABELS: Record<TimelineRange, string> = {
	hour: "24H",
	day: "30天",
	month: "12月",
	year: "年",
};

const POSITIVE_TREND_COLOR = "#009BC1";
const NEGATIVE_TREND_COLOR = "#D7336C";
const POSITIVE_TREND_FILL = "rgba(0, 155, 193, 0.22)";
const NEGATIVE_TREND_FILL = "rgba(215, 51, 108, 0.22)";
const TREND_LINE_COLOR = "rgba(230, 235, 241, 0.95)";

type PortfolioTrendChartPoint = ThresholdSegmentedPoint;

export function buildPortfolioTrendChartData(
	series: TimelinePoint[],
	thresholdValue = 0,
): PortfolioTrendChartPoint[] {
	return buildThresholdSegmentedChartData(series, thresholdValue);
}

type TooltipPayloadEntry = {
	dataKey?: string;
	value?: number;
	payload?: { value?: number };
};

function formatSignedRatio(ratio: number | null): string {
	if (ratio === null || !Number.isFinite(ratio)) {
		return "--";
	}

	const prefix = ratio > 0 ? "+" : "";
	return `${prefix}${formatPercentage(ratio)}`;
}

export function PortfolioTrendChart({
	hour_series,
	day_series,
	month_series,
	year_series,
	defaultRange = "hour",
	loading = false,
	title = "资产变化趋势",
	description = "查看 24 小时、30 天、12 个月和年度变化。",
}: PortfolioTrendChartProps) {
	const [range, setRange] = useState<TimelineRange>(defaultRange);
	const [activePointIndex, setActivePointIndex] = useState<number | null>(null);
	const rawSeries = getTimelineSeries(range, hour_series, day_series, month_series, year_series);
	const series = prepareTimelineSeries(rawSeries);
	const rangeSummary = summarizeTimeline(series);
	const baselineValue = rangeSummary.startValue;
	const axisLayout = useMemo(
		() =>
			calculateDynamicAxisLayout(series, {
				referenceValue: baselineValue,
				minSpan: Math.max(Math.abs(rangeSummary.latestValue) * 0.02, 100),
			}),
		[baselineValue, series, rangeSummary.latestValue],
	);
	const chartData = buildPortfolioTrendChartData(series, baselineValue);
	const { chartContainerRef, chartWidth, compactAxisMode } = useResponsiveChartFrame();
	const activePoint = activePointIndex === null ? null : chartData[activePointIndex] ?? null;
	const hasData = chartData.length > 0;
	const visibleSummary = activePointIndex === null
		? rangeSummary
		: summarizeTimeline(chartData.slice(0, activePointIndex + 1));
	const periodLabel = formatTimelineRangeLabel(
		chartData[0],
		activePoint ?? chartData[chartData.length - 1],
		activePoint?.crossingPoint ? "期初资产交点" : "最新周期",
	);
	const changeDirection = visibleSummary.changeValue > 0
		? "增加"
		: visibleSummary.changeValue < 0
			? "减少"
			: "变化";
	const yAxisWidth = getAdaptiveYAxisWidth(
		[
			formatCompactCny(axisLayout.minValue),
			formatCompactCny(axisLayout.referenceValue),
			formatCompactCny(axisLayout.maxValue),
		],
		{
			minWidth: compactAxisMode ? 60 : 56,
			maxWidth: compactAxisMode ? 84 : 80,
		},
	);
	const xAxisTicks = getTimelineChartTicks(series, chartWidth, {
		compact: compactAxisMode,
		minTickCount: compactAxisMode ? 3 : 4,
		maxTickCount: compactAxisMode ? 5 : 7,
	});
	const chartDataKey = `${range}:${chartData.length}:${chartData[0]?.label ?? ""}:${chartData[chartData.length - 1]?.label ?? ""}`;

	useEffect(() => {
		setActivePointIndex(null);
	}, [chartDataKey]);

	return (
		<section className="analytics-card">
			<div className="analytics-card__header">
				<div>
					<p className="analytics-card__eyebrow">TREND</p>
					<h2 className="analytics-card__title">{title}</h2>
					<p className="analytics-card__description">{description}</p>
				</div>
				<div className="analytics-segmented" role="tablist" aria-label="选择趋势周期">
					{(Object.keys(RANGE_LABELS) as TimelineRange[]).map((item) => (
						<button
							key={item}
							type="button"
							className={range === item ? "active" : ""}
							onClick={() => setRange(item)}
						>
							{RANGE_LABELS[item]}
						</button>
					))}
				</div>
			</div>

			<div className="analytics-card__meta">
				<div className="analytics-pill">
					<span>{activePoint ? "所选净值" : "最新净值"}</span>
					<strong>{formatCny(visibleSummary.latestValue)}</strong>
				</div>
				<div className="analytics-pill">
					<span>{periodLabel}</span>
					<strong>
						{changeDirection}
						{formatCny(Math.abs(visibleSummary.changeValue))}
						{" / "}
						{formatSignedRatio(visibleSummary.changeRatio)}
					</strong>
				</div>
			</div>

			{loading ? (
				<div className="analytics-empty-state">正在加载趋势数据...</div>
			) : !hasData ? (
				<div className="analytics-empty-state">
					还没有足够的资产快照。随着资产变动，这里会逐步形成趋势。
				</div>
			) : (
				<div className="analytics-chart" ref={chartContainerRef}>
					<ResponsiveContainer width="100%" height={320}>
						<ComposedChart
							data={chartData}
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
										range,
									})}
							/>
							<YAxis
								stroke="#d6d4cb"
								tickLine={false}
								axisLine={false}
								width={yAxisWidth}
								domain={axisLayout.domain}
								ticks={axisLayout.tickValues}
								tickMargin={compactAxisMode ? 8 : 6}
								tickFormatter={formatCompactCny}
							/>
							<ReferenceLine
								y={axisLayout.referenceValue}
								stroke="rgba(214, 212, 203, 0.38)"
							/>
							<Tooltip
								content={({ active, payload, label }) => {
									if (!active || !payload || payload.length === 0) {
										return null;
									}

									const entries = payload as TooltipPayloadEntry[];
									const primaryEntry = entries.find((entry) => entry.dataKey === "value");
									const rawValue = Number(
										primaryEntry?.value ?? primaryEntry?.payload?.value ?? 0,
									);
									const sourcePoint = primaryEntry?.payload as
										| PortfolioTrendChartPoint
										| undefined;
										const periodLabel = sourcePoint?.crossingPoint
											? "期初资产交点"
											: String(label ?? "");

									return (
										<div style={ANALYTICS_TOOLTIP_STYLE}>
											<p style={ANALYTICS_TOOLTIP_LABEL_STYLE}>
												周期: {periodLabel}
											</p>
											<p style={ANALYTICS_TOOLTIP_ITEM_STYLE}>
												资产总额: {formatCny(rawValue)}
											</p>
											<p style={ANALYTICS_TOOLTIP_ITEM_STYLE}>
												期初资产: {formatCny(axisLayout.referenceValue)}
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
					<div className="return-trend-legend" role="list" aria-label="净值图例">
							<span
								className="return-trend-legend__item return-trend-legend__item--positive"
								role="listitem"
							>
								期初资产上方区域
							</span>
							<span
								className="return-trend-legend__item return-trend-legend__item--negative"
								role="listitem"
							>
								期初资产下方区域
							</span>
					</div>
				</div>
			)}
		</section>
	);
}
