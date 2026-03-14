import { useEffect, useMemo, useRef, useState } from "react";
import { CashAccountForm } from "./CashAccountForm";
import { CashAccountList } from "./CashAccountList";
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
import type { SupportedCurrencyFxRates } from "../../lib/assetCurrency";
import { useAssetCollection } from "../../hooks/useAssetCollection";
import type {
	AssetManagerController,
	CashAccountFormDraft,
	CashAccountInput,
	CashAccountRecord,
	CashLedgerEntryRecord,
	CashTransferInput,
	FixedAssetFormDraft,
	FixedAssetInput,
	FixedAssetRecord,
	HoldingEditorIntent,
	HoldingFormDraft,
	HoldingInput,
	HoldingRecord,
	HoldingTransactionRecord,
	LiabilityFormDraft,
	LiabilityInput,
	LiabilityRecord,
	OtherAssetFormDraft,
	OtherAssetInput,
	OtherAssetRecord,
} from "../../types/assets";

type AssetSection = "cash" | "investment" | "fixed" | "liability" | "other";
type AssetResource =
	| "cashAccounts"
	| "cashTransfers"
	| "cashLedger"
	| "holdings"
	| "holdingTransactions"
	| "fixedAssets"
	| "liabilities"
	| "otherAssets";

type SummarySection = {
	key: AssetSection;
	label: string;
	count: number;
};

const ACTIVE_SECTION_STORAGE_KEY = "asset-manager-active-section";
const SECTION_RESOURCES: Record<AssetSection, AssetResource[]> = {
	cash: ["cashAccounts"],
	investment: ["cashAccounts", "holdings", "holdingTransactions"],
	fixed: ["fixedAssets"],
	liability: ["liabilities"],
	other: ["otherAssets"],
};

const EMPTY_CASH_ACCOUNTS: CashAccountRecord[] = [];
const EMPTY_CASH_LEDGER_ENTRIES: CashLedgerEntryRecord[] = [];
const EMPTY_HOLDINGS: HoldingRecord[] = [];
const EMPTY_HOLDING_TRANSACTIONS: HoldingTransactionRecord[] = [];
const EMPTY_FIXED_ASSETS: FixedAssetRecord[] = [];
const EMPTY_LIABILITIES: LiabilityRecord[] = [];
const EMPTY_OTHER_ASSETS: OtherAssetRecord[] = [];
const EMPTY_LOADED_RESOURCES: Record<AssetResource, boolean> = {
	cashAccounts: false,
	cashTransfers: false,
	cashLedger: false,
	holdings: false,
	holdingTransactions: false,
	fixedAssets: false,
	liabilities: false,
	otherAssets: false,
};

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
	loadOnMount?: boolean;
	maxStartedOnDate?: string;
	displayFxRates?: SupportedCurrencyFxRates;
	onRecordsCommitted?: (sections: AssetSection[]) => void;
}

function isAssetSection(value: string): value is AssetSection {
	return value === "cash" ||
		value === "investment" ||
		value === "fixed" ||
		value === "liability" ||
		value === "other";
}

