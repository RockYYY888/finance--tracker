import {
	Cell,
	Pie,
	PieChart,
	ResponsiveContainer,
	Tooltip,
} from "recharts";

import type { AllocationSlice } from "../../types/portfolioAnalytics";
import {
	ANALYTICS_TOOLTIP_ITEM_STYLE,
	ANALYTICS_TOOLTIP_LABEL_STYLE,
	ANALYTICS_TOOLTIP_STYLE,
	buildAllocationLegend,
	formatCny,
	formatPercentage,
} from "../../utils/portfolioAnalytics";
import "./analytics.css";

type AllocationChartProps = {
	total_value_cny: number;
	allocation: AllocationSlice[];
	title?: string;
	description?: string;
};

export function AllocationChart({
	total_value_cny,
	allocation,
	title = "资产分布",
	description = "现金与证券占比",
}: AllocationChartProps) {
	const legendItems = buildAllocationLegend(allocation, total_value_cny);

	return (
		<section className="analytics-card">
			<div>
				<p className="analytics-card__eyebrow">ALLOCATION</p>
				<h2 className="analytics-card__title">{title}</h2>
				<p className="analytics-card__description">{description}</p>
			</div>

			{legendItems.length === 0 ? (
				<div className="analytics-empty-state">录入资产后，这里会显示现金与证券的占比。</div>
			) : (
				<div className="analytics-donut">
					<div className="analytics-chart">
						<ResponsiveContainer width="100%" height={260}>
							<PieChart>
								<Pie
									data={legendItems}
									dataKey="value_cny"
									nameKey="label"
									innerRadius={72}
									outerRadius={102}
									paddingAngle={4}
								>
									{legendItems.map((item) => (
										<Cell
											key={`${item.label}-${item.value_cny}`}
											fill={item.color}
										/>
									))}
								</Pie>
								<Tooltip
									formatter={(value) => formatCny(Number(value ?? 0))}
									contentStyle={ANALYTICS_TOOLTIP_STYLE}
									itemStyle={ANALYTICS_TOOLTIP_ITEM_STYLE}
									labelStyle={ANALYTICS_TOOLTIP_LABEL_STYLE}
								/>
							</PieChart>
						</ResponsiveContainer>
					</div>

					<div className="analytics-donut__summary">
						<span>当前总资产</span>
						<strong>{formatCny(total_value_cny)}</strong>
					</div>

					<div className="analytics-legend">
						{legendItems.map((item) => (
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
				</div>
			)}
		</section>
	);
}
