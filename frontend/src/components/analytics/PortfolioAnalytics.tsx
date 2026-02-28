import type {
	PortfolioAnalyticsData,
	TimelineRange,
} from "../../types/portfolioAnalytics";
import { AllocationChart } from "./AllocationChart";
import { HoldingsBreakdownChart } from "./HoldingsBreakdownChart";
import { PlatformBreakdownChart } from "./PlatformBreakdownChart";
import { PortfolioInsights } from "./PortfolioInsights";
import { PortfolioTrendChart } from "./PortfolioTrendChart";
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
