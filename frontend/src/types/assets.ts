export type MaybePromise<T> = T | Promise<T>;

export type AssetEditorMode = "create" | "edit";

export interface CashAccountInput {
	name: string;
	platform: string;
	currency: string;
	balance: number;
}

export interface CashAccountFormDraft {
	name: string;
	platform: string;
	currency: string;
	balance: string;
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
};

export interface HoldingInput {
	symbol: string;
	name: string;
	quantity: number;
	fallback_currency: string;
}

export interface HoldingFormDraft {
	symbol: string;
	name: string;
	quantity: string;
	fallback_currency: string;
}

export interface HoldingRecord extends HoldingInput {
	id: number;
	price?: number | null;
	price_currency?: string | null;
	value_cny?: number | null;
	last_updated?: string | null;
}

export const DEFAULT_HOLDING_FORM_DRAFT: HoldingFormDraft = {
	symbol: "",
	name: "",
	quantity: "",
	fallback_currency: "HKD",
};

export type CreateAssetAction<TInput, TRecord> = (payload: TInput) => MaybePromise<TRecord>;

export type EditAssetAction<TInput, TRecord> = (
	recordId: number,
	payload: TInput,
) => MaybePromise<TRecord>;

export type DeleteAssetAction = (recordId: number) => MaybePromise<void>;

export type RefreshAssetAction<TRecord> = () => MaybePromise<TRecord[]>;

export interface AssetCollectionActions<TInput, TRecord> {
	onCreate?: CreateAssetAction<TInput, TRecord>;
	onEdit?: EditAssetAction<TInput, TRecord>;
	onDelete?: DeleteAssetAction;
	onRefresh?: RefreshAssetAction<TRecord>;
}

export interface AssetManagerController {
	cashAccounts?: AssetCollectionActions<CashAccountInput, CashAccountRecord>;
	holdings?: AssetCollectionActions<HoldingInput, HoldingRecord>;
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
}
