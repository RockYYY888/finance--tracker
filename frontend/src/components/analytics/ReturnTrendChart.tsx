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
	getAdaptiveYAxisWidth,
	formatCompactPercentMetric,
	formatPercentMetric,
	formatPercentage,
	getTimelineSeries,
	prepareTimelineSeries,
	summarizeCompoundedStepRate,
	summarizeTimeline,
} from "../../utils/portfolioAnalytics";
import "./analytics.css";

const COMPACT_AXIS_BREAKPOINT_PX = 560;

function useCompactAxisMode(breakpointPx = COMPACT_AXIS_BREAKPOINT_PX): boolean {
	const [isCompact, setIsCompact] = useState(() => {
		if (typeof window === "undefined") {
			return false;
		}
		return window.innerWidth <= breakpointPx;
	});

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		const handleResize = () => {
			setIsCompact(window.innerWidth <= breakpointPx);
		};

		window.addEventListener("resize", handleResize);
		return () => window.removeEventListener("resize", handleResize);
	}, [breakpointPx]);

	return isCompact;
}

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
const CROSSING_EPSILON = 1e-8;

type ReturnTrendChartPoint = TimelinePoint & {
	positiveValue: number;
	negativeValue: number;
	crossingPoint?: boolean;
};

function toTimestampMs(point: TimelinePoint): number | null {
	if (!point.timestamp_utc) {
		return null;
	}

	const parsedTimestamp = Date.parse(point.timestamp_utc);
	if (!Number.isFinite(parsedTimestamp)) {
		return null;
	}

	return parsedTimestamp;
}

function buildThresholdCrossingPoint(
	left: TimelinePoint,
	right: TimelinePoint,
	thresholdValue: number,
): TimelinePoint {
	const denominator = right.value - left.value;
	const ratio = Math.min(
		1,
		Math.max(
			0,
			denominator === 0 ? 0 : (thresholdValue - left.value) / denominator,
		),
	);
	const leftTimestampMs = toTimestampMs(left);
	const rightTimestampMs = toTimestampMs(right);
	const interpolatedTimestamp =
		leftTimestampMs === null || rightTimestampMs === null
			? undefined
			: new Date(
				Math.round(leftTimestampMs + (rightTimestampMs - leftTimestampMs) * ratio),
			).toISOString();

	return {
		label: "",
		value: thresholdValue,
		timestamp_utc: interpolatedTimestamp,
		corrected: false,
	};
}

function shouldInsertCrossingPoint(
	left: TimelinePoint,
	right: TimelinePoint,
	thresholdValue: number,
): boolean {
	const leftDelta = left.value - thresholdValue;
	const rightDelta = right.value - thresholdValue;
	if (Math.abs(leftDelta) <= CROSSING_EPSILON || Math.abs(rightDelta) <= CROSSING_EPSILON) {
		return false;
	}

	return leftDelta * rightDelta < 0;
}

