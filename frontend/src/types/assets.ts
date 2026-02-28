export type MaybePromise<T> = T | Promise<T>;

export type AssetEditorMode = "create" | "edit";

export type CashAccountType = "ALIPAY" | "WECHAT" | "BANK" | "CASH" | "OTHER";

export const CASH_ACCOUNT_TYPE_OPTIONS: Array<{
	value: CashAccountType;
	label: string;
}> = [
	{ value: "ALIPAY", label: "支付宝" },
	{ value: "WECHAT", label: "微信" },
	{ value: "BANK", label: "银行卡" },
	{ value: "CASH", label: "现金" },
	{ value: "OTHER", label: "其他" },
];

export type SecurityMarket = "CN" | "HK" | "US" | "FUND" | "OTHER";

export const SECURITY_MARKET_OPTIONS: Array<{
	value: SecurityMarket;
	label: string;
}> = [
	{ value: "CN", label: "A 股 / 内地" },
	{ value: "HK", label: "港股" },
	{ value: "US", label: "美股" },
	{ value: "FUND", label: "基金" },
	{ value: "OTHER", label: "其他" },
];

export interface CashAccountInput {
	name: string;
	platform: string;
	currency: string;
	balance: number;
	account_type: CashAccountType;
	note?: string;
}

export interface CashAccountFormDraft {
	name: string;
	platform: string;
	currency: string;
	balance: string;
	account_type: CashAccountType;
	note: string;
}

export interface CashAccountRecord extends CashAccountInput {
	id: number;
	fx_to_cny?: number | null;
	value_cny?: number | null;
}

export const DEFAULT_CASH_ACCOUNT_FORM_DRAFT: CashAccountFormDraft = {
	name: "",
	platform: "支付宝",
	currency: "CNY",
	balance: "",
	account_type: "ALIPAY",
	note: "",
};

export interface HoldingInput {
	symbol: string;
	name: string;
	quantity: number;
	fallback_currency: string;
	market: SecurityMarket;
	broker?: string;
	note?: string;
}

export interface HoldingFormDraft {
	symbol: string;
	name: string;
	quantity: string;
	fallback_currency: string;
	market: SecurityMarket;
	broker: string;
	note: string;
}

export interface HoldingRecord extends HoldingInput {
	id: number;
	price?: number | null;
	price_currency?: string | null;
	value_cny?: number | null;
	last_updated?: string | null;
}

export interface SecuritySearchResult {
	symbol: string;
	name: string;
	market: SecurityMarket;
	currency: string;
	exchange?: string | null;
}

export const DEFAULT_HOLDING_FORM_DRAFT: HoldingFormDraft = {
	symbol: "",
	name: "",
	quantity: "",
	fallback_currency: "HKD",
	market: "HK",
	broker: "",
	note: "",
};

export type CreateAssetAction<TInput, TRecord> = (payload: TInput) => MaybePromise<TRecord>;

export type EditAssetAction<TInput, TRecord> = (
	recordId: number,
	payload: TInput,
) => MaybePromise<TRecord>;

export type DeleteAssetAction = (recordId: number) => MaybePromise<void>;

export type RefreshAssetAction<TRecord> = () => MaybePromise<TRecord[]>;
export type SearchSecurityAction = (
	query: string,
) => MaybePromise<SecuritySearchResult[]>;

export interface AssetCollectionActions<TInput, TRecord> {
	onCreate?: CreateAssetAction<TInput, TRecord>;
	onEdit?: EditAssetAction<TInput, TRecord>;
	onDelete?: DeleteAssetAction;
	onRefresh?: RefreshAssetAction<TRecord>;
}

export interface HoldingCollectionActions
	extends AssetCollectionActions<HoldingInput, HoldingRecord> {
	onSearch?: SearchSecurityAction;
}

export interface AssetManagerController {
	cashAccounts?: AssetCollectionActions<CashAccountInput, CashAccountRecord>;
	holdings?: HoldingCollectionActions;
}

export interface AssetApiClient {
	listCashAccounts: () => Promise<CashAccountRecord[]>;
	createCashAccount: (payload: CashAccountInput) => Promise<CashAccountRecord>;
	updateCashAccount: (recordId: number, payload: CashAccountInput) => Promise<CashAccountRecord>;
	deleteCashAccount: (recordId: number) => Promise<void>;
	listHoldings: () => Promise<HoldingRecord[]>;
	createHolding: (payload: HoldingInput) => Promise<HoldingRecord>;
	updateHolding: (recordId: number, payload: HoldingInput) => Promise<HoldingRecord>;
	deleteHolding: (recordId: number) => Promise<void>;
	searchSecurities: (query: string) => Promise<SecuritySearchResult[]>;
}
