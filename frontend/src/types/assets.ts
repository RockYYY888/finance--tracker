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

export type SellProceedsHandling =
	| "DISCARD"
	| "ADD_TO_EXISTING_CASH"
	| "CREATE_NEW_CASH";
export type BuyFundingHandling = "DEDUCT_FROM_EXISTING_CASH";

export const SELL_PROCEEDS_HANDLING_OPTIONS: Array<{
	value: SellProceedsHandling;
	label: string;
}> = [
	{ value: "DISCARD", label: "不登记到现金账户" },
	{ value: "ADD_TO_EXISTING_CASH", label: "并入现有现金账户" },
	{ value: "CREATE_NEW_CASH", label: "自动新建现金账户" },
];

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

export type LiabilityCurrency = "CNY" | "USD";

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

export const LIABILITY_CURRENCY_OPTIONS: Array<{
	value: LiabilityCurrency;
	label: string;
}> = [
	{ value: "CNY", label: "人民币 (CNY)" },
	{ value: "USD", label: "美元 (USD)" },
];

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

export interface CashTransferInput {
	from_account_id: number;
	to_account_id: number;
	source_amount: number;
	target_amount?: number;
	transferred_on: string;
	note?: string;
}

export interface CashTransferFormDraft {
	from_account_id: string;
	to_account_id: string;
	source_amount: string;
	target_amount: string;
	transferred_on: string;
	note: string;
}

export interface CashTransferRecord extends CashTransferInput {
	id: number;
	target_amount: number;
	source_currency: string;
	target_currency: string;
}

export type CashLedgerEntryType =
	| "INITIAL_BALANCE"
	| "SELL_PROCEEDS"
	| "BUY_FUNDING"
	| "TRANSFER_OUT"
	| "TRANSFER_IN"
	| "MANUAL_ADJUSTMENT";

export interface CashLedgerAdjustmentInput {
	cash_account_id: number;
	amount: number;
	happened_on: string;
	note?: string;
}

export interface CashLedgerAdjustmentFormDraft {
	cash_account_id: string;
	amount: string;
	happened_on: string;
	note: string;
}

export interface CashLedgerEntryRecord {
	id: number;
	cash_account_id: number;
	entry_type: CashLedgerEntryType;
	amount: number;
	currency: string;
	happened_on: string;
	note?: string;
	holding_transaction_id?: number | null;
	cash_transfer_id?: number | null;
	created_at?: string;
	updated_at?: string;
}

export const DEFAULT_CASH_LEDGER_ADJUSTMENT_FORM_DRAFT: CashLedgerAdjustmentFormDraft = {
	cash_account_id: "",
	amount: "",
	happened_on: "",
	note: "",
};

export type AgentTaskType =
	| "CREATE_BUY_TRANSACTION"
	| "CREATE_SELL_TRANSACTION"
	| "UPDATE_HOLDING_TRANSACTION"
	| "CREATE_CASH_TRANSFER"
	| "UPDATE_CASH_TRANSFER"
	| "CREATE_CASH_LEDGER_ADJUSTMENT"
	| "UPDATE_CASH_LEDGER_ADJUSTMENT"
	| "DELETE_CASH_LEDGER_ADJUSTMENT";

export type AgentTaskStatus = "DONE" | "FAILED";

export interface AgentTaskRecord {
	id: number;
	task_type: AgentTaskType;
	status: AgentTaskStatus;
	payload: Record<string, unknown>;
	result?: Record<string, unknown> | null;
	error_message?: string | null;
	created_at?: string;
	updated_at?: string;
	completed_at?: string | null;
}

export interface AssetMutationAuditRecord {
	id: number;
	agent_task_id?: number | null;
	entity_type: string;
	entity_id?: number | null;
	operation: "CREATE" | "UPDATE" | "DELETE";
	before_state?: string | null;
	after_state?: string | null;
	reason?: string | null;
	created_at?: string;
}

export interface AgentAuditSnapshot {
	tasks: AgentTaskRecord[];
	audits: AssetMutationAuditRecord[];
}

export const DEFAULT_CASH_TRANSFER_FORM_DRAFT: CashTransferFormDraft = {
	from_account_id: "",
	to_account_id: "",
	source_amount: "",
	target_amount: "",
	transferred_on: "",
	note: "",
};

