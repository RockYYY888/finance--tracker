import { useState } from "react";
import {
	CartesianGrid,
	Line,
	LineChart,
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
	const hasData = series.some((point) => point.value > 0);
	const changeDirection = summary.changeValue >= 0 ? "增加" : "减少";

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
					</strong>
				</div>
				<div className="analytics-pill">
					<span>环比幅度</span>
					<strong>{formatPercentage(summary.changeRatio)}</strong>
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
						<LineChart data={series} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
							<CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
							<XAxis dataKey="label" stroke="#d6d4cb" tickLine={false} axisLine={false} />
							<YAxis
								stroke="#d6d4cb"
								tickLine={false}
								axisLine={false}
								width={52}
								tickFormatter={formatCompactCny}
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
							<Line
								type="monotone"
								dataKey="value"
								stroke="#ef476f"
								strokeWidth={3}
								dot={{ r: 3, strokeWidth: 0, fill: "#ffd166" }}
								activeDot={{ r: 5, fill: "#ffd166" }}
							/>
						</LineChart>
					</ResponsiveContainer>
				</div>
			)}
		</section>
	);
}
