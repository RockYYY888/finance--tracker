import { useEffect, useMemo, useState } from "react";
import { CashAccountForm } from "./CashAccountForm";
import { CashAccountList } from "./CashAccountList";
import { CashLedgerAdjustmentPanel } from "./CashLedgerAdjustmentPanel";
import { CashTransferPanel } from "./CashTransferPanel";
import { FixedAssetForm } from "./FixedAssetForm";
import { FixedAssetList } from "./FixedAssetList";
import { HoldingForm } from "./HoldingForm";
import { HoldingList } from "./HoldingList";
import { HoldingTransactionHistory } from "./HoldingTransactionHistory";
import { LiabilityForm } from "./LiabilityForm";
import { LiabilityList } from "./LiabilityList";
import { OtherAssetForm } from "./OtherAssetForm";
import { OtherAssetList } from "./OtherAssetList";
import { useAssetCollection } from "../../hooks/useAssetCollection";
import type {
	AssetManagerController,
	CashAccountFormDraft,
	CashAccountInput,
	CashAccountRecord,
	CashLedgerAdjustmentInput,
	CashLedgerEntryRecord,
	CashTransferInput,
	CashTransferRecord,
	FixedAssetFormDraft,
	FixedAssetInput,
	FixedAssetRecord,
	HoldingEditorIntent,
	HoldingFormDraft,
	HoldingInput,
	HoldingRecord,
	HoldingTransactionRecord,
	HoldingTransactionUpdateInput,
	LiabilityFormDraft,
	LiabilityInput,
	LiabilityRecord,
	OtherAssetFormDraft,
	OtherAssetInput,
	OtherAssetRecord,
} from "../../types/assets";

type AssetSection = "cash" | "investment" | "fixed" | "liability" | "other";

type SummarySection = {
	key: AssetSection;
	label: string;
	count: number;
};

const EMPTY_CASH_ACCOUNTS: CashAccountRecord[] = [];
const EMPTY_CASH_LEDGER_ENTRIES: CashLedgerEntryRecord[] = [];
const EMPTY_CASH_TRANSFERS: CashTransferRecord[] = [];
const EMPTY_HOLDINGS: HoldingRecord[] = [];
const EMPTY_HOLDING_TRANSACTIONS: HoldingTransactionRecord[] = [];
const EMPTY_FIXED_ASSETS: FixedAssetRecord[] = [];
const EMPTY_LIABILITIES: LiabilityRecord[] = [];
const EMPTY_OTHER_ASSETS: OtherAssetRecord[] = [];

export interface AssetManagerProps {
	initialCashAccounts?: CashAccountRecord[];
	initialHoldings?: HoldingRecord[];
	initialFixedAssets?: FixedAssetRecord[];
	initialLiabilities?: LiabilityRecord[];
	initialOtherAssets?: OtherAssetRecord[];
	cashActions?: AssetManagerController["cashAccounts"];
	cashTransferActions?: AssetManagerController["cashTransfers"];
	cashLedgerAdjustmentActions?: AssetManagerController["cashLedgerAdjustments"];
	holdingActions?: AssetManagerController["holdings"];
	holdingTransactionActions?: AssetManagerController["holdingTransactions"];
	fixedAssetActions?: AssetManagerController["fixedAssets"];
	liabilityActions?: AssetManagerController["liabilities"];
	otherAssetActions?: AssetManagerController["otherAssets"];
	defaultSection?: AssetSection;
	title?: string;
	description?: string;
	autoRefreshOnMount?: boolean;
	refreshToken?: number;
	maxStartedOnDate?: string;
}

function toCashDraft(record: CashAccountRecord): CashAccountFormDraft {
	return {
		name: record.name,
		currency: record.currency,
		balance: String(record.balance),
		account_type: record.account_type,
		started_on: record.started_on ?? "",
		note: record.note ?? "",
	};
}

