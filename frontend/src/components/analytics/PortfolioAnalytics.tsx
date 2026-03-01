import type {
	PortfolioAnalyticsData,
	TimelineRange,
} from "../../types/portfolioAnalytics";
import { AllocationChart } from "./AllocationChart";
import { HoldingsBreakdownChart } from "./HoldingsBreakdownChart";
import { PlatformBreakdownChart } from "./PlatformBreakdownChart";
import { PortfolioInsights } from "./PortfolioInsights";
import { PortfolioTrendChart } from "./PortfolioTrendChart";
import {
	createAggregateReturnOption,
	createHoldingReturnOptions,
	ReturnTrendChart,
} from "./ReturnTrendChart";
import "./analytics.css";

export type PortfolioAnalyticsProps = PortfolioAnalyticsData & {
	loading?: boolean;
	defaultRange?: TimelineRange;
	className?: string;
};

export function PortfolioAnalytics({
	total_value_cny,
	cash_accounts,
	holdings,
	allocation,
	hour_series,
	day_series,
	month_series,
	year_series,
	holdings_return_hour_series,
	holdings_return_day_series,
	holdings_return_month_series,
	holdings_return_year_series,
	holding_return_series,
	loading = false,
	defaultRange = "hour",
	className,
}: PortfolioAnalyticsProps) {
	const wrapperClassName = className
		? `portfolio-analytics ${className}`
		: "portfolio-analytics";

	return (
		<section className={wrapperClassName}>
			<PortfolioInsights
				total_value_cny={total_value_cny}
				cash_accounts={cash_accounts}
				holdings={holdings}
			/>

				<div className="portfolio-analytics__main">
				<PortfolioTrendChart
					hour_series={hour_series}
					day_series={day_series}
					month_series={month_series}
					year_series={year_series}
					loading={loading}
					defaultRange={defaultRange}
				/>
					<AllocationChart
						total_value_cny={total_value_cny}
						allocation={allocation}
					/>
				</div>

				<div className="portfolio-analytics__returns">
					<ReturnTrendChart
						title="非现金资产收益率"
						description="按当前有成本价的持仓汇总收益率。"
						seriesOptions={[
							createAggregateReturnOption(
								"非现金资产",
								holdings_return_hour_series,
								holdings_return_day_series,
								holdings_return_month_series,
								holdings_return_year_series,
							),
						]}
						loading={loading}
						defaultRange={defaultRange}
						selectorLabel="范围"
						emptyMessage="暂无整体收益率数据。"
					/>
					<ReturnTrendChart
						title="单只持仓收益率"
						description="查看任一持仓在不同周期的收益率变化。"
						seriesOptions={createHoldingReturnOptions(holding_return_series)}
						loading={loading}
						defaultRange={defaultRange}
						selectorLabel="持仓"
						emptyMessage="暂无单只持仓收益率数据。"
					/>
				</div>

				<div className="portfolio-analytics__secondary">
				<HoldingsBreakdownChart holdings={holdings} />
				<PlatformBreakdownChart
					cash_accounts={cash_accounts}
					holdings={holdings}
				/>
			</div>
		</section>
	);
}
