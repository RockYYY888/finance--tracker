import { useEffect, useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import type {
	AllocationBreakdownGroup,
	AllocationSlice,
	ValuedCashAccount,
	ValuedFixedAsset,
	ValuedHolding,
	ValuedOtherAsset,
} from "../../types/portfolioAnalytics";
import {
	ANALYTICS_TOOLTIP_ITEM_STYLE,
	ANALYTICS_TOOLTIP_LABEL_STYLE,
	ANALYTICS_TOOLTIP_STYLE,
	buildAllocationBreakdownGroups,
	getAllocationDonutLayout,
	buildAllocationLegend,
	formatCny,
	formatPercentage,
} from "../../utils/portfolioAnalytics";
import "./analytics.css";
import { useChartInteractionLock } from "./useChartInteractionLock";
import { useResponsiveChartFrame } from "./useResponsiveChartFrame";

type AllocationChartProps = {
	total_value_cny: number;
	allocation: AllocationSlice[];
	cash_accounts?: ValuedCashAccount[];
	holdings?: ValuedHolding[];
	fixed_assets?: ValuedFixedAsset[];
	other_assets?: ValuedOtherAsset[];
	title?: string;
	description?: string;
};

type AllocationTooltipPayload = {
	payload?: {
		label?: string;
		value_cny?: number;
	};
};

function findBreakdownGroup(
	breakdownGroups: AllocationBreakdownGroup[],
	label: string | null,
): AllocationBreakdownGroup | null {
	if (!label) {
		return breakdownGroups[0] ?? null;
	}

	return breakdownGroups.find((group) => group.label === label) ?? breakdownGroups[0] ?? null;
}

export function AllocationChart({
	total_value_cny,
	allocation,
	cash_accounts = [],
	holdings = [],
	fixed_assets = [],
	other_assets = [],
	title = "正向资产分布",
	description = "按当前正向资产结构汇总，不包括负债。",
}: AllocationChartProps) {
	const legendItems = buildAllocationLegend(allocation, total_value_cny);
	const positiveAssetTotal = legendItems.reduce((sum, item) => sum + item.value_cny, 0);
	const { chartContainerRef, chartWidth } = useResponsiveChartFrame();
	const { chartInteractionHandlers } = useChartInteractionLock();
	const donutLayout = getAllocationDonutLayout(chartWidth);
	const breakdownGroups = useMemo(
		() =>
			buildAllocationBreakdownGroups(
				allocation,
				total_value_cny,
				cash_accounts,
				holdings,
				fixed_assets,
				other_assets,
			),
		[allocation, cash_accounts, fixed_assets, holdings, other_assets, total_value_cny],
	);
	const [activeLabel, setActiveLabel] = useState<string | null>(legendItems[0]?.label ?? null);
	const activeBreakdown = useMemo(
		() => findBreakdownGroup(breakdownGroups, activeLabel),
		[activeLabel, breakdownGroups],
	);

	useEffect(() => {
		setActiveLabel((currentLabel) => {
			if (legendItems.length === 0) {
				return null;
			}
			if (currentLabel && legendItems.some((item) => item.label === currentLabel)) {
				return currentLabel;
			}
			return legendItems[0]?.label ?? null;
		});
	}, [legendItems]);

	return (
		<section className="analytics-card">
			<div>
				<p className="analytics-card__eyebrow">ALLOCATION</p>
				<h2 className="analytics-card__title">{title}</h2>
				<p className="analytics-card__description">{description}</p>
			</div>

			{legendItems.length === 0 ? (
				<div className="analytics-empty-state">暂无资产分布数据。</div>
			) : (
				<div className="analytics-donut">
					<div
						className="analytics-chart analytics-chart--interactive"
						ref={chartContainerRef}
						{...chartInteractionHandlers}
					>
						<ResponsiveContainer width="100%" height={donutLayout.height}>
							<PieChart>
								<Pie
									data={legendItems}
									dataKey="value_cny"
									nameKey="label"
									innerRadius={donutLayout.innerRadius}
									outerRadius={donutLayout.outerRadius}
									paddingAngle={4}
									onMouseEnter={(_, index) => {
										const item = legendItems[index];
										if (item) {
											setActiveLabel(item.label);
										}
									}}
								>
									{legendItems.map((item) => (
										<Cell
											key={`${item.label}-${item.value_cny}`}
											fill={item.color}
										/>
									))}
								</Pie>
								<Tooltip
									content={({ active, payload }) => {
										if (!active || !payload || payload.length === 0) {
											return null;
										}

										const tooltipPayload = payload as AllocationTooltipPayload[];
										const tooltipLabel = tooltipPayload[0]?.payload?.label ?? null;
										const hoveredGroup = findBreakdownGroup(
											breakdownGroups,
											tooltipLabel,
										);
										if (!hoveredGroup) {
											return null;
										}

										return (
											<div style={ANALYTICS_TOOLTIP_STYLE}>
												<p style={ANALYTICS_TOOLTIP_LABEL_STYLE}>
													{hoveredGroup.label} · {formatPercentage(hoveredGroup.percentage)}
												</p>
												<p style={ANALYTICS_TOOLTIP_ITEM_STYLE}>
													大类金额: {formatCny(hoveredGroup.value_cny)}
												</p>
												{hoveredGroup.items.slice(0, 4).map((entry) => (
													<p
														key={`${hoveredGroup.label}-${entry.label}`}
														style={ANALYTICS_TOOLTIP_ITEM_STYLE}
													>
														{entry.label}: {formatPercentage(entry.category_percentage)}
													</p>
												))}
											</div>
										);
									}}
								/>
							</PieChart>
						</ResponsiveContainer>
					</div>

					<div className="analytics-donut__summary">
						<span>正向资产合计</span>
						<strong>{formatCny(positiveAssetTotal)}</strong>
					</div>

					<div className="analytics-legend">
						{legendItems.map((item) => (
							<button
								type="button"
								className={
									activeLabel === item.label
										? "analytics-legend__item analytics-legend__item--interactive analytics-legend__item--active"
										: "analytics-legend__item analytics-legend__item--interactive"
								}
								key={item.label}
								onMouseEnter={() => setActiveLabel(item.label)}
								onFocus={() => setActiveLabel(item.label)}
								onTouchStart={() => setActiveLabel(item.label)}
								onClick={() => setActiveLabel(item.label)}
							>
								<span
									className="analytics-legend__swatch"
									style={{ backgroundColor: item.color }}
								/>
								<div className="analytics-legend__label">
									<span>{item.label}</span>
									<small>{formatPercentage(item.percentage)}</small>
								</div>
								<div className="analytics-legend__value">{formatCny(item.value_cny)}</div>
							</button>
						))}
					</div>

					{activeBreakdown ? (
						<div className="analytics-breakdown">
							<div className="analytics-breakdown__header">
								<div>
									<strong>{activeBreakdown.label}</strong>
									<small>悬停或点按大类可切换对应明细</small>
								</div>
								<div className="analytics-breakdown__summary">
									<span>{formatPercentage(activeBreakdown.percentage)}</span>
									<strong>{formatCny(activeBreakdown.value_cny)}</strong>
								</div>
							</div>

							<div className="analytics-breakdown__items">
								{activeBreakdown.items.map((entry) => (
									<div
										className="analytics-breakdown__item"
										key={`${activeBreakdown.label}-${entry.label}`}
									>
										<div className="analytics-breakdown__label">
											<span
												className="analytics-legend__swatch"
												style={{ backgroundColor: entry.color }}
											/>
											<div>
												<strong>{entry.label}</strong>
												<small>
													占{activeBreakdown.label}{" "}
													{formatPercentage(entry.category_percentage)}
												</small>
											</div>
										</div>
										<div className="analytics-breakdown__value">
											<strong>{formatCny(entry.value_cny)}</strong>
											<small>占正向资产 {formatPercentage(entry.overall_percentage)}</small>
										</div>
									</div>
								))}
							</div>
						</div>
					) : null}
				</div>
			)}
		</section>
	);
}
