import type {
	CashAccountType,
	FixedAssetCategory,
	LiabilityCategory,
	OtherAssetCategory,
	SecurityMarket,
} from "./assets";

export type ValuedCashAccount = {
	id: number;
	name: string;
	platform: string;
	balance: number;
	currency: string;
	account_type: CashAccountType;
	note?: string | null;
	fx_to_cny: number;
	value_cny: number;
};

export type ValuedHolding = {
	id: number;
	symbol: string;
	name: string;
	quantity: number;
	fallback_currency: string;
	cost_basis_price?: number | null;
	market: SecurityMarket;
	broker?: string | null;
	note?: string | null;
	price: number;
	price_currency: string;
	fx_to_cny: number;
	value_cny: number;
	return_pct?: number | null;
	last_updated: string | null;
};

export type ValuedFixedAsset = {
	id: number;
	name: string;
	category: FixedAssetCategory;
	current_value_cny: number;
	purchase_value_cny?: number | null;
	note?: string | null;
	value_cny: number;
	return_pct?: number | null;
};

export type ValuedLiability = {
	id: number;
	name: string;
	category: LiabilityCategory;
	currency: string;
	balance: number;
	note?: string | null;
	fx_to_cny: number;
	value_cny: number;
};

export type ValuedOtherAsset = {
	id: number;
	name: string;
	category: OtherAssetCategory;
	current_value_cny: number;
	original_value_cny?: number | null;
	note?: string | null;
	value_cny: number;
	return_pct?: number | null;
};

export type TimelinePoint = {
	label: string;
	value: number;
};

export type HoldingReturnSeries = {
	symbol: string;
	name: string;
	hour_series: TimelinePoint[];
	day_series: TimelinePoint[];
	month_series: TimelinePoint[];
	year_series: TimelinePoint[];
};

export type AllocationSlice = {
	label: string;
	value: number;
};

export type TimelineRange = "hour" | "day" | "month" | "year";

export type PortfolioAnalyticsData = {
	total_value_cny: number;
	cash_accounts: ValuedCashAccount[];
	holdings: ValuedHolding[];
	fixed_assets: ValuedFixedAsset[];
	liabilities: ValuedLiability[];
	other_assets: ValuedOtherAsset[];
	allocation: AllocationSlice[];
	hour_series: TimelinePoint[];
	day_series: TimelinePoint[];
	month_series: TimelinePoint[];
	year_series: TimelinePoint[];
	holdings_return_hour_series: TimelinePoint[];
	holdings_return_day_series: TimelinePoint[];
	holdings_return_month_series: TimelinePoint[];
	holdings_return_year_series: TimelinePoint[];
	holding_return_series: HoldingReturnSeries[];
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
