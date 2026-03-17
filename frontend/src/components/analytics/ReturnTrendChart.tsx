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
	HoldingReturnSeries,
	TimelinePoint,
	TimelineRange,
} from "../../types/portfolioAnalytics";
import {
	ANALYTICS_TOOLTIP_ITEM_STYLE,
	ANALYTICS_TOOLTIP_LABEL_STYLE,
	ANALYTICS_TOOLTIP_STYLE,
	buildDisplayTimelineSeriesByRange,
	calculateTimelineReferenceAxisLayout,
	formatTimelineAxisLabel,
	formatTimelineRangeLabel,
	getAdaptiveYAxisWidth,
	getFirstRenderableTimelineRange,
	getTimelineChartTicks,
	formatCompactPercentMetric,
	formatPercentMetric,
	isSyntheticTimelinePoint,
	summarizeAverageStepDelta,
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
	day: "7天",
	month: "30天",
	year: "年",
};

const STEP_DELTA_LABELS: Record<TimelineRange, string> = {
	hour: "小时均变动",
	day: "日均变动",
	month: "日均变动",
	year: "月均变动",
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

export function buildReturnTrendAreaData(
	series: TimelinePoint[],
	thresholdValue = 0,
): ReturnTrendChartPoint[] {
	return buildThresholdSegmentedAreaData(series, thresholdValue);
}

type TooltipPayloadEntry = {
	dataKey?: string;
	value?: number;
	payload?: { value?: number };
};

function findPointIndex(
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

function isInteractiveTrendPoint(
	point: ReturnTrendChartPoint | null | undefined,
): boolean {
	return !isThresholdSegmentedCrossingPoint(point) && !isSyntheticTimelinePoint(point);
}

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
	const lastAutoResolvedSeriesKeyRef = useRef<string | null>(null);

	const selectedOption = useMemo(() => {
		if (seriesOptions.length === 0) {
			return null;
		}

		return seriesOptions.find((option) => option.key === selectedKey) ?? seriesOptions[0];
	}, [selectedKey, seriesOptions]);

	useEffect(() => {
		if (seriesOptions.length === 0) {
			setSelectedKey("");
			return;
		}
		if (seriesOptions.some((option) => option.key === selectedKey)) {
			return;
		}
		setSelectedKey(seriesOptions[0]?.key ?? "");
	}, [selectedKey, seriesOptions]);

	const seriesByRange = useMemo(
		() =>
			selectedOption
				? buildDisplayTimelineSeriesByRange(
					selectedOption.hour_series,
					selectedOption.day_series,
					selectedOption.month_series,
					selectedOption.year_series,
				)
				: {
					hour: [],
					day: [],
					month: [],
					year: [],
				},
		[selectedOption],
	);
	const fallbackRange = useMemo(
		() => getFirstRenderableTimelineRange(seriesByRange),
		[seriesByRange],
	);
	const activeRange = range;
	const series = seriesByRange[activeRange];
	const rangeSummary = summarizeTimeline(series);
	const rangeStepDelta = summarizeAverageStepDelta(series);
	const axisLayout = useMemo(
		() =>
			calculateTimelineReferenceAxisLayout(series, {
				referenceMode: "zero",
				minSpan: 0.3,
			}),
		[series],
	);
	const chartData = buildReturnTrendChartData(series, ZERO_RETURN_THRESHOLD);
	const areaData = buildReturnTrendAreaData(series, ZERO_RETURN_THRESHOLD);
	const { chartContainerRef, chartWidth, compactAxisMode } = useResponsiveChartFrame();
	const { chartInteractionHandlers } = useChartInteractionLock();
	const activePoint = activePointIndex === null ? null : chartData[activePointIndex] ?? null;
	const selectedPoint = isInteractiveTrendPoint(activePoint) ? activePoint : null;
	const selectedSeriesIndex = findPointIndex(series, selectedPoint);
	const visibleSeries =
		selectedSeriesIndex === null ? series : series.slice(0, selectedSeriesIndex + 1);
	const hasData = series.length >= 2;
	const visibleSummary =
		selectedSeriesIndex === null ? rangeSummary : summarizeTimeline(visibleSeries);
	const periodLabel = formatTimelineRangeLabel(
		series[0],
		visibleSeries[visibleSeries.length - 1] ?? series[series.length - 1],
		"最新周期",
	);
	const visibleCompoundedStepRate =
		selectedSeriesIndex === null
			? rangeStepDelta
			: summarizeAverageStepDelta(visibleSeries);
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
	const chartDataKey = `${selectedOption?.key ?? "none"}:${activeRange}:${chartData.length}:${chartData[0]?.label ?? ""}:${chartData[chartData.length - 1]?.label ?? ""}`;
	const resolvedEmptyMessage =
		emptyMessage.trim().length > 0
			? `${emptyMessage} 当前所选周期的数据会在累计后补齐。`
			: "当前所选周期的收益率数据还在累计中。";

	useEffect(() => {
		if (lastAutoResolvedSeriesKeyRef.current === (selectedOption?.key ?? null)) {
			return;
		}
		lastAutoResolvedSeriesKeyRef.current = selectedOption?.key ?? null;

		if (fallbackRange !== null && seriesByRange[range].length < 2) {
			setRange(fallbackRange);
		}
	}, [fallbackRange, range, selectedOption?.key, seriesByRange]);

	useEffect(() => {
		setActivePointIndex(null);
	}, [chartDataKey]);

	function renderActiveDot(props: {
		cx?: number;
		cy?: number;
		fill?: string;
		payload?: ReturnTrendChartPoint;
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
				fill={props.fill ?? RETURN_LINE_COLOR}
				stroke={props.stroke ?? "none"}
			/>
		);
	}

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
							className={activeRange === item ? "active" : ""}
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
					<span>{selectedPoint ? "所选收益率" : "当前收益率"}</span>
					<strong>{formatPercentMetric(visibleSummary.latestValue)}</strong>
				</div>
				<div className="analytics-pill">
					<span>{periodLabel}</span>
					<strong>{formatPercentMetric(visibleSummary.changeValue, true)}</strong>
				</div>
				{showCompoundedStepRate ? (
					<div className="analytics-pill">
						<span>
							{selectedPoint
								? `至该点${STEP_DELTA_LABELS[activeRange]}`
								: STEP_DELTA_LABELS[activeRange]}
						</span>
						<strong>{formatPercentMetric(visibleCompoundedStepRate, true)}</strong>
					</div>
				) : null}
			</div>

			{loading ? (
				<div className="analytics-empty-state">正在加载收益率数据...</div>
			) : !hasData ? (
				<div className="analytics-empty-state">{resolvedEmptyMessage}</div>
			) : (
				<div
					className="analytics-chart analytics-chart--interactive"
					ref={chartContainerRef}
					{...chartInteractionHandlers}
				>
					<ResponsiveContainer width="100%" height={300}>
						<ComposedChart
							data={chartData}
							onMouseMove={({ activeTooltipIndex, isTooltipActive }) => {
								if (!isTooltipActive || typeof activeTooltipIndex !== "number") {
									setActivePointIndex(null);
									return;
								}

								if (
									!isInteractiveTrendPoint(chartData[activeTooltipIndex])
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
									if (!isInteractiveTrendPoint(sourcePoint)) {
										return null;
									}
									const periodLabel = String(label ?? "");

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
								data={areaData}
								dataKey="positiveValue"
								stroke={POSITIVE_RETURN_COLOR}
								fill={POSITIVE_RETURN_FILL}
								strokeWidth={1.2}
								baseValue={ZERO_RETURN_THRESHOLD}
								connectNulls
							/>
							<Area
								type="linear"
								data={areaData}
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
								activeDot={renderActiveDot}
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
