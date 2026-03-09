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
	getChartTickInterval,
	formatCompactCny,
	formatCny,
	formatPercentage,
	getTimelineSeries,
	prepareTimelineSeries,
	summarizeTimeline,
} from "../../utils/portfolioAnalytics";
import "./analytics.css";
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

type PortfolioTrendChartPoint = TimelinePoint & {
	positiveValue: number;
	negativeValue: number;
};

export function buildPortfolioTrendChartData(
	series: TimelinePoint[],
	centerValue = 0,
): PortfolioTrendChartPoint[] {
	return series.map((point) => ({
		...point,
		positiveValue: point.value >= centerValue ? point.value : centerValue,
		negativeValue: point.value < centerValue ? point.value : centerValue,
	}));
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
	const axisLayout = useMemo(
		() =>
			calculateDynamicAxisLayout(series, {
				minSpan: Math.max(Math.abs(rangeSummary.latestValue) * 0.02, 100),
			}),
		[series, rangeSummary.latestValue],
	);
	const chartData = buildPortfolioTrendChartData(series, axisLayout.centerValue);
	const { chartContainerRef, chartWidth, compactAxisMode } = useResponsiveChartFrame();
	const activePoint = activePointIndex === null ? null : chartData[activePointIndex] ?? null;
	const hasData = chartData.length > 0;
	const visibleSummary = activePointIndex === null
		? rangeSummary
		: summarizeTimeline(chartData.slice(0, activePointIndex + 1));
	const periodLabel = formatTimelineRangeLabel(
		chartData[0],
		activePoint ?? chartData[chartData.length - 1],
		"最新周期",
	);
	const changeDirection = visibleSummary.changeValue > 0
		? "增加"
		: visibleSummary.changeValue < 0
			? "减少"
			: "变化";
	const centerDeltaValue = visibleSummary.latestValue - axisLayout.centerValue;
	const centerRatioDenominator = Math.max(
		Math.abs(axisLayout.centerValue),
		Math.abs(axisLayout.maxValue - axisLayout.minValue) * 0.6,
		1e-6,
	);
	const centerDeltaRatio = centerDeltaValue / centerRatioDenominator;
	const yAxisWidth = getAdaptiveYAxisWidth(
		[
			formatCompactCny(axisLayout.minValue),
			formatCompactCny(axisLayout.centerValue),
			formatCompactCny(axisLayout.maxValue),
		],
		{
			minWidth: compactAxisMode ? 56 : 52,
			maxWidth: compactAxisMode ? 76 : 72,
		},
	);
	const xAxisInterval = getChartTickInterval(chartData.length, chartWidth, {
		compact: compactAxisMode,
		minLabelSpacing: compactAxisMode ? 64 : 88,
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
				<div className="analytics-pill">
					<span>相对中线偏离</span>
					<strong>
						{formatCny(centerDeltaValue)}
						{" / "}
						{formatSignedRatio(centerDeltaRatio)}
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
								top: 12,
								right: compactAxisMode ? 18 : 12,
								left: compactAxisMode ? 8 : 0,
								bottom: compactAxisMode ? 10 : 0,
							}}
						>
							<CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
							<XAxis
								dataKey="label"
								stroke="#d6d4cb"
								tickLine={false}
								axisLine={false}
								height={compactAxisMode ? 30 : 24}
								interval={xAxisInterval}
								minTickGap={compactAxisMode ? 24 : 12}
								tickMargin={compactAxisMode ? 10 : 8}
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
								tickCount={axisLayout.tickCount}
								tickFormatter={formatCompactCny}
							/>
							<ReferenceLine
								y={axisLayout.centerValue}
								stroke="rgba(0, 155, 193, 0.65)"
								strokeDasharray="5 5"
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

									return (
										<div style={ANALYTICS_TOOLTIP_STYLE}>
											<p style={ANALYTICS_TOOLTIP_LABEL_STYLE}>
												周期: {String(label ?? "")}
											</p>
											<p style={ANALYTICS_TOOLTIP_ITEM_STYLE}>
												资产总额: {formatCny(rawValue)}
											</p>
											<p style={ANALYTICS_TOOLTIP_ITEM_STYLE}>
												中位中线: {formatCny(axisLayout.centerValue)}
											</p>
										</div>
									);
								}}
								contentStyle={ANALYTICS_TOOLTIP_STYLE}
								itemStyle={ANALYTICS_TOOLTIP_ITEM_STYLE}
								labelStyle={ANALYTICS_TOOLTIP_LABEL_STYLE}
							/>
							<Area
								type="monotone"
								dataKey="positiveValue"
								stroke={POSITIVE_TREND_COLOR}
								fill={POSITIVE_TREND_FILL}
								strokeWidth={1.2}
								baseValue={axisLayout.centerValue}
								connectNulls
							/>
							<Area
								type="monotone"
								dataKey="negativeValue"
								stroke={NEGATIVE_TREND_COLOR}
								fill={NEGATIVE_TREND_FILL}
								strokeWidth={1.2}
								baseValue={axisLayout.centerValue}
								connectNulls
							/>
							<Line
								type="monotone"
								dataKey="value"
								stroke={TREND_LINE_COLOR}
								strokeWidth={2.4}
								dot={false}
								activeDot={{ r: 4, fill: TREND_LINE_COLOR }}
							/>
						</ComposedChart>
					</ResponsiveContainer>
					<div className="return-trend-legend" role="list" aria-label="净值图例">
						<span className="return-trend-legend__item" role="listitem">
							<span
								className="return-trend-legend__swatch return-trend-legend__swatch--positive"
								aria-hidden="true"
							/>
							净值高于中位数
						</span>
						<span className="return-trend-legend__item" role="listitem">
							<span
								className="return-trend-legend__swatch return-trend-legend__swatch--negative"
								aria-hidden="true"
							/>
							净值低于中位数
						</span>
					</div>
				</div>
			)}
		</section>
	);
}
