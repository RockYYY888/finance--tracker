import type { PortfolioAnalyticsData } from "./portfolioAnalytics";

export type DashboardResponse = PortfolioAnalyticsData & {
	server_today: string;
	cash_value_cny: number;
	holdings_value_cny: number;
	fixed_assets_value_cny: number;
	liabilities_value_cny: number;
	other_assets_value_cny: number;
	usd_cny_rate: number | null;
	hkd_cny_rate: number | null;
	warnings: string[];
};

export const EMPTY_DASHBOARD: DashboardResponse = {
	server_today: "",
	total_value_cny: 0,
	cash_value_cny: 0,
	holdings_value_cny: 0,
	fixed_assets_value_cny: 0,
	liabilities_value_cny: 0,
	other_assets_value_cny: 0,
	usd_cny_rate: null,
	hkd_cny_rate: null,
	cash_accounts: [],
	holdings: [],
	fixed_assets: [],
	liabilities: [],
	other_assets: [],
	allocation: [],
	hour_series: [],
	day_series: [],
	month_series: [],
	year_series: [],
	holdings_return_hour_series: [],
	holdings_return_day_series: [],
	holdings_return_month_series: [],
	holdings_return_year_series: [],
	holding_return_series: [],
	recent_holding_transactions: [],
	warnings: [],
};
