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

export function getCashAccountTypeLabel(value: CashAccountType): string {
	return CASH_ACCOUNT_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? "其他";
}

export type SecurityMarket = "CN" | "HK" | "US" | "FUND" | "CRYPTO" | "OTHER";

export const SECURITY_MARKET_OPTIONS: Array<{
	value: SecurityMarket;
	label: string;
}> = [
	{ value: "CN", label: "A 股 / 内地" },
	{ value: "HK", label: "港股" },
	{ value: "US", label: "美股" },
	{ value: "FUND", label: "基金" },
	{ value: "CRYPTO", label: "加密货币" },
	{ value: "OTHER", label: "其他" },
];

export type FixedAssetCategory =
	| "REAL_ESTATE"
	| "VEHICLE"
	| "PRECIOUS_METAL"
	| "COLLECTIBLE"
	| "SOCIAL_SECURITY"
	| "OTHER";

export const FIXED_ASSET_CATEGORY_OPTIONS: Array<{
	value: FixedAssetCategory;
	label: string;
}> = [
	{ value: "REAL_ESTATE", label: "不动产" },
	{ value: "VEHICLE", label: "车辆" },
	{ value: "PRECIOUS_METAL", label: "贵金属" },
	{ value: "COLLECTIBLE", label: "收藏品" },
	{ value: "SOCIAL_SECURITY", label: "社会保障" },
	{ value: "OTHER", label: "其他" },
];

export function getFixedAssetCategoryLabel(value: FixedAssetCategory): string {
	return FIXED_ASSET_CATEGORY_OPTIONS.find((option) => option.value === value)?.label ?? "其他";
}

export type LiabilityCategory =
	| "MORTGAGE"
	| "AUTO_LOAN"
	| "CREDIT_CARD"
	| "PERSONAL_LOAN"
	| "OTHER";

export const LIABILITY_CATEGORY_OPTIONS: Array<{
	value: LiabilityCategory;
	label: string;
}> = [
	{ value: "MORTGAGE", label: "房贷" },
	{ value: "AUTO_LOAN", label: "车贷" },
	{ value: "CREDIT_CARD", label: "信用卡" },
	{ value: "PERSONAL_LOAN", label: "个人借款" },
	{ value: "OTHER", label: "其他" },
];

export function getLiabilityCategoryLabel(value: LiabilityCategory): string {
	return LIABILITY_CATEGORY_OPTIONS.find((option) => option.value === value)?.label ?? "其他";
}

export type OtherAssetCategory = "RECEIVABLE" | "OTHER";

export const OTHER_ASSET_CATEGORY_OPTIONS: Array<{
	value: OtherAssetCategory;
	label: string;
}> = [
	{ value: "RECEIVABLE", label: "应收款项" },
	{ value: "OTHER", label: "其他" },
];

export function getOtherAssetCategoryLabel(value: OtherAssetCategory): string {
	return OTHER_ASSET_CATEGORY_OPTIONS.find((option) => option.value === value)?.label ?? "其他";
}

export interface CashAccountInput {
	name: string;
	platform: string;
	currency: string;
	balance: number;
	account_type: CashAccountType;
	started_on?: string;
	note?: string;
}

export interface CashAccountFormDraft {
	name: string;
	currency: string;
	balance: string;
	account_type: CashAccountType;
	started_on: string;
	note: string;
}

export interface CashAccountRecord extends CashAccountInput {
	id: number;
	fx_to_cny?: number | null;
	value_cny?: number | null;
}

export const DEFAULT_CASH_ACCOUNT_FORM_DRAFT: CashAccountFormDraft = {
	name: "",
	currency: "CNY",
	balance: "",
	account_type: "ALIPAY",
	started_on: "",
	note: "",
};

export interface HoldingInput {
	symbol: string;
	name: string;
	quantity: number;
	fallback_currency: string;
	cost_basis_price?: number;
	market: SecurityMarket;
	broker?: string;
	started_on?: string;
	note?: string;
}

export interface HoldingFormDraft {
	symbol: string;
	name: string;
	quantity: string;
	fallback_currency: string;
	cost_basis_price: string;
	market: SecurityMarket;
	broker: string;
	started_on: string;
	note: string;
}

