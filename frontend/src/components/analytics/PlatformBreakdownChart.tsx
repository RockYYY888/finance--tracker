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

import type {
	ValuedCashAccount,
	ValuedHolding,
} from "../../types/portfolioAnalytics";
import {
	ANALYTICS_TOOLTIP_STYLE,
	buildPlatformBreakdown,
	formatCompactCny,
	formatCny,
	formatPercentage,
	getBarChartHeight,
	truncateLabel,
} from "../../utils/portfolioAnalytics";
import "./analytics.css";

type PlatformBreakdownChartProps = {
	cash_accounts: ValuedCashAccount[];
	holdings: ValuedHolding[];
	title?: string;
	description?: string;
};

export function PlatformBreakdownChart({
	cash_accounts,
	holdings,
	title = "平台分布",
	description = "按平台汇总市值",
}: PlatformBreakdownChartProps) {
	const platformBreakdown = buildPlatformBreakdown(cash_accounts, holdings);
	const chartHeight = getBarChartHeight(platformBreakdown.length);

	return (
		<section className="analytics-card">
			<div className="analytics-card__header">
				<div>
					<p className="analytics-card__eyebrow">PLATFORMS</p>
					<h2 className="analytics-card__title">{title}</h2>
					<p className="analytics-card__description">{description}</p>
				</div>
				<span className="analytics-bar-note">覆盖 {platformBreakdown.length} 个入口</span>
			</div>

			{platformBreakdown.length === 0 ? (
				<div className="analytics-empty-state">
					暂无可展示的平台分布。先录入现金账户或证券持仓即可生成。
				</div>
			) : (
				<>
					<div className="analytics-chart">
						<ResponsiveContainer width="100%" height={chartHeight}>
							<BarChart
								data={platformBreakdown}
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
									labelFormatter={(label) => `入口: ${String(label ?? "")}`}
									contentStyle={ANALYTICS_TOOLTIP_STYLE}
								/>
								<Bar dataKey="value_cny" radius={[0, 12, 12, 0]}>
									{platformBreakdown.map((item) => (
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
						{platformBreakdown.map((item) => (
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