function toHoldingDraft(record: HoldingRecord): HoldingFormDraft {
	return {
		side: "BUY",
		symbol: record.symbol,
		name: record.name,
		quantity: String(record.quantity),
		fallback_currency: record.fallback_currency,
		cost_basis_price: record.cost_basis_price != null ? String(record.cost_basis_price) : "",
		market: record.market,
		broker: record.broker ?? "",
		started_on: record.started_on ?? "",
		note: record.note ?? "",
		sell_proceeds_handling: "CREATE_NEW_CASH",
		sell_proceeds_account_id: "",
		buy_funding_handling: "",
		buy_funding_account_id: "",
	};
}

function toFixedAssetDraft(record: FixedAssetRecord): FixedAssetFormDraft {
	return {
		name: record.name,
		category: record.category,
		current_value_cny: String(record.current_value_cny),
		purchase_value_cny: record.purchase_value_cny != null ? String(record.purchase_value_cny) : "",
		started_on: record.started_on ?? "",
		note: record.note ?? "",
	};
}

function toLiabilityDraft(record: LiabilityRecord): LiabilityFormDraft {
	return {
		name: record.name,
		category: record.category,
		currency: record.currency,
		balance: String(record.balance),
		started_on: record.started_on ?? "",
		note: record.note ?? "",
	};
}

function toOtherAssetDraft(record: OtherAssetRecord): OtherAssetFormDraft {
	return {
		name: record.name,
		category: record.category,
		current_value_cny: String(record.current_value_cny),
		original_value_cny: record.original_value_cny != null ? String(record.original_value_cny) : "",
		started_on: record.started_on ?? "",
		note: record.note ?? "",
	};
}

function createLocalCashAccount(
	payload: CashAccountInput,
	nextId: number,
): CashAccountRecord {
	return {
		id: nextId,
		...payload,
		note: payload.note,
		value_cny: payload.currency === "CNY" ? payload.balance : 0,
		fx_to_cny: payload.currency === "CNY" ? 1 : null,
	};
}

function updateLocalCashAccount(
	currentRecord: CashAccountRecord,
	payload: CashAccountInput,
): CashAccountRecord {
	return {
		...currentRecord,
		...payload,
		note: payload.note,
		value_cny: payload.currency === "CNY" ? payload.balance : currentRecord.value_cny ?? 0,
		fx_to_cny: payload.currency === "CNY" ? 1 : currentRecord.fx_to_cny ?? null,
	};
}

function createLocalHolding(payload: HoldingInput, nextId: number): HoldingRecord | null {
	if (payload.side === "SELL") {
		return null;
	}

	return {
		id: nextId,
		side: payload.side,
		symbol: payload.symbol,
		name: payload.name,
		quantity: payload.quantity,
		fallback_currency: payload.fallback_currency,
		cost_basis_price: payload.cost_basis_price,
		market: payload.market,
		broker: payload.broker,
		started_on: payload.started_on,
		note: payload.note,
		price: null,
		price_currency: payload.fallback_currency,
		value_cny: 0,
		return_pct: null,
		last_updated: null,
	};
}

function updateLocalHolding(
	currentRecord: HoldingRecord,
	payload: HoldingInput,
): HoldingRecord {
	return {
		...currentRecord,
		side: "BUY",
		symbol: payload.symbol,
		name: payload.name,
		quantity: payload.quantity,
		fallback_currency: payload.fallback_currency,
		cost_basis_price: payload.cost_basis_price,
		market: payload.market,
		broker: payload.broker,
		started_on: payload.started_on,
		note: payload.note,
		price_currency: currentRecord.price_currency ?? payload.fallback_currency,
	};
}

function createLocalFixedAsset(
	payload: FixedAssetInput,
	nextId: number,
): FixedAssetRecord {
	return {
		id: nextId,
		...payload,
		purchase_value_cny: payload.purchase_value_cny,
		note: payload.note,
		value_cny: payload.current_value_cny,
		return_pct: payload.purchase_value_cny
			? Number(
				(
					((payload.current_value_cny - payload.purchase_value_cny) /
						payload.purchase_value_cny) *
					100
				).toFixed(2),
			)
			: null,
	};
}