export interface HoldingRecord extends HoldingInput {
	id: number;
	price?: number | null;
	price_currency?: string | null;
	value_cny?: number | null;
	return_pct?: number | null;
	last_updated?: string | null;
}

export interface FixedAssetInput {
	name: string;
	category: FixedAssetCategory;
	current_value_cny: number;
	purchase_value_cny?: number;
	started_on?: string;
	note?: string;
}

export interface FixedAssetFormDraft {
	name: string;
	category: FixedAssetCategory;
	current_value_cny: string;
	purchase_value_cny: string;
	started_on: string;
	note: string;
}

export interface FixedAssetRecord extends FixedAssetInput {
	id: number;
	value_cny: number;
	return_pct?: number | null;
}

export const DEFAULT_FIXED_ASSET_FORM_DRAFT: FixedAssetFormDraft = {
	name: "",
	category: "REAL_ESTATE",
	current_value_cny: "",
	purchase_value_cny: "",
	started_on: "",
	note: "",
};

export interface LiabilityInput {
	name: string;
	category: LiabilityCategory;
	currency: string;
	balance: number;
	started_on?: string;
	note?: string;
}

export interface LiabilityFormDraft {
	name: string;
	category: LiabilityCategory;
	currency: string;
	balance: string;
	started_on: string;
	note: string;
}

export interface LiabilityRecord extends LiabilityInput {
	id: number;
	fx_to_cny?: number | null;
	value_cny?: number | null;
}

export const DEFAULT_LIABILITY_FORM_DRAFT: LiabilityFormDraft = {
	name: "",
	category: "MORTGAGE",
	currency: "CNY",
	balance: "",
	started_on: "",
	note: "",
};

export interface OtherAssetInput {
	name: string;
	category: OtherAssetCategory;
	current_value_cny: number;
	original_value_cny?: number;
	started_on?: string;
	note?: string;
}

export interface OtherAssetFormDraft {
	name: string;
	category: OtherAssetCategory;
	current_value_cny: string;
	original_value_cny: string;
	started_on: string;
	note: string;
}

export interface OtherAssetRecord extends OtherAssetInput {
	id: number;
	value_cny: number;
	return_pct?: number | null;
}

export const DEFAULT_OTHER_ASSET_FORM_DRAFT: OtherAssetFormDraft = {
	name: "",
	category: "RECEIVABLE",
	current_value_cny: "",
	original_value_cny: "",
	started_on: "",
	note: "",
};

export interface SecuritySearchResult {
	symbol: string;
	name: string;
	market: SecurityMarket;
	currency: string;
	exchange?: string | null;
	source?: string | null;
}

export const DEFAULT_HOLDING_FORM_DRAFT: HoldingFormDraft = {
	symbol: "",
	name: "",
	quantity: "1",
	fallback_currency: "HKD",
	cost_basis_price: "",
	market: "HK",
	broker: "",
	started_on: "",
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
	fixedAssets?: AssetCollectionActions<FixedAssetInput, FixedAssetRecord>;
	liabilities?: AssetCollectionActions<LiabilityInput, LiabilityRecord>;
	otherAssets?: AssetCollectionActions<OtherAssetInput, OtherAssetRecord>;
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
	listFixedAssets: () => Promise<FixedAssetRecord[]>;
	createFixedAsset: (payload: FixedAssetInput) => Promise<FixedAssetRecord>;
	updateFixedAsset: (recordId: number, payload: FixedAssetInput) => Promise<FixedAssetRecord>;
	deleteFixedAsset: (recordId: number) => Promise<void>;
	listLiabilities: () => Promise<LiabilityRecord[]>;
	createLiability: (payload: LiabilityInput) => Promise<LiabilityRecord>;
	updateLiability: (recordId: number, payload: LiabilityInput) => Promise<LiabilityRecord>;
	deleteLiability: (recordId: number) => Promise<void>;
	listOtherAssets: () => Promise<OtherAssetRecord[]>;
	createOtherAsset: (payload: OtherAssetInput) => Promise<OtherAssetRecord>;
	updateOtherAsset: (recordId: number, payload: OtherAssetInput) => Promise<OtherAssetRecord>;
	deleteOtherAsset: (recordId: number) => Promise<void>;
	searchSecurities: (query: string) => Promise<SecuritySearchResult[]>;
}