export function buildReturnTrendChartData(
	series: TimelinePoint[],
	thresholdValue = 0,
): ReturnTrendChartPoint[] {
	if (series.length <= 1) {
		return series.map((point) => ({
			...point,
			positiveValue: point.value >= thresholdValue ? point.value : thresholdValue,
			negativeValue: point.value < thresholdValue ? point.value : thresholdValue,
		}));
	}

	const segmentedSeries: TimelinePoint[] = [];
	segmentedSeries.push(series[0]);
	for (let index = 1; index < series.length; index += 1) {
		const previousPoint = series[index - 1];
		const currentPoint = series[index];

		if (shouldInsertCrossingPoint(previousPoint, currentPoint, thresholdValue)) {
			segmentedSeries.push(
				buildThresholdCrossingPoint(previousPoint, currentPoint, thresholdValue),
			);
		}
		segmentedSeries.push(currentPoint);
	}

	return segmentedSeries.map((point) => {
		const isCrossingPoint =
			Math.abs(point.value - thresholdValue) <= CROSSING_EPSILON && !point.label;
		return {
			...point,
			...(isCrossingPoint ? { crossingPoint: true } : {}),
			positiveValue: point.value >= thresholdValue ? point.value : thresholdValue,
			negativeValue: point.value < thresholdValue ? point.value : thresholdValue,
		};
	});
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
	const summary = summarizeTimeline(series);
	const compoundedStepRate = summarizeCompoundedStepRate(series);
	const axisLayout = useMemo(
		() =>
			calculateDynamicAxisLayout(series, {
				includeZero: true,
				minSpan: 0.3,
			}),
		[series],
	);
	const chartData = buildReturnTrendChartData(series, ZERO_RETURN_THRESHOLD);
	const compactAxisMode = useCompactAxisMode();
	const hasData = chartData.length > 0;
	const centerDeltaValue = summary.latestValue - axisLayout.centerValue;
	const centerRatioDenominator = Math.max(
		Math.abs(axisLayout.centerValue),
		Math.abs(axisLayout.maxValue - axisLayout.minValue) * 0.6,
		1e-6,
	);
	const centerDeltaRatio = centerDeltaValue / centerRatioDenominator;
	const yAxisWidth = getAdaptiveYAxisWidth(
		[
			formatCompactPercentMetric(axisLayout.minValue),
			formatCompactPercentMetric(axisLayout.centerValue),
			formatCompactPercentMetric(axisLayout.maxValue),
		],
		{
			minWidth: compactAxisMode ? 60 : 56,
			maxWidth: compactAxisMode ? 80 : 76,
		},
	);

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
					<span>当前收益率</span>
					<strong>{formatPercentMetric(summary.latestValue)}</strong>
				</div>
				<div className="analytics-pill">
					<span>周期变化</span>
					<strong>
						{summary.changeRatio === null
							? `${formatPercentMetric(summary.changeValue, true)} / --`
							: `${formatPercentMetric(summary.changeValue, true)} / ${formatSignedRatio(summary.changeRatio)}`}
					</strong>
				</div>
				<div className="analytics-pill">
					<span>相对中线偏离</span>
					<strong>
						{formatPercentMetric(centerDeltaValue, true)}
						{" / "}
						{formatSignedRatio(centerDeltaRatio)}
					</strong>
				</div>
				{showCompoundedStepRate ? (
					<div className="analytics-pill">
						<span>{COMPOUNDED_STEP_LABELS[range]}</span>
						<strong>{formatPercentMetric(compoundedStepRate, true)}</strong>
					</div>
				) : null}
			</div>

			{loading ? (
				<div className="analytics-empty-state">正在加载收益率数据...</div>
			) : !hasData ? (
				<div className="analytics-empty-state">{emptyMessage}</div>
			) : (
				<div className="analytics-chart">
					<ResponsiveContainer width="100%" height={300}>
						<ComposedChart
							data={chartData}
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
								interval={compactAxisMode ? "preserveStartEnd" : 0}
								minTickGap={compactAxisMode ? 24 : 12}
								tickMargin={8}
								tickFormatter={(label: string) =>
									formatTimelineAxisLabel(label, compactAxisMode)}
							/>
							<YAxis
								stroke="#d6d4cb"
								tickLine={false}
								axisLine={false}
								width={yAxisWidth}
								domain={axisLayout.domain}
								tickCount={axisLayout.tickCount}
								tickFormatter={formatCompactPercentMetric}
							/>
							<ReferenceLine
								y={axisLayout.centerValue}
								stroke="rgba(0, 155, 193, 0.65)"
								strokeDasharray="5 5"
							/>
							<ReferenceLine y={0} stroke="rgba(214, 212, 203, 0.38)" strokeDasharray="4 4" />
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
										? "阈值交点"
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
												中位中线: {formatPercentMetric(axisLayout.centerValue)}
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
								type="monotone"
								dataKey="value"
								stroke={RETURN_LINE_COLOR}
								strokeWidth={2.4}
								dot={false}
								activeDot={{ r: 4, fill: RETURN_LINE_COLOR }}
							/>
						</ComposedChart>
					</ResponsiveContainer>
					<div className="return-trend-legend" role="list" aria-label="收益图例">
						<span className="return-trend-legend__item" role="listitem">
							<span
								className="return-trend-legend__swatch return-trend-legend__swatch--positive"
								aria-hidden="true"
							/>
							高于 0%
						</span>
						<span className="return-trend-legend__item" role="listitem">
							<span
								className="return-trend-legend__swatch return-trend-legend__swatch--negative"
								aria-hidden="true"
							/>
							低于 0%
						</span>
					</div>
				</div>
			)}
		</section>
	);
}