function updateLocalFixedAsset(
	currentRecord: FixedAssetRecord,
	payload: FixedAssetInput,
): FixedAssetRecord {
	return {
		...currentRecord,
		...payload,
		purchase_value_cny: payload.purchase_value_cny,
		note: payload.note,
		value_cny: payload.current_value_cny,
		return_pct: payload.purchase_value_cny
			? Number(
				(
					((payload.current_value_cny - payload.purchase_value_cny) /
						payload.purchase_value_cny) *
					100
				).toFixed(2),
			)
			: null,
	};
}

function createLocalLiability(
	payload: LiabilityInput,
	nextId: number,
): LiabilityRecord {
	return {
		id: nextId,
		...payload,
		note: payload.note,
		value_cny: payload.currency === "CNY" ? payload.balance : 0,
		fx_to_cny: payload.currency === "CNY" ? 1 : null,
	};
}

function updateLocalLiability(
	currentRecord: LiabilityRecord,
	payload: LiabilityInput,
): LiabilityRecord {
	return {
		...currentRecord,
		...payload,
		note: payload.note,
		value_cny: payload.currency === "CNY" ? payload.balance : currentRecord.value_cny ?? 0,
		fx_to_cny: payload.currency === "CNY" ? 1 : currentRecord.fx_to_cny ?? null,
	};
}

function createLocalOtherAsset(
	payload: OtherAssetInput,
	nextId: number,
): OtherAssetRecord {
	return {
		id: nextId,
		...payload,
		original_value_cny: payload.original_value_cny,
		note: payload.note,
		value_cny: payload.current_value_cny,
		return_pct: payload.original_value_cny
			? Number(
				(
					((payload.current_value_cny - payload.original_value_cny) /
						payload.original_value_cny) *
					100
				).toFixed(2),
			)
			: null,
	};
}

function updateLocalOtherAsset(
	currentRecord: OtherAssetRecord,
	payload: OtherAssetInput,
): OtherAssetRecord {
	return {
		...currentRecord,
		...payload,
		original_value_cny: payload.original_value_cny,
		note: payload.note,
		value_cny: payload.current_value_cny,
		return_pct: payload.original_value_cny
			? Number(
				(
					((payload.current_value_cny - payload.original_value_cny) /
						payload.original_value_cny) *
					100
				).toFixed(2),
			)
			: null,
	};
}

