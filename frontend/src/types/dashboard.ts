import type { PortfolioAnalyticsData } from "./portfolioAnalytics";

export type DashboardResponse = PortfolioAnalyticsData & {
	cash_value_cny: number;
	holdings_value_cny: number;
	warnings: string[];
};

export const EMPTY_DASHBOARD: DashboardResponse = {
	total_value_cny: 0,
	cash_value_cny: 0,
	holdings_value_cny: 0,
	cash_accounts: [],
	holdings: [],
	allocation: [],
	hour_series: [],
	day_series: [],
	month_series: [],
	year_series: [],
	warnings: [],
};
