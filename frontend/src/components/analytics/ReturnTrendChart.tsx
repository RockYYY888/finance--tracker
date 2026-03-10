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
	HoldingReturnSeries,
	TimelinePoint,
	TimelineRange,
} from "../../types/portfolioAnalytics";
import {
	ANALYTICS_TOOLTIP_ITEM_STYLE,
	ANALYTICS_TOOLTIP_LABEL_STYLE,
	ANALYTICS_TOOLTIP_STYLE,
	calculateDynamicAxisLayout,
	formatTimelineAxisLabel,
	formatTimelineRangeLabel,
	getAdaptiveYAxisWidth,
	getTimelineChartTicks,
	formatCompactPercentMetric,
	formatPercentMetric,
	formatPercentage,
	getTimelineSeries,
	prepareTimelineSeries,
	summarizeCompoundedStepRate,
	summarizeTimeline,
} from "../../utils/portfolioAnalytics";
import "./analytics.css";
import {
	buildThresholdSegmentedChartData,
	type ThresholdSegmentedPoint,
} from "./chartSegmentation";
import { useResponsiveChartFrame } from "./useResponsiveChartFrame";

type ReturnTrendSeriesOption = {
	key: string;
	label: string;
	hour_series: TimelinePoint[];
	day_series: TimelinePoint[];
	month_series: TimelinePoint[];
	year_series: TimelinePoint[];
};

type ReturnTrendChartProps = {
	title: string;
	description: string;
	seriesOptions: ReturnTrendSeriesOption[];
	defaultRange?: TimelineRange;
	loading?: boolean;
	selectorLabel?: string;
	emptyMessage?: string;
	showCompoundedStepRate?: boolean;
};

const RANGE_LABELS: Record<TimelineRange, string> = {
	hour: "24H",
	day: "30天",
	month: "12月",
	year: "年",
};

const COMPOUNDED_STEP_LABELS: Record<TimelineRange, string> = {
	hour: "小时平均环比",
	day: "日均环比",
	month: "月均环比",
	year: "年均环比",
};

const POSITIVE_RETURN_COLOR = "#009BC1";
const NEGATIVE_RETURN_COLOR = "#D7336C";
const POSITIVE_RETURN_FILL = "rgba(0, 155, 193, 0.22)";
const NEGATIVE_RETURN_FILL = "rgba(215, 51, 108, 0.22)";
const RETURN_LINE_COLOR = "rgba(230, 235, 241, 0.95)";
const ZERO_RETURN_THRESHOLD = 0;
type ReturnTrendChartPoint = ThresholdSegmentedPoint;

export function buildReturnTrendChartData(
	series: TimelinePoint[],
	thresholdValue = 0,
): ReturnTrendChartPoint[] {
	return buildThresholdSegmentedChartData(series, thresholdValue);
}

function formatSignedRatio(ratio: number): string {
	const prefix = ratio > 0 ? "+" : "";
	return `${prefix}${formatPercentage(ratio)}`;
}

type TooltipPayloadEntry = {
	dataKey?: string;
	value?: number;
	payload?: { value?: number };
};

function toSeriesOptions(items: HoldingReturnSeries[]): ReturnTrendSeriesOption[] {
	return items.map((item) => ({
		key: item.symbol,
		label: item.name,
		hour_series: item.hour_series,
		day_series: item.day_series,
		month_series: item.month_series,
		year_series: item.year_series,
	}));
}

export function createAggregateReturnOption(
	label: string,
	hour_series: TimelinePoint[],
	day_series: TimelinePoint[],
	month_series: TimelinePoint[],
	year_series: TimelinePoint[],
): ReturnTrendSeriesOption {
	return {
		key: "aggregate",
		label,
		hour_series,
		day_series,
		month_series,
		year_series,
	};
}

export function createHoldingReturnOptions(
	items: HoldingReturnSeries[],
): ReturnTrendSeriesOption[] {
	return toSeriesOptions(items);
}