export function AssetManager({
	initialCashAccounts,
	initialHoldings,
	initialFixedAssets,
	initialLiabilities,
	initialOtherAssets,
	cashActions,
	cashTransferActions,
	cashLedgerAdjustmentActions,
	holdingActions,
	holdingTransactionActions,
	fixedAssetActions,
	liabilityActions,
	otherAssetActions,
	defaultSection = "cash",
	title = "资产管理",
	description,
	autoRefreshOnMount = false,
	refreshToken = 0,
	maxStartedOnDate,
}: AssetManagerProps) {
	const [activeSection, setActiveSection] = useState<AssetSection>(defaultSection);
	const [holdingEditorIntent, setHoldingEditorIntent] = useState<HoldingEditorIntent>("buy");
	const [cashTransfers, setCashTransfers] = useState<CashTransferRecord[]>(
		EMPTY_CASH_TRANSFERS,
	);
	const [cashTransfersLoading, setCashTransfersLoading] = useState(false);
	const [cashTransfersError, setCashTransfersError] = useState<string | null>(null);
	const [cashLedgerEntries, setCashLedgerEntries] = useState<CashLedgerEntryRecord[]>(
		EMPTY_CASH_LEDGER_ENTRIES,
	);
	const [cashLedgerLoading, setCashLedgerLoading] = useState(false);
	const [cashLedgerError, setCashLedgerError] = useState<string | null>(null);
	const [holdingTransactions, setHoldingTransactions] = useState<HoldingTransactionRecord[]>(
		EMPTY_HOLDING_TRANSACTIONS,
	);
	const [holdingTransactionsLoading, setHoldingTransactionsLoading] = useState(false);
	const [holdingTransactionsError, setHoldingTransactionsError] = useState<string | null>(null);
	const cashCollection = useAssetCollection({
		initialItems: initialCashAccounts ?? EMPTY_CASH_ACCOUNTS,
		actions: cashActions,
		createLocalRecord: createLocalCashAccount,
		updateLocalRecord: updateLocalCashAccount,
	});
	const holdingCollection = useAssetCollection({
		initialItems: initialHoldings ?? EMPTY_HOLDINGS,
		actions: holdingActions,
		createLocalRecord: createLocalHolding,
		updateLocalRecord: updateLocalHolding,
	});
	const fixedAssetCollection = useAssetCollection({
		initialItems: initialFixedAssets ?? EMPTY_FIXED_ASSETS,
		actions: fixedAssetActions,
		createLocalRecord: createLocalFixedAsset,
		updateLocalRecord: updateLocalFixedAsset,
	});
	const liabilityCollection = useAssetCollection({
		initialItems: initialLiabilities ?? EMPTY_LIABILITIES,
		actions: liabilityActions,
		createLocalRecord: createLocalLiability,
		updateLocalRecord: updateLocalLiability,
	});
	const otherAssetCollection = useAssetCollection({
		initialItems: initialOtherAssets ?? EMPTY_OTHER_ASSETS,
		actions: otherAssetActions,
		createLocalRecord: createLocalOtherAsset,
		updateLocalRecord: updateLocalOtherAsset,
	});
	const holdingCreateSeed = useMemo(
		() => ({
			side: holdingEditorIntent === "sell" ? ("SELL" as const) : ("BUY" as const),
		}),
		[holdingEditorIntent],
	);

	function openHoldingBuyEditor(): void {
		setHoldingEditorIntent("buy");
		holdingCollection.openCreate();
	}

	function openHoldingSellEditor(): void {
		setHoldingEditorIntent("sell");
		holdingCollection.openCreate();
	}

	function openHoldingEditEditor(record: HoldingRecord): void {
		setHoldingEditorIntent("edit");
		holdingCollection.openEdit(record);
	}

	function closeHoldingEditor(): void {
		holdingCollection.closeEditor();
		setHoldingEditorIntent("buy");
	}

	useEffect(() => {
		if (!autoRefreshOnMount && refreshToken === 0) {
			return;
		}

		void cashCollection.refresh();
		void holdingCollection.refresh();
		void fixedAssetCollection.refresh();
		void liabilityCollection.refresh();
		void otherAssetCollection.refresh();
	}, [autoRefreshOnMount, refreshToken]);

	useEffect(() => {
		if (!cashTransferActions?.onRefresh) {
			setCashTransfers(EMPTY_CASH_TRANSFERS);
			return;
		}

		let cancelled = false;
		setCashTransfersLoading(true);
		setCashTransfersError(null);
		void Promise.resolve(cashTransferActions.onRefresh())
			.then((items) => {
				if (cancelled) {
					return;
				}
				setCashTransfers(items);
			})
			.catch((error) => {
				if (cancelled) {
					return;
				}
				setCashTransfersError(error instanceof Error ? error.message : "加载账户划转失败。");
			})
			.finally(() => {
				if (!cancelled) {
					setCashTransfersLoading(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [cashTransferActions, refreshToken]);

	useEffect(() => {
		if (!holdingTransactionActions?.onRefresh) {
			setHoldingTransactions(EMPTY_HOLDING_TRANSACTIONS);
			return;
		}

		let cancelled = false;
		setHoldingTransactionsLoading(true);
		setHoldingTransactionsError(null);
		void Promise.resolve(holdingTransactionActions.onRefresh())
			.then((items) => {
				if (cancelled) {
					return;
				}
				setHoldingTransactions(items);
			})
			.catch((error) => {
				if (cancelled) {
					return;
				}
				setHoldingTransactionsError(
					error instanceof Error ? error.message : "加载投资交易记录失败。",
				);
			})
			.finally(() => {
				if (!cancelled) {
					setHoldingTransactionsLoading(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [holdingTransactionActions, refreshToken]);

	useEffect(() => {
		if (!cashLedgerAdjustmentActions?.onRefresh) {
			setCashLedgerEntries(EMPTY_CASH_LEDGER_ENTRIES);
			return;
		}

		let cancelled = false;
		setCashLedgerLoading(true);
		setCashLedgerError(null);
		void Promise.resolve(cashLedgerAdjustmentActions.onRefresh())
			.then((items) => {
				if (cancelled) {
					return;
				}
				setCashLedgerEntries(items);
			})
			.catch((error) => {
				if (cancelled) {
					return;
				}
				setCashLedgerError(error instanceof Error ? error.message : "加载现金账本失败。");
			})
			.finally(() => {
				if (!cancelled) {
					setCashLedgerLoading(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [cashLedgerAdjustmentActions, refreshToken]);

	async function removeCashRecord(recordId: number): Promise<void> {
		const record = cashCollection.items.find((item) => item.id === recordId);
		if (!record) {
			return;
		}
		await cashCollection.remove(record);
	}

	async function createCashTransferRecord(payload: CashTransferInput): Promise<CashTransferRecord> {
		if (!cashTransferActions?.onCreate) {
			throw new Error("当前未配置账户划转能力。");
		}

		setCashTransfersError(null);
		const createdRecord = await cashTransferActions.onCreate(payload);
		if (!createdRecord) {
			throw new Error("新增账户划转失败，请稍后重试。");
		}
		setCashTransfers((currentItems) => [createdRecord, ...currentItems]);
		return createdRecord;
	}

	async function removeCashTransferRecord(recordId: number): Promise<void> {
		if (!cashTransferActions?.onDelete) {
			return;
		}

		setCashTransfersError(null);
		await cashTransferActions.onDelete(recordId);
		setCashTransfers((currentItems) =>
			currentItems.filter((item) => item.id !== recordId),
		);
	}

	async function updateCashTransferRecord(
		recordId: number,
		payload: CashTransferInput,
	): Promise<CashTransferRecord> {
		if (!cashTransferActions?.onEdit) {
			throw new Error("当前未配置账户划转修正能力。");
		}

		setCashTransfersError(null);
		const updatedRecord = await cashTransferActions.onEdit(recordId, payload);
		setCashTransfers((currentItems) =>
			currentItems.map((item) => (item.id === updatedRecord.id ? updatedRecord : item)),
		);
		return updatedRecord;
	}

	async function createCashLedgerAdjustmentRecord(
		payload: CashLedgerAdjustmentInput,
	): Promise<CashLedgerEntryRecord> {
		if (!cashLedgerAdjustmentActions?.onCreate) {
			throw new Error("当前未配置现金账本调整能力。");
		}

		setCashLedgerError(null);
		const createdEntry = await cashLedgerAdjustmentActions.onCreate(payload);
		if (!createdEntry) {
			throw new Error("新增手工账本调整失败，请稍后重试。");
		}
		setCashLedgerEntries((currentItems) => [createdEntry, ...currentItems]);
		return createdEntry;
	}

	async function updateCashLedgerAdjustmentRecord(
		recordId: number,
		payload: CashLedgerAdjustmentInput,
	): Promise<CashLedgerEntryRecord> {
		if (!cashLedgerAdjustmentActions?.onEdit) {
			throw new Error("当前未配置现金账本调整修正能力。");
		}

		setCashLedgerError(null);
		const updatedEntry = await cashLedgerAdjustmentActions.onEdit(recordId, payload);
		setCashLedgerEntries((currentItems) =>
			currentItems.map((item) => (item.id === updatedEntry.id ? updatedEntry : item)),
		);
		return updatedEntry;
	}

	async function removeCashLedgerAdjustmentRecord(recordId: number): Promise<void> {
		if (!cashLedgerAdjustmentActions?.onDelete) {
			return;
		}

		setCashLedgerError(null);
		await cashLedgerAdjustmentActions.onDelete(recordId);
		setCashLedgerEntries((currentItems) =>
			currentItems.filter((item) => item.id !== recordId),
		);
	}

	async function removeHoldingRecord(recordId: number): Promise<void> {
		const record = holdingCollection.items.find((item) => item.id === recordId);
		if (!record) {
			return;
		}
		await holdingCollection.remove(record);
	}

	async function updateHoldingTransactionRecord(
		recordId: number,
		payload: HoldingTransactionUpdateInput,
	): Promise<HoldingTransactionRecord> {
		if (!holdingTransactionActions?.onEdit) {
			throw new Error("当前未配置交易修正能力。");
		}

		setHoldingTransactionsError(null);
		const updatedRecord = await holdingTransactionActions.onEdit(recordId, payload);
		setHoldingTransactions((currentItems) =>
			currentItems.map((item) => (item.id === updatedRecord.id ? updatedRecord : item)),
		);
		return updatedRecord;
	}

	async function removeHoldingTransactionRecord(recordId: number): Promise<void> {
		if (!holdingTransactionActions?.onDelete) {
			return;
		}

		setHoldingTransactionsError(null);
		await holdingTransactionActions.onDelete(recordId);
		setHoldingTransactions((currentItems) =>
			currentItems.filter((item) => item.id !== recordId),
		);
	}

	async function removeFixedAssetRecord(recordId: number): Promise<void> {
		const record = fixedAssetCollection.items.find((item) => item.id === recordId);
		if (!record) {
			return;
		}
		await fixedAssetCollection.remove(record);
	}

	async function removeLiabilityRecord(recordId: number): Promise<void> {
		const record = liabilityCollection.items.find((item) => item.id === recordId);
		if (!record) {
			return;
		}
		await liabilityCollection.remove(record);
	}

	async function removeOtherAssetRecord(recordId: number): Promise<void> {
		const record = otherAssetCollection.items.find((item) => item.id === recordId);
		if (!record) {
			return;
		}
		await otherAssetCollection.remove(record);
	}

	function summaryCountClass(section: AssetSection): string {
		return `asset-manager__summary-card asset-manager__summary-card--${section}`;
	}

	const summarySections: SummarySection[] = [
		{ key: "cash", label: "现金", count: cashCollection.items.length },
		{ key: "investment", label: "投资类", count: holdingCollection.items.length },
		{ key: "fixed", label: "固定资产", count: fixedAssetCollection.items.length },
		{ key: "liability", label: "负债", count: liabilityCollection.items.length },
		{ key: "other", label: "其他", count: otherAssetCollection.items.length },
	];

	return (
		<section className="asset-manager">
			<header className="asset-manager__header">
				<div>
					<p className="asset-manager__eyebrow">ASSET MODULES</p>
					<h2>{title}</h2>
					{description ? <p>{description}</p> : null}
				</div>
				<div className="asset-manager__summary" role="tablist" aria-label="资产类型切换">
					{summarySections.map((section) => (
						<button
							key={section.key}
							type="button"
							role="tab"
							aria-selected={activeSection === section.key}
							className={`${summaryCountClass(section.key)} ${activeSection === section.key ? "is-active" : ""}`}
							onClick={() => setActiveSection(section.key)}
						>
							<span>{section.label}</span>
							<strong>{section.count}</strong>
						</button>
					))}
				</div>
			</header>

			<div className="asset-manager__workspace">
				{activeSection === "cash" ? (
					<>
						{cashCollection.isEditorOpen ? (
							<CashAccountForm
								mode={cashCollection.editorMode ?? "create"}
								resetKey={cashCollection.editorSessionKey}
								value={
									cashCollection.editorSeedRecord
										? toCashDraft(cashCollection.editorSeedRecord)
										: null
								}
								recordId={cashCollection.editingRecordId}
								busy={cashCollection.isSubmitting}
								errorMessage={cashCollection.errorMessage}
								onCreate={(payload) => cashCollection.submit(payload)}
								onEdit={(_recordId, payload) => cashCollection.submit(payload)}
								onDelete={(recordId) => removeCashRecord(recordId)}
								onCancel={cashCollection.closeEditor}
							/>
						) : null}
						<CashAccountList
							accounts={cashCollection.items}
							loading={cashCollection.isRefreshing}
							busy={cashCollection.isSubmitting}
							errorMessage={cashCollection.errorMessage}
							onCreate={cashCollection.isEditorOpen ? undefined : cashCollection.openCreate}
							onEdit={(account) => cashCollection.openEdit(account)}
							onDelete={(recordId) => removeCashRecord(recordId)}
						/>
						<CashTransferPanel
							accounts={cashCollection.items}
							transfers={cashTransfers}
							loading={cashTransfersLoading}
							busy={cashCollection.isSubmitting}
							errorMessage={cashTransfersError}
							maxStartedOnDate={maxStartedOnDate}
							onCreate={(payload) => createCashTransferRecord(payload)}
							onEdit={(recordId, payload) => updateCashTransferRecord(recordId, payload)}
							onDelete={(recordId) => removeCashTransferRecord(recordId)}
						/>
						<CashLedgerAdjustmentPanel
							accounts={cashCollection.items}
							entries={cashLedgerEntries}
							loading={cashLedgerLoading}
							busy={cashCollection.isSubmitting}
							errorMessage={cashLedgerError}
							maxStartedOnDate={maxStartedOnDate}
							onCreate={(payload) => createCashLedgerAdjustmentRecord(payload)}
							onEdit={(recordId, payload) =>
								updateCashLedgerAdjustmentRecord(recordId, payload)
							}
							onDelete={(recordId) => removeCashLedgerAdjustmentRecord(recordId)}
						/>
					</>
				) : null}

				{activeSection === "investment" ? (
					<>
						{holdingCollection.isEditorOpen ? (
							<HoldingForm
								mode={holdingCollection.editorMode ?? "create"}
								resetKey={holdingCollection.editorSessionKey}
								intent={holdingCollection.editorMode === "edit" ? "edit" : holdingEditorIntent}
								value={
									holdingCollection.editorSeedRecord
										? toHoldingDraft(holdingCollection.editorSeedRecord)
										: holdingCreateSeed
								}
								existingHoldings={holdingCollection.items}
								cashAccounts={cashCollection.items}
								recordId={holdingCollection.editingRecordId}
								busy={holdingCollection.isSubmitting}
								errorMessage={holdingCollection.errorMessage}
								maxStartedOnDate={maxStartedOnDate}
								onCreate={(payload) => holdingCollection.submit(payload)}
								onEdit={(_recordId, payload) => holdingCollection.submit(payload)}
								onDelete={(recordId) => removeHoldingRecord(recordId)}
								onSearch={holdingActions?.onSearch}
								onMergeDuplicate={holdingActions?.onMergeDuplicate}
								onCancel={closeHoldingEditor}
							/>
						) : null}
						<HoldingList
							holdings={holdingCollection.items}
							loading={holdingCollection.isRefreshing}
							busy={holdingCollection.isSubmitting}
							errorMessage={holdingCollection.errorMessage}
							onCreateBuy={holdingCollection.isEditorOpen ? undefined : openHoldingBuyEditor}
							onCreateSell={
								holdingCollection.isEditorOpen || holdingCollection.items.length === 0
									? undefined
									: openHoldingSellEditor
							}
							onEdit={(holding) => openHoldingEditEditor(holding)}
						/>
						<HoldingTransactionHistory
							transactions={holdingTransactions}
							cashAccounts={cashCollection.items}
							loading={holdingTransactionsLoading}
							busy={holdingCollection.isSubmitting}
							errorMessage={holdingTransactionsError}
							maxStartedOnDate={maxStartedOnDate}
							onEdit={(recordId, payload) =>
								updateHoldingTransactionRecord(recordId, payload)
							}
							onDelete={(recordId) => removeHoldingTransactionRecord(recordId)}
						/>
					</>
				) : null}

				{activeSection === "fixed" ? (
					<>
						{fixedAssetCollection.isEditorOpen ? (
							<FixedAssetForm
								mode={fixedAssetCollection.editorMode ?? "create"}
								resetKey={fixedAssetCollection.editorSessionKey}
								value={
									fixedAssetCollection.editorSeedRecord
										? toFixedAssetDraft(fixedAssetCollection.editorSeedRecord)
										: null
								}
								recordId={fixedAssetCollection.editingRecordId}
								busy={fixedAssetCollection.isSubmitting}
								errorMessage={fixedAssetCollection.errorMessage}
								onCreate={(payload) => fixedAssetCollection.submit(payload)}
								onEdit={(_recordId, payload) => fixedAssetCollection.submit(payload)}
								onDelete={(recordId) => removeFixedAssetRecord(recordId)}
								onCancel={fixedAssetCollection.closeEditor}
							/>
						) : null}
						<FixedAssetList
							assets={fixedAssetCollection.items}
							loading={fixedAssetCollection.isRefreshing}
							busy={fixedAssetCollection.isSubmitting}
							errorMessage={fixedAssetCollection.errorMessage}
							onCreate={fixedAssetCollection.isEditorOpen ? undefined : fixedAssetCollection.openCreate}
							onEdit={(asset) => fixedAssetCollection.openEdit(asset)}
							onDelete={(recordId) => removeFixedAssetRecord(recordId)}
						/>
					</>
				) : null}

				{activeSection === "liability" ? (
					<>
						{liabilityCollection.isEditorOpen ? (
							<LiabilityForm
								mode={liabilityCollection.editorMode ?? "create"}
								resetKey={liabilityCollection.editorSessionKey}
								value={
									liabilityCollection.editorSeedRecord
										? toLiabilityDraft(liabilityCollection.editorSeedRecord)
										: null
								}
								recordId={liabilityCollection.editingRecordId}
								busy={liabilityCollection.isSubmitting}
								errorMessage={liabilityCollection.errorMessage}
								onCreate={(payload) => liabilityCollection.submit(payload)}
								onEdit={(_recordId, payload) => liabilityCollection.submit(payload)}
								onDelete={(recordId) => removeLiabilityRecord(recordId)}
								onCancel={liabilityCollection.closeEditor}
							/>
						) : null}
						<LiabilityList
							liabilities={liabilityCollection.items}
							loading={liabilityCollection.isRefreshing}
							busy={liabilityCollection.isSubmitting}
							errorMessage={liabilityCollection.errorMessage}
							onCreate={liabilityCollection.isEditorOpen ? undefined : liabilityCollection.openCreate}
							onEdit={(entry) => liabilityCollection.openEdit(entry)}
							onDelete={(recordId) => removeLiabilityRecord(recordId)}
						/>
					</>
				) : null}

				{activeSection === "other" ? (
					<>
						{otherAssetCollection.isEditorOpen ? (
							<OtherAssetForm
								mode={otherAssetCollection.editorMode ?? "create"}
								resetKey={otherAssetCollection.editorSessionKey}
								value={
									otherAssetCollection.editorSeedRecord
										? toOtherAssetDraft(otherAssetCollection.editorSeedRecord)
										: null
								}
								recordId={otherAssetCollection.editingRecordId}
								busy={otherAssetCollection.isSubmitting}
								errorMessage={otherAssetCollection.errorMessage}
								onCreate={(payload) => otherAssetCollection.submit(payload)}
								onEdit={(_recordId, payload) => otherAssetCollection.submit(payload)}
								onDelete={(recordId) => removeOtherAssetRecord(recordId)}
								onCancel={otherAssetCollection.closeEditor}
							/>
						) : null}
						<OtherAssetList
							assets={otherAssetCollection.items}
							loading={otherAssetCollection.isRefreshing}
							busy={otherAssetCollection.isSubmitting}
							errorMessage={otherAssetCollection.errorMessage}
							onCreate={otherAssetCollection.isEditorOpen ? undefined : otherAssetCollection.openCreate}
							onEdit={(asset) => otherAssetCollection.openEdit(asset)}
							onDelete={(recordId) => removeOtherAssetRecord(recordId)}
						/>
					</>
				) : null}
			</div>
		</section>
	);
}