export const DEFAULT_CASH_ACCOUNT_FORM_DRAFT: CashAccountFormDraft = {
	name: "",
	currency: "CNY",
	balance: "",
	account_type: "ALIPAY",
	started_on: "",
	note: "",
};

export interface HoldingInput {
	side: "BUY" | "SELL";
	symbol: string;
	name: string;
	quantity: number;
	fallback_currency: string;
	cost_basis_price?: number;
	market: SecurityMarket;
	broker?: string;
	started_on?: string;
	note?: string;
	sell_proceeds_handling?: SellProceedsHandling;
	sell_proceeds_account_id?: number;
	buy_funding_handling?: BuyFundingHandling;
	buy_funding_account_id?: number;
}

export type HoldingEditorIntent = "buy" | "sell" | "edit";

export interface HoldingFormDraft {
	side: "BUY" | "SELL";
	symbol: string;
	name: string;
	quantity: string;
	fallback_currency: string;
	cost_basis_price: string;
	market: SecurityMarket | "";
	broker: string;
	started_on: string;
	note: string;
	sell_proceeds_handling: SellProceedsHandling;
	sell_proceeds_account_id: string;
	buy_funding_handling: BuyFundingHandling | "";
	buy_funding_account_id: string;
}

export interface HoldingRecord extends HoldingInput {
	id: number;
	price?: number | null;
	price_currency?: string | null;
	value_cny?: number | null;
	return_pct?: number | null;
	last_updated?: string | null;
}

export interface HoldingTransactionRecord {
	id: number;
	symbol: string;
	name: string;
	side: "BUY" | "SELL" | "ADJUST";
	quantity: number;
	price?: number | null;
	fallback_currency: string;
	market: SecurityMarket;
	broker?: string;
	traded_on: string;
	note?: string;
	sell_proceeds_handling?: SellProceedsHandling;
	sell_proceeds_account_id?: number;
	buy_funding_handling?: BuyFundingHandling;
	buy_funding_account_id?: number;
	created_at?: string;
	updated_at?: string;
}

export interface HoldingTransactionUpdateInput {
	quantity?: number;
	price?: number;
	fallback_currency?: string;
	broker?: string;
	traded_on?: string;
	note?: string;
	sell_proceeds_handling?: SellProceedsHandling;
	sell_proceeds_account_id?: number;
	buy_funding_handling?: BuyFundingHandling;
	buy_funding_account_id?: number;
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
	currency: LiabilityCurrency;
	balance: number;
	started_on?: string;
	note?: string;
}

export interface LiabilityFormDraft {
	name: string;
	category: LiabilityCategory;
	currency: LiabilityCurrency;
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
	side: "BUY",
	symbol: "",
	name: "",
	quantity: "",
	fallback_currency: "",
	cost_basis_price: "",
	market: "",
	broker: "",
	started_on: "",
	note: "",
	sell_proceeds_handling: "CREATE_NEW_CASH",
	sell_proceeds_account_id: "",
	buy_funding_handling: "",
	buy_funding_account_id: "",
};

export type CreateAssetAction<TInput, TRecord> = (
	payload: TInput,
) => MaybePromise<TRecord | null>;

export type EditAssetAction<TInput, TRecord> = (
	recordId: number,
	payload: TInput,
) => MaybePromise<TRecord>;

export type DeleteAssetAction = (recordId: number) => MaybePromise<void>;

export type RefreshAssetAction<TRecord> = () => MaybePromise<TRecord[]>;
export type SearchSecurityAction = (
	query: string,
) => MaybePromise<SecuritySearchResult[]>;
export interface HoldingMergeRequest {
	targetRecordId: number;
	sourceRecordId?: number | null;
	mergedPayload: HoldingInput;
}
export type MergeHoldingAction = (
	request: HoldingMergeRequest,
) => MaybePromise<HoldingRecord>;

export interface AssetCollectionActions<TInput, TRecord> {
	onCreate?: CreateAssetAction<TInput, TRecord>;
	onEdit?: EditAssetAction<TInput, TRecord>;
	onDelete?: DeleteAssetAction;
	onRefresh?: RefreshAssetAction<TRecord>;
}