export function ReturnTrendChart({
	title,
	description,
	seriesOptions,
	defaultRange = "hour",
	loading = false,
	selectorLabel = "标的",
	emptyMessage = "暂无可用的收益率历史数据。",
	showCompoundedStepRate = false,
}: ReturnTrendChartProps) {
	const [range, setRange] = useState<TimelineRange>(defaultRange);
	const [selectedKey, setSelectedKey] = useState(seriesOptions[0]?.key ?? "");
	const [activePointIndex, setActivePointIndex] = useState<number | null>(null);

	const selectedOption = useMemo(() => {
		if (seriesOptions.length === 0) {
			return null;
		}

		return seriesOptions.find((option) => option.key === selectedKey) ?? seriesOptions[0];
	}, [selectedKey, seriesOptions]);

	const rawSeries = selectedOption
		? getTimelineSeries(
			range,
			selectedOption.hour_series,
			selectedOption.day_series,
			selectedOption.month_series,
			selectedOption.year_series,
		)
		: [];
	const series = prepareTimelineSeries(rawSeries);
	const rangeSummary = summarizeTimeline(series);
	const rangeCompoundedStepRate = summarizeCompoundedStepRate(series);
	const axisLayout = useMemo(
		() =>
			calculateDynamicAxisLayout(series, {
				referenceValue: ZERO_RETURN_THRESHOLD,
				minSpan: 0.3,
			}),
		[series],
	);
	const chartData = buildReturnTrendChartData(series, ZERO_RETURN_THRESHOLD);
	const { chartContainerRef, chartWidth, compactAxisMode } = useResponsiveChartFrame();
	const activePoint = activePointIndex === null ? null : chartData[activePointIndex] ?? null;
	const hasData = chartData.length > 0;
	const visibleSummary = activePointIndex === null
		? rangeSummary
		: summarizeTimeline(chartData.slice(0, activePointIndex + 1));
	const periodLabel = formatTimelineRangeLabel(
		chartData[0],
		activePoint ?? chartData[chartData.length - 1],
		activePoint?.crossingPoint ? "基准线交点" : "最新周期",
	);
	const visibleCompoundedStepRate = activePointIndex === null
		? rangeCompoundedStepRate
		: summarizeCompoundedStepRate(
			chartData
				.slice(0, activePointIndex + 1)
				.filter((point) => !point.crossingPoint),
		);
	const yAxisWidth = getAdaptiveYAxisWidth(
		[
			formatCompactPercentMetric(axisLayout.minValue),
			formatCompactPercentMetric(axisLayout.referenceValue),
			formatCompactPercentMetric(axisLayout.maxValue),
		],
		{
			minWidth: compactAxisMode ? 64 : 60,
			maxWidth: compactAxisMode ? 84 : 80,
		},
	);
	const xAxisTicks = getTimelineChartTicks(series, chartWidth, {
		compact: compactAxisMode,
		minTickCount: compactAxisMode ? 3 : 4,
		maxTickCount: compactAxisMode ? 5 : 7,
	});
	const chartDataKey = `${selectedOption?.key ?? "none"}:${range}:${chartData.length}:${chartData[0]?.label ?? ""}:${chartData[chartData.length - 1]?.label ?? ""}`;

	useEffect(() => {
		setActivePointIndex(null);
	}, [chartDataKey]);

	return (
		<section className="analytics-card">
			<div className="analytics-card__header">
				<div>
					<p className="analytics-card__eyebrow">RETURN</p>
					<h2 className="analytics-card__title">{title}</h2>
					<p className="analytics-card__description">{description}</p>
				</div>
				<div className="analytics-segmented" role="tablist" aria-label="选择收益率周期">
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

			{seriesOptions.length > 1 ? (
				<label className="analytics-select">
					<span>{selectorLabel}</span>
					<select
						value={selectedOption?.key ?? ""}
						onChange={(event) => setSelectedKey(event.target.value)}
					>
						{seriesOptions.map((option) => (
							<option key={option.key} value={option.key}>
								{option.label}
							</option>
						))}
					</select>
				</label>
			) : null}

			<div className="analytics-card__meta">
				<div className="analytics-pill">
					<span>{selectorLabel}</span>
					<strong>{selectedOption?.label ?? "未选择"}</strong>
				</div>
				<div className="analytics-pill">
					<span>{activePoint ? "所选收益率" : "当前收益率"}</span>
					<strong>{formatPercentMetric(visibleSummary.latestValue)}</strong>
				</div>
				<div className="analytics-pill">
					<span>{periodLabel}</span>
					<strong>
						{visibleSummary.changeRatio === null
							? `${formatPercentMetric(visibleSummary.changeValue, true)} / --`
							: `${formatPercentMetric(visibleSummary.changeValue, true)} / ${formatSignedRatio(visibleSummary.changeRatio)}`}
					</strong>
				</div>
				{showCompoundedStepRate ? (
					<div className="analytics-pill">
						<span>
							{activePoint ? `至该点${COMPOUNDED_STEP_LABELS[range]}` : COMPOUNDED_STEP_LABELS[range]}
						</span>
						<strong>{formatPercentMetric(visibleCompoundedStepRate, true)}</strong>
					</div>
				) : null}
			</div>

			{loading ? (
				<div className="analytics-empty-state">正在加载收益率数据...</div>
			) : !hasData ? (
				<div className="analytics-empty-state">{emptyMessage}</div>
			) : (
				<div className="analytics-chart" ref={chartContainerRef}>
					<ResponsiveContainer width="100%" height={300}>
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
								tickFormatter={formatCompactPercentMetric}
							/>
							<ReferenceLine
								y={axisLayout.referenceValue}
								stroke="rgba(0, 155, 193, 0.65)"
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
										| ReturnTrendChartPoint
										| undefined;
									const periodLabel = sourcePoint?.crossingPoint
										? "基准线交点"
										: String(label ?? "");

									return (
										<div style={ANALYTICS_TOOLTIP_STYLE}>
											<p style={ANALYTICS_TOOLTIP_LABEL_STYLE}>
												周期: {periodLabel}
											</p>
											<p style={ANALYTICS_TOOLTIP_ITEM_STYLE}>
												收益率: {formatPercentMetric(rawValue)}
											</p>
											<p style={ANALYTICS_TOOLTIP_ITEM_STYLE}>
												基准线: {formatPercentMetric(axisLayout.referenceValue)}
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
								stroke={POSITIVE_RETURN_COLOR}
								fill={POSITIVE_RETURN_FILL}
								strokeWidth={1.2}
								baseValue={ZERO_RETURN_THRESHOLD}
								connectNulls
							/>
							<Area
								type="linear"
								dataKey="negativeValue"
								stroke={NEGATIVE_RETURN_COLOR}
								fill={NEGATIVE_RETURN_FILL}
								strokeWidth={1.2}
								baseValue={ZERO_RETURN_THRESHOLD}
								connectNulls
							/>
							<Line
								type="linear"
								dataKey="value"
								stroke={RETURN_LINE_COLOR}
								strokeWidth={2.4}
								dot={false}
								activeDot={{ r: 4, fill: RETURN_LINE_COLOR }}
							/>
						</ComposedChart>
					</ResponsiveContainer>
					<div className="return-trend-legend" role="list" aria-label="收益图例">
						<span
							className="return-trend-legend__item return-trend-legend__item--positive"
							role="listitem"
						>
							基准线上方区域
						</span>
						<span
							className="return-trend-legend__item return-trend-legend__item--negative"
							role="listitem"
						>
							基准线下方区域
						</span>
					</div>
				</div>
			)}
		</section>
	);
}
