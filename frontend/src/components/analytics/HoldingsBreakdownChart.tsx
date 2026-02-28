import {
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

import type { ValuedHolding } from "../../types/portfolioAnalytics";
import {
	ANALYTICS_TOOLTIP_STYLE,
	buildHoldingsBreakdown,
	formatCompactCny,
	formatCny,
	formatPercentage,
	getBarChartHeight,
	truncateLabel,
} from "../../utils/portfolioAnalytics";
import "./analytics.css";

type HoldingsBreakdownChartProps = {
	holdings: ValuedHolding[];
	title?: string;
	description?: string;
};

export function HoldingsBreakdownChart({
	holdings,
	title = "持仓拆解",
	description = "按市值展示前五大持仓，快速识别头寸集中在哪里。",
}: HoldingsBreakdownChartProps) {
	const breakdown = buildHoldingsBreakdown(holdings);
	const chartHeight = getBarChartHeight(breakdown.length);
	const visibleHoldingsCount = holdings.filter((holding) => holding.value_cny > 0).length;

	return (
		<section className="analytics-card">
			<div className="analytics-card__header">
				<div>
					<p className="analytics-card__eyebrow">HOLDINGS</p>
					<h2 className="analytics-card__title">{title}</h2>
					<p className="analytics-card__description">{description}</p>
				</div>
				<span className="analytics-bar-note">共 {visibleHoldingsCount} 个有效仓位</span>
			</div>

			{breakdown.length === 0 ? (
				<div className="analytics-empty-state">
					暂无证券持仓。录入股票、ETF 或基金后，这里会自动形成头寸排名。
				</div>
			) : (
				<>
					<div className="analytics-chart">
						<ResponsiveContainer width="100%" height={chartHeight}>
							<BarChart
								data={breakdown}
								layout="vertical"
								margin={{ top: 4, right: 12, left: 8, bottom: 0 }}
							>
								<CartesianGrid
									strokeDasharray="3 3"
									horizontal={false}
									stroke="rgba(255,255,255,0.08)"
								/>
								<XAxis
									type="number"
									stroke="#d6d4cb"
									tickLine={false}
									axisLine={false}
									tickFormatter={formatCompactCny}
								/>
								<YAxis
									type="category"
									dataKey="label"
									width={88}
									stroke="#d6d4cb"
									tickLine={false}
									axisLine={false}
									tickFormatter={(label: string) => truncateLabel(label, 8)}
								/>
								<Tooltip
									formatter={(value) => formatCny(Number(value ?? 0))}
									labelFormatter={(label) => `持仓: ${String(label ?? "")}`}
									contentStyle={ANALYTICS_TOOLTIP_STYLE}
								/>
								<Bar dataKey="value_cny" radius={[0, 12, 12, 0]}>
									{breakdown.map((item) => (
										<Cell
											key={`${item.label}-${item.value_cny}`}
											fill={item.color}
										/>
									))}
								</Bar>
							</BarChart>
						</ResponsiveContainer>
					</div>

					<div className="analytics-legend">
						{breakdown.map((item) => (
							<div className="analytics-legend__item" key={item.label}>
								<span
									className="analytics-legend__swatch"
									style={{ backgroundColor: item.color }}
								/>
								<div className="analytics-legend__label">
									<span>{item.label}</span>
									<small>{formatPercentage(item.percentage)}</small>
								</div>
								<div className="analytics-legend__value">{formatCny(item.value_cny)}</div>
							</div>
						))}
					</div>
				</>
			)}
		</section>
	);
}