function readInitialSection(defaultSection: AssetSection): AssetSection {
	if (typeof window === "undefined") {
		return defaultSection;
	}

	try {
		const storedSection = window.sessionStorage.getItem(ACTIVE_SECTION_STORAGE_KEY);
		return storedSection && isAssetSection(storedSection) ? storedSection : defaultSection;
	} catch {
		return defaultSection;
	}
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
	loadOnMount = false,
	maxStartedOnDate,
	displayFxRates,
	onRecordsCommitted,
}: AssetManagerProps) {
	const [activeSection, setActiveSection] = useState<AssetSection>(() =>
		readInitialSection(defaultSection)
	);
	const [holdingEditorIntent, setHoldingEditorIntent] = useState<HoldingEditorIntent>("buy");
	const [loadedResources, setLoadedResources] = useState<Record<AssetResource, boolean>>(() => ({
		...EMPTY_LOADED_RESOURCES,
		cashAccounts: initialCashAccounts !== undefined,
		holdings: initialHoldings !== undefined,
		fixedAssets: initialFixedAssets !== undefined,
		liabilities: initialLiabilities !== undefined,
		otherAssets: initialOtherAssets !== undefined,
	}));
	const [cashActivityEntries, setCashActivityEntries] = useState<CashLedgerEntryRecord[]>(
		EMPTY_CASH_LEDGER_ENTRIES,
	);
	const [cashActivityLoading, setCashActivityLoading] = useState(false);
	const [cashActivityError, setCashActivityError] = useState<string | null>(null);
	const [isCashTransferEditorOpen, setIsCashTransferEditorOpen] = useState(false);
	const [cashTransferError, setCashTransferError] = useState<string | null>(null);
	const [isSubmittingCashTransfer, setIsSubmittingCashTransfer] = useState(false);
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
	const hasLoadedInitialSectionRef = useRef(false);
	const loadingResourcesRef = useRef<Set<AssetResource>>(new Set());

	useEffect(() => {
		try {
			window.sessionStorage.setItem(ACTIVE_SECTION_STORAGE_KEY, activeSection);
		} catch {
			// Ignore storage errors and keep the in-memory section selection.
		}
	}, [activeSection]);

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

	function openCashCreateEditor(): void {
		setCashTransferError(null);
		setIsCashTransferEditorOpen(false);
		cashCollection.openCreate();
	}

	function openCashEditEditor(record: CashAccountRecord): void {
		setCashTransferError(null);
		setIsCashTransferEditorOpen(false);
		cashCollection.openEdit(record);
	}

	function closeCashEditor(): void {
		cashCollection.closeEditor();
		setCashActivityError(null);
	}

	function openCashTransferEditor(): void {
		cashCollection.closeEditor();
		setCashActivityError(null);
		setCashTransferError(null);
		setIsCashTransferEditorOpen(true);
	}

	function closeCashTransferEditor(): void {
		setCashTransferError(null);
		setIsCashTransferEditorOpen(false);
	}

	function refreshVisibleCashAccountActivity(): void {
		if (cashCollection.editorMode === "edit" && cashCollection.editingRecordId !== null) {
			void refreshCashAccountActivity(cashCollection.editingRecordId);
		}
	}

	function markResourcesLoaded(...resources: AssetResource[]): void {
		setLoadedResources((currentResources) => {
			let didChange = false;
			const nextResources = { ...currentResources };
			for (const resource of resources) {
				if (nextResources[resource]) {
					continue;
				}
				nextResources[resource] = true;
				didChange = true;
			}
			return didChange ? nextResources : currentResources;
		});
	}

	function invalidateResources(...resources: AssetResource[]): void {
		setLoadedResources((currentResources) => {
			let didChange = false;
			const nextResources = { ...currentResources };
			for (const resource of resources) {
				if (!nextResources[resource]) {
					continue;
				}
				nextResources[resource] = false;
				didChange = true;
			}
			return didChange ? nextResources : currentResources;
		});
	}

	function notifyRecordsCommitted(...sections: AssetSection[]): void {
		if (!onRecordsCommitted) {
			return;
		}

		onRecordsCommitted(Array.from(new Set(sections)));
	}

	function hasLoadedSectionResources(section: AssetSection): boolean {
		return SECTION_RESOURCES[section].every((resource) => loadedResources[resource]);
	}

	function startResourceRefresh(resource: AssetResource): boolean {
		if (loadingResourcesRef.current.has(resource)) {
			return false;
		}

		loadingResourcesRef.current.add(resource);
		return true;
	}

	function finishResourceRefresh(resource: AssetResource): void {
		loadingResourcesRef.current.delete(resource);
	}

	async function refreshCashAccounts(): Promise<void> {
		if (!startResourceRefresh("cashAccounts")) {
			return;
		}

		try {
			const refreshed = await cashCollection.refresh();
			if (refreshed) {
				markResourcesLoaded("cashAccounts");
			}
		} finally {
			finishResourceRefresh("cashAccounts");
		}
	}

	async function refreshHoldings(): Promise<void> {
		if (!startResourceRefresh("holdings")) {
			return;
		}

		try {
			const refreshed = await holdingCollection.refresh();
			if (refreshed) {
				markResourcesLoaded("holdings");
			}
		} finally {
			finishResourceRefresh("holdings");
		}
	}

	async function refreshHoldingTransactions(): Promise<void> {
		if (!startResourceRefresh("holdingTransactions")) {
			return;
		}

		if (!holdingTransactionActions?.onRefresh) {
			try {
				setHoldingTransactions(EMPTY_HOLDING_TRANSACTIONS);
				setHoldingTransactionsLoading(false);
				setHoldingTransactionsError(null);
				markResourcesLoaded("holdingTransactions");
				return;
			} finally {
				finishResourceRefresh("holdingTransactions");
			}
		}

		setHoldingTransactionsLoading(true);
		setHoldingTransactionsError(null);
		try {
			const items = await holdingTransactionActions.onRefresh();
			setHoldingTransactions(items);
			markResourcesLoaded("holdingTransactions");
		} catch (error) {
			setHoldingTransactionsError(
				error instanceof Error ? error.message : "加载投资交易记录失败。",
			);
		} finally {
			setHoldingTransactionsLoading(false);
			finishResourceRefresh("holdingTransactions");
		}
	}

	async function refreshCashAccountActivity(accountId: number): Promise<void> {
		setCashActivityLoading(true);
		setCashActivityError(null);
		try {
			if (cashLedgerAdjustmentActions?.onRefreshForAccount) {
				setCashActivityEntries(
					await cashLedgerAdjustmentActions.onRefreshForAccount(accountId),
				);
				return;
			}

			if (cashLedgerAdjustmentActions?.onRefresh) {
				const items = await cashLedgerAdjustmentActions.onRefresh();
				setCashActivityEntries(
					items.filter((entry) => entry.cash_account_id === accountId),
				);
				return;
			}

			setCashActivityEntries(EMPTY_CASH_LEDGER_ENTRIES);
		} catch (error) {
			setCashActivityError(
				error instanceof Error ? error.message : "加载账户记录失败。",
			);
		} finally {
			setCashActivityLoading(false);
		}
	}

	async function refreshFixedAssets(): Promise<void> {
		if (!startResourceRefresh("fixedAssets")) {
			return;
		}

		try {
			const refreshed = await fixedAssetCollection.refresh();
			if (refreshed) {
				markResourcesLoaded("fixedAssets");
			}
		} finally {
			finishResourceRefresh("fixedAssets");
		}
	}

	async function refreshLiabilities(): Promise<void> {
		if (!startResourceRefresh("liabilities")) {
			return;
		}

		try {
			const refreshed = await liabilityCollection.refresh();
			if (refreshed) {
				markResourcesLoaded("liabilities");
			}
		} finally {
			finishResourceRefresh("liabilities");
		}
	}

	async function refreshOtherAssets(): Promise<void> {
		if (!startResourceRefresh("otherAssets")) {
			return;
		}

		try {
			const refreshed = await otherAssetCollection.refresh();
			if (refreshed) {
				markResourcesLoaded("otherAssets");
			}
		} finally {
			finishResourceRefresh("otherAssets");
		}
	}

	async function refreshCashSection(): Promise<void> {
		const pendingRefreshes: Promise<void>[] = [];
		if (!loadedResources.cashAccounts) {
			pendingRefreshes.push(refreshCashAccounts());
		}
		await Promise.all(pendingRefreshes);
	}

	async function refreshInvestmentSection(): Promise<void> {
		const pendingRefreshes: Promise<void>[] = [];
		if (!loadedResources.cashAccounts) {
			pendingRefreshes.push(refreshCashAccounts());
		}
		if (!loadedResources.holdings) {
			pendingRefreshes.push(refreshHoldings());
		}
		if (!loadedResources.holdingTransactions) {
			pendingRefreshes.push(refreshHoldingTransactions());
		}
		await Promise.all(pendingRefreshes);
	}

	async function refreshFixedSection(): Promise<void> {
		if (!loadedResources.fixedAssets) {
			await refreshFixedAssets();
		}
	}

	async function refreshLiabilitySection(): Promise<void> {
		if (!loadedResources.liabilities) {
			await refreshLiabilities();
		}
	}

	async function refreshOtherSection(): Promise<void> {
		if (!loadedResources.otherAssets) {
			await refreshOtherAssets();
		}
	}

	useEffect(() => {
		const shouldRefreshSection =
			(!hasLoadedInitialSectionRef.current && loadOnMount) ||
			!hasLoadedSectionResources(activeSection);
		if (!shouldRefreshSection) {
			return;
		}

		if (!hasLoadedInitialSectionRef.current && loadOnMount) {
			hasLoadedInitialSectionRef.current = true;
		}

		switch (activeSection) {
			case "cash":
				void refreshCashSection();
				return;
			case "investment":
				void refreshInvestmentSection();
				return;
			case "fixed":
				void refreshFixedSection();
				return;
			case "liability":
				void refreshLiabilitySection();
				return;
			case "other":
				void refreshOtherSection();
				return;
		}
	}, [activeSection, loadOnMount, loadedResources]);

	useEffect(() => {
		if (cashCollection.editorMode !== "edit" || cashCollection.editingRecordId === null) {
			setCashActivityEntries(EMPTY_CASH_LEDGER_ENTRIES);
			setCashActivityLoading(false);
			setCashActivityError(null);
			return;
		}

		void refreshCashAccountActivity(cashCollection.editingRecordId);
	}, [cashCollection.editorMode, cashCollection.editingRecordId]);

	async function removeCashRecord(recordId: number): Promise<void> {
		const record = cashCollection.items.find((item) => item.id === recordId);
		if (!record) {
			return;
		}
		const removed = await cashCollection.remove(record);
		if (removed) {
			markResourcesLoaded("cashAccounts");
			notifyRecordsCommitted("cash");
		}
	}

	async function submitCashRecord(payload: CashAccountInput): Promise<void> {
		const saved = await cashCollection.submit(payload);
		if (saved) {
			markResourcesLoaded("cashAccounts");
			notifyRecordsCommitted("cash");
		}
	}

	async function createCashTransferRecord(payload: CashTransferInput): Promise<void> {
		if (!cashTransferActions?.onCreate) {
			throw new Error("当前未配置账户划转能力。");
		}

		setCashTransferError(null);
		setIsSubmittingCashTransfer(true);
		try {
			await cashTransferActions.onCreate(payload);
			await refreshCashAccounts();
			refreshVisibleCashAccountActivity();
			notifyRecordsCommitted("cash");
			closeCashTransferEditor();
		} finally {
			setIsSubmittingCashTransfer(false);
		}
	}

	async function submitCashTransferRecord(payload: CashTransferInput): Promise<void> {
		try {
			await createCashTransferRecord(payload);
		} catch (error) {
			setCashTransferError(
				error instanceof Error ? error.message : "新增账户划转失败，请稍后重试。",
			);
		}
	}

	async function submitHoldingRecord(payload: HoldingInput): Promise<void> {
		const isHoldingMetadataEdit = holdingCollection.editingRecordId !== null;
		const saved = await holdingCollection.submit(payload);
		if (!saved) {
			return;
		}

		if (isHoldingMetadataEdit) {
			await Promise.all([refreshHoldings(), refreshHoldingTransactions()]);
			notifyRecordsCommitted("investment");
			return;
		}

		const touchesCashAccounts =
			payload.side === "SELL" || payload.buy_funding_account_id !== undefined;
		await Promise.all([
			refreshHoldings(),
			refreshHoldingTransactions(),
			touchesCashAccounts ? refreshCashAccounts() : Promise.resolve(),
		]);
		if (touchesCashAccounts) {
			invalidateResources("cashTransfers", "cashLedger");
			refreshVisibleCashAccountActivity();
			notifyRecordsCommitted("cash", "investment");
			return;
		}

		notifyRecordsCommitted("investment");
	}

	async function removeHoldingRecord(recordId: number): Promise<void> {
		const record = holdingCollection.items.find((item) => item.id === recordId);
		if (!record) {
			return;
		}
		const removed = await holdingCollection.remove(record);
		if (removed) {
			await Promise.all([
				refreshCashAccounts(),
				refreshHoldings(),
				refreshHoldingTransactions(),
			]);
			invalidateResources("cashTransfers", "cashLedger");
			refreshVisibleCashAccountActivity();
			notifyRecordsCommitted("cash", "investment");
		}
	}

	async function submitFixedAssetRecord(payload: FixedAssetInput): Promise<void> {
		const saved = await fixedAssetCollection.submit(payload);
		if (saved) {
			markResourcesLoaded("fixedAssets");
			notifyRecordsCommitted("fixed");
		}
	}

	async function removeFixedAssetRecord(recordId: number): Promise<void> {
		const record = fixedAssetCollection.items.find((item) => item.id === recordId);
		if (!record) {
			return;
		}
		const removed = await fixedAssetCollection.remove(record);
		if (removed) {
			markResourcesLoaded("fixedAssets");
			notifyRecordsCommitted("fixed");
		}
	}

	async function submitLiabilityRecord(payload: LiabilityInput): Promise<void> {
		const saved = await liabilityCollection.submit(payload);
		if (saved) {
			markResourcesLoaded("liabilities");
			notifyRecordsCommitted("liability");
		}
	}

	async function removeLiabilityRecord(recordId: number): Promise<void> {
		const record = liabilityCollection.items.find((item) => item.id === recordId);
		if (!record) {
			return;
		}
		const removed = await liabilityCollection.remove(record);
		if (removed) {
			markResourcesLoaded("liabilities");
			notifyRecordsCommitted("liability");
		}
	}

	async function submitOtherAssetRecord(payload: OtherAssetInput): Promise<void> {
		const saved = await otherAssetCollection.submit(payload);
		if (saved) {
			markResourcesLoaded("otherAssets");
			notifyRecordsCommitted("other");
		}
	}

	async function removeOtherAssetRecord(recordId: number): Promise<void> {
		const record = otherAssetCollection.items.find((item) => item.id === recordId);
		if (!record) {
			return;
		}
		const removed = await otherAssetCollection.remove(record);
		if (removed) {
			markResourcesLoaded("otherAssets");
			notifyRecordsCommitted("other");
		}
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
	const isCashEditorVisible = isCashTransferEditorOpen || cashCollection.isEditorOpen;
	const isFixedAssetEditorVisible = fixedAssetCollection.isEditorOpen;
	const isLiabilityEditorVisible = liabilityCollection.isEditorOpen;
	const isOtherAssetEditorVisible = otherAssetCollection.isEditorOpen;

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
						{isCashTransferEditorOpen ? (
							<CashTransferPanel
								accounts={cashCollection.items}
								busy={isSubmittingCashTransfer}
								errorMessage={cashTransferError}
								maxStartedOnDate={maxStartedOnDate}
								fxRates={displayFxRates}
								onCreate={(payload) => submitCashTransferRecord(payload)}
								onCancel={closeCashTransferEditor}
							/>
						) : null}
						{cashCollection.isEditorOpen ? (
							<CashAccountForm
								mode={cashCollection.editorMode ?? "create"}
								resetKey={cashCollection.editorSessionKey}
								value={
									cashCollection.editorSeedRecord
										? toCashDraft(cashCollection.editorSeedRecord)
										: null
								}
								activityAccount={cashCollection.editingRecord}
								activityEntries={cashActivityEntries}
								activityLoading={cashActivityLoading}
								activityErrorMessage={cashActivityError}
								fxRates={displayFxRates}
								recordId={cashCollection.editingRecordId}
								busy={cashCollection.isSubmitting}
								errorMessage={cashCollection.errorMessage}
								onCreate={(payload) => submitCashRecord(payload)}
								onEdit={(_recordId, payload) => submitCashRecord(payload)}
								onDelete={(recordId) => removeCashRecord(recordId)}
								onCancel={closeCashEditor}
							/>
						) : null}
						{isCashEditorVisible ? null : (
							<CashAccountList
								accounts={cashCollection.items}
								loading={cashCollection.isRefreshing}
								busy={cashCollection.isSubmitting}
								errorMessage={cashCollection.errorMessage}
								onCreate={openCashCreateEditor}
								onTransfer={openCashTransferEditor}
								onEdit={(account) => openCashEditEditor(account)}
								onDelete={(recordId) => removeCashRecord(recordId)}
							/>
						)}
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
								fxRates={displayFxRates}
								onCreate={(payload) => submitHoldingRecord(payload)}
								onEdit={(_recordId, payload) => submitHoldingRecord(payload)}
								onDelete={(recordId) => removeHoldingRecord(recordId)}
								onSearch={holdingActions?.onSearch}
								onMergeDuplicate={holdingActions?.onMergeDuplicate}
								onCancel={closeHoldingEditor}
							/>
						) : (
							<>
								<HoldingList
									holdings={holdingCollection.items}
									loading={holdingCollection.isRefreshing}
									busy={holdingCollection.isSubmitting}
									errorMessage={holdingCollection.errorMessage}
									onCreateBuy={openHoldingBuyEditor}
									onCreateSell={
										holdingCollection.items.length === 0
											? undefined
											: openHoldingSellEditor
									}
									onEdit={(holding) => openHoldingEditEditor(holding)}
								/>
								<HoldingTransactionHistory
									transactions={holdingTransactions}
									loading={holdingTransactionsLoading}
									errorMessage={holdingTransactionsError}
								/>
							</>
						)}
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
								onCreate={(payload) => submitFixedAssetRecord(payload)}
								onEdit={(_recordId, payload) => submitFixedAssetRecord(payload)}
								onDelete={(recordId) => removeFixedAssetRecord(recordId)}
								onCancel={fixedAssetCollection.closeEditor}
							/>
						) : null}
						{isFixedAssetEditorVisible ? null : (
							<FixedAssetList
								assets={fixedAssetCollection.items}
								loading={fixedAssetCollection.isRefreshing}
								busy={fixedAssetCollection.isSubmitting}
								errorMessage={fixedAssetCollection.errorMessage}
								onCreate={fixedAssetCollection.openCreate}
								onEdit={(asset) => fixedAssetCollection.openEdit(asset)}
								onDelete={(recordId) => removeFixedAssetRecord(recordId)}
							/>
						)}
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
								fxRates={displayFxRates}
								fxToCny={liabilityCollection.editingRecord?.fx_to_cny ?? null}
								onCreate={(payload) => submitLiabilityRecord(payload)}
								onEdit={(_recordId, payload) => submitLiabilityRecord(payload)}
								onDelete={(recordId) => removeLiabilityRecord(recordId)}
								onCancel={liabilityCollection.closeEditor}
							/>
						) : null}
						{isLiabilityEditorVisible ? null : (
							<LiabilityList
								liabilities={liabilityCollection.items}
								loading={liabilityCollection.isRefreshing}
								busy={liabilityCollection.isSubmitting}
								errorMessage={liabilityCollection.errorMessage}
								onCreate={liabilityCollection.openCreate}
								onEdit={(entry) => liabilityCollection.openEdit(entry)}
								onDelete={(recordId) => removeLiabilityRecord(recordId)}
							/>
						)}
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
								onCreate={(payload) => submitOtherAssetRecord(payload)}
								onEdit={(_recordId, payload) => submitOtherAssetRecord(payload)}
								onDelete={(recordId) => removeOtherAssetRecord(recordId)}
								onCancel={otherAssetCollection.closeEditor}
							/>
						) : null}
						{isOtherAssetEditorVisible ? null : (
							<OtherAssetList
								assets={otherAssetCollection.items}
								loading={otherAssetCollection.isRefreshing}
								busy={otherAssetCollection.isSubmitting}
								errorMessage={otherAssetCollection.errorMessage}
								onCreate={otherAssetCollection.openCreate}
								onEdit={(asset) => otherAssetCollection.openEdit(asset)}
								onDelete={(recordId) => removeOtherAssetRecord(recordId)}
							/>
						)}
					</>
				) : null}
			</div>
		</section>
	);
}
