import { useMemo, useState } from "react";
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
	formatCompactCny,
	formatCny,
	formatPercentage,
	getTimelineSeries,
	summarizeTimeline,
} from "../../utils/portfolioAnalytics";
import "./analytics.css";

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

function formatSignedRatio(ratio: number): string {
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
	const series = getTimelineSeries(range, hour_series, day_series, month_series, year_series);
	const summary = summarizeTimeline(series);
	const axisLayout = useMemo(
		() =>
			calculateDynamicAxisLayout(series, {
				minSpan: Math.max(Math.abs(summary.latestValue) * 0.02, 100),
			}),
		[series, summary.latestValue],
	);
	const chartData = buildPortfolioTrendChartData(series, axisLayout.centerValue);
	const hasData = chartData.length > 0;
	const changeDirection = summary.changeValue >= 0 ? "增加" : "减少";
	const centerDeltaValue = summary.latestValue - axisLayout.centerValue;
	const centerRatioDenominator = Math.max(
		Math.abs(axisLayout.centerValue),
		Math.abs(axisLayout.maxValue - axisLayout.minValue),
		1,
	);
	const centerDeltaRatio = centerDeltaValue / centerRatioDenominator;

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
					<span>最新净值</span>
					<strong>{formatCny(summary.latestValue)}</strong>
				</div>
				<div className="analytics-pill">
					<span>{summary.latestLabel ?? "最新周期"}</span>
					<strong>
						{changeDirection}
						{formatCny(Math.abs(summary.changeValue))}
						{" / "}
						{formatSignedRatio(summary.changeRatio)}
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
				<div className="analytics-chart">
					<ResponsiveContainer width="100%" height={320}>
						<ComposedChart
							data={chartData}
							margin={{ top: 12, right: 12, left: 0, bottom: 0 }}
						>
							<CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
							<XAxis dataKey="label" stroke="#d6d4cb" tickLine={false} axisLine={false} />
							<YAxis
								stroke="#d6d4cb"
								tickLine={false}
								axisLine={false}
								width={52}
								domain={axisLayout.domain}
								tickFormatter={formatCompactCny}
							/>
							<ReferenceLine
								y={axisLayout.centerValue}
								stroke="rgba(0, 155, 193, 0.65)"
								strokeDasharray="5 5"
							/>
							<Tooltip
								formatter={(value) => [
									formatCny(Number(value ?? 0)),
									"资产总额",
								]}
								labelFormatter={(label) => `周期: ${String(label ?? "")}`}
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