export interface HoldingCollectionActions
	extends AssetCollectionActions<HoldingInput, HoldingRecord> {
	onSearch?: SearchSecurityAction;
	onMergeDuplicate?: MergeHoldingAction;
}

export interface HoldingTransactionCollectionActions {
	onEdit?: EditAssetAction<HoldingTransactionUpdateInput, HoldingTransactionRecord>;
	onDelete?: DeleteAssetAction;
	onRefresh?: RefreshAssetAction<HoldingTransactionRecord>;
}

export interface CashTransferCollectionActions {
	onCreate?: CreateAssetAction<CashTransferInput, CashTransferRecord>;
	onEdit?: EditAssetAction<CashTransferInput, CashTransferRecord>;
	onDelete?: DeleteAssetAction;
	onRefresh?: RefreshAssetAction<CashTransferRecord>;
}

export interface CashLedgerAdjustmentCollectionActions {
	onCreate?: CreateAssetAction<CashLedgerAdjustmentInput, CashLedgerEntryRecord>;
	onEdit?: EditAssetAction<CashLedgerAdjustmentInput, CashLedgerEntryRecord>;
	onDelete?: DeleteAssetAction;
	onRefresh?: RefreshAssetAction<CashLedgerEntryRecord>;
}

export interface AgentAuditCollectionActions {
	onRefresh?: () => MaybePromise<AgentAuditSnapshot>;
}

export interface AssetManagerController {
	cashAccounts?: AssetCollectionActions<CashAccountInput, CashAccountRecord>;
	cashTransfers?: CashTransferCollectionActions;
	cashLedgerAdjustments?: CashLedgerAdjustmentCollectionActions;
	agentAudit?: AgentAuditCollectionActions;
	holdings?: HoldingCollectionActions;
	holdingTransactions?: HoldingTransactionCollectionActions;
	fixedAssets?: AssetCollectionActions<FixedAssetInput, FixedAssetRecord>;
	liabilities?: AssetCollectionActions<LiabilityInput, LiabilityRecord>;
	otherAssets?: AssetCollectionActions<OtherAssetInput, OtherAssetRecord>;
}

export interface AssetApiClient {
	listCashAccounts: () => Promise<CashAccountRecord[]>;
	createCashAccount: (payload: CashAccountInput) => Promise<CashAccountRecord>;
	updateCashAccount: (recordId: number, payload: CashAccountInput) => Promise<CashAccountRecord>;
	deleteCashAccount: (recordId: number) => Promise<void>;
	listCashTransfers: () => Promise<CashTransferRecord[]>;
	createCashTransfer: (payload: CashTransferInput) => Promise<CashTransferRecord>;
	updateCashTransfer: (recordId: number, payload: CashTransferInput) => Promise<CashTransferRecord>;
	deleteCashTransfer: (recordId: number) => Promise<void>;
	listCashLedgerEntries: () => Promise<CashLedgerEntryRecord[]>;
	createCashLedgerAdjustment: (
		payload: CashLedgerAdjustmentInput,
	) => Promise<CashLedgerEntryRecord>;
	updateCashLedgerAdjustment: (
		recordId: number,
		payload: CashLedgerAdjustmentInput,
	) => Promise<CashLedgerEntryRecord>;
	deleteCashLedgerAdjustment: (recordId: number) => Promise<void>;
	listAgentTasks: () => Promise<AgentTaskRecord[]>;
	listAssetMutationAudits: (params?: {
		agentTaskId?: number;
	}) => Promise<AssetMutationAuditRecord[]>;
	listHoldings: () => Promise<HoldingRecord[]>;
	createHolding: (payload: HoldingInput) => Promise<HoldingRecord | null>;
	updateHolding: (recordId: number, payload: HoldingInput) => Promise<HoldingRecord>;
	deleteHolding: (recordId: number) => Promise<void>;
	listHoldingTransactions: () => Promise<HoldingTransactionRecord[]>;
	updateHoldingTransaction: (
		recordId: number,
		payload: HoldingTransactionUpdateInput,
	) => Promise<HoldingTransactionRecord>;
	deleteHoldingTransaction: (recordId: number) => Promise<void>;
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
