import { useEffect, useState } from "react";
import { CashAccountForm } from "./CashAccountForm";
import { CashAccountList } from "./CashAccountList";
import { FixedAssetForm } from "./FixedAssetForm";
import { FixedAssetList } from "./FixedAssetList";
import { HoldingForm } from "./HoldingForm";
import { HoldingList } from "./HoldingList";
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
	FixedAssetFormDraft,
	FixedAssetInput,
	FixedAssetRecord,
	HoldingFormDraft,
	HoldingInput,
	HoldingRecord,
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
const EMPTY_HOLDINGS: HoldingRecord[] = [];
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
	holdingActions?: AssetManagerController["holdings"];
	fixedAssetActions?: AssetManagerController["fixedAssets"];
	liabilityActions?: AssetManagerController["liabilities"];
	otherAssetActions?: AssetManagerController["otherAssets"];
	defaultSection?: AssetSection;
	title?: string;
	description?: string;
	autoRefreshOnMount?: boolean;
	refreshToken?: number;
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
		symbol: record.symbol,
		name: record.name,
		quantity: String(record.quantity),
		fallback_currency: record.fallback_currency,
		cost_basis_price: record.cost_basis_price != null ? String(record.cost_basis_price) : "",
		market: record.market,
		broker: record.broker ?? "",
		started_on: record.started_on ?? "",
		note: record.note ?? "",
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

function createLocalHolding(payload: HoldingInput, nextId: number): HoldingRecord {
	return {
		id: nextId,
		...payload,
		broker: payload.broker,
		note: payload.note,
		cost_basis_price: payload.cost_basis_price,
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
		...payload,
		broker: payload.broker,
		note: payload.note,
		cost_basis_price: payload.cost_basis_price,
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
	holdingActions,
	fixedAssetActions,
	liabilityActions,
	otherAssetActions,
	defaultSection = "cash",
	title = "资产管理",
	description,
	autoRefreshOnMount = false,
	refreshToken = 0,
}: AssetManagerProps) {
	const [activeSection, setActiveSection] = useState<AssetSection>(defaultSection);
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

	async function removeCashRecord(recordId: number): Promise<void> {
		const record = cashCollection.items.find((item) => item.id === recordId);
		if (!record) {
			return;
		}
		await cashCollection.remove(record);
	}

	async function removeHoldingRecord(recordId: number): Promise<void> {
		const record = holdingCollection.items.find((item) => item.id === recordId);
		if (!record) {
			return;
		}
		await holdingCollection.remove(record);
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
								mode={cashCollection.editingRecord ? "edit" : "create"}
								value={
									cashCollection.editingRecord
										? toCashDraft(cashCollection.editingRecord)
										: null
								}
								recordId={cashCollection.editingRecord?.id ?? null}
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
					</>
				) : null}

				{activeSection === "investment" ? (
					<>
						{holdingCollection.isEditorOpen ? (
							<HoldingForm
								mode={holdingCollection.editingRecord ? "edit" : "create"}
								value={
									holdingCollection.editingRecord
										? toHoldingDraft(holdingCollection.editingRecord)
										: null
								}
								recordId={holdingCollection.editingRecord?.id ?? null}
								busy={holdingCollection.isSubmitting}
								errorMessage={holdingCollection.errorMessage}
								onCreate={(payload) => holdingCollection.submit(payload)}
								onEdit={(_recordId, payload) => holdingCollection.submit(payload)}
								onDelete={(recordId) => removeHoldingRecord(recordId)}
								onSearch={holdingActions?.onSearch}
								onCancel={holdingCollection.closeEditor}
							/>
						) : null}
						<HoldingList
							holdings={holdingCollection.items}
							loading={holdingCollection.isRefreshing}
							busy={holdingCollection.isSubmitting}
							errorMessage={holdingCollection.errorMessage}
							onCreate={holdingCollection.isEditorOpen ? undefined : holdingCollection.openCreate}
							onEdit={(holding) => holdingCollection.openEdit(holding)}
							onDelete={(recordId) => removeHoldingRecord(recordId)}
						/>
					</>
				) : null}

				{activeSection === "fixed" ? (
					<>
						{fixedAssetCollection.isEditorOpen ? (
							<FixedAssetForm
								mode={fixedAssetCollection.editingRecord ? "edit" : "create"}
								value={
									fixedAssetCollection.editingRecord
										? toFixedAssetDraft(fixedAssetCollection.editingRecord)
										: null
								}
								recordId={fixedAssetCollection.editingRecord?.id ?? null}
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
								mode={liabilityCollection.editingRecord ? "edit" : "create"}
								value={
									liabilityCollection.editingRecord
										? toLiabilityDraft(liabilityCollection.editingRecord)
										: null
								}
								recordId={liabilityCollection.editingRecord?.id ?? null}
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
								mode={otherAssetCollection.editingRecord ? "edit" : "create"}
								value={
									otherAssetCollection.editingRecord
										? toOtherAssetDraft(otherAssetCollection.editingRecord)
										: null
								}
								recordId={otherAssetCollection.editingRecord?.id ?? null}
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
