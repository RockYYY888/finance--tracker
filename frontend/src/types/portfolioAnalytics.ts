export type ValuedCashAccount = {
	id: number;
	name: string;
	platform: string;
	balance: number;
	currency: string;
	fx_to_cny: number;
	value_cny: number;
};

export type ValuedHolding = {
	id: number;
	symbol: string;
	name: string;
	quantity: number;
	price: number;
	price_currency: string;
	fx_to_cny: number;
	value_cny: number;
	last_updated: string | null;
};

export type TimelinePoint = {
	label: string;
	value: number;
};

export type AllocationSlice = {
	label: string;
	value: number;
};

export type TimelineRange = "day" | "month" | "year";

export type PortfolioAnalyticsData = {
	total_value_cny: number;
	cash_accounts: ValuedCashAccount[];
	holdings: ValuedHolding[];
	allocation: AllocationSlice[];
	day_series: TimelinePoint[];
	month_series: TimelinePoint[];
	year_series: TimelinePoint[];
};

export type ChartLegendItem = {
	label: string;
	value_cny: number;
	percentage: number;
	color: string;
};

export type BreakdownChartItem = {
	label: string;
	value_cny: number;
	percentage: number;
	color: string;
};

export type PortfolioInsightSummary = {
	cashRatio: number;
	topHolding: ValuedHolding | null;
	topHoldingRatio: number;
	topThreeRatio: number;
	holdingsCount: number;
	cashAccountCount: number;
	platformCount: number;
};
