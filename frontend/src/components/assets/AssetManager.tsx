import { useEffect, useState } from "react";
import { CashAccountForm } from "./CashAccountForm";
import { CashAccountList } from "./CashAccountList";
import { HoldingForm } from "./HoldingForm";
import { HoldingList } from "./HoldingList";
import { useAssetCollection } from "../../hooks/useAssetCollection";
import type {
	AssetManagerController,
	CashAccountFormDraft,
	CashAccountInput,
	CashAccountRecord,
	HoldingFormDraft,
	HoldingInput,
	HoldingRecord,
} from "../../types/assets";

type AssetSection = "cash" | "holding";

export interface AssetManagerProps {
	initialCashAccounts?: CashAccountRecord[];
	initialHoldings?: HoldingRecord[];
	cashActions?: AssetManagerController["cashAccounts"];
	holdingActions?: AssetManagerController["holdings"];
	defaultSection?: AssetSection;
	title?: string;
	description?: string;
	autoRefreshOnMount?: boolean;
}

function toCashDraft(record: CashAccountRecord): CashAccountFormDraft {
	return {
		name: record.name,
		platform: record.platform,
		currency: record.currency,
		balance: String(record.balance),
		account_type: record.account_type,
		note: record.note ?? "",
	};
}

function toHoldingDraft(record: HoldingRecord): HoldingFormDraft {
	return {
		symbol: record.symbol,
		name: record.name,
		quantity: String(record.quantity),
		fallback_currency: record.fallback_currency,
		market: record.market,
		broker: record.broker ?? "",
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
		price: null,
		price_currency: payload.fallback_currency,
		value_cny: 0,
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
		price_currency: currentRecord.price_currency ?? payload.fallback_currency,
	};
}

export function AssetManager({
	initialCashAccounts = [],
	initialHoldings = [],
	cashActions,
	holdingActions,
	defaultSection = "cash",
	title = "资产管理组件",
	description = "拆分成可独立接入的录入与列表模块，先把移动端操作基础打稳。",
	autoRefreshOnMount = false,
}: AssetManagerProps) {
	const [activeSection, setActiveSection] = useState<AssetSection>(defaultSection);

	const cashCollection = useAssetCollection({
		initialItems: initialCashAccounts,
		actions: cashActions,
		createLocalRecord: createLocalCashAccount,
		updateLocalRecord: updateLocalCashAccount,
	});

	const holdingCollection = useAssetCollection({
		initialItems: initialHoldings,
		actions: holdingActions,
		createLocalRecord: createLocalHolding,
		updateLocalRecord: updateLocalHolding,
	});

	useEffect(() => {
		if (!autoRefreshOnMount) {
			return;
		}

		void cashCollection.refresh();
		void holdingCollection.refresh();
	}, [autoRefreshOnMount]);

	async function handleCashDelete(recordId: number): Promise<void> {
		const targetAccount = cashCollection.items.find((item) => item.id === recordId);
		if (!targetAccount) {
			return;
		}

		await cashCollection.remove(targetAccount);
	}

	async function handleHoldingDelete(recordId: number): Promise<void> {
		const targetHolding = holdingCollection.items.find((item) => item.id === recordId);
		if (!targetHolding) {
			return;
		}

		await holdingCollection.remove(targetHolding);
	}

	const cashFormMode =
		cashCollection.editingRecord !== null ? "edit" : "create";
	const holdingFormMode =
		holdingCollection.editingRecord !== null ? "edit" : "create";
	const showCashEditor =
		cashCollection.isEditorOpen || cashCollection.items.length === 0;
	const showHoldingEditor =
		holdingCollection.isEditorOpen || holdingCollection.items.length === 0;

	return (
		<section className="asset-manager">
			<header className="asset-manager__header">
				<div>
					<p className="asset-manager__eyebrow">ASSET MODULES</p>
					<h2>{title}</h2>
					<p>{description}</p>
				</div>
				<div className="asset-manager__summary">
					<div className="asset-manager__summary-card is-cash">
						<span>现金账户</span>
						<strong>{cashCollection.items.length}</strong>
					</div>
					<div className="asset-manager__summary-card is-holding">
						<span>证券持仓</span>
						<strong>{holdingCollection.items.length}</strong>
					</div>
				</div>
			</header>

			<div className="asset-manager__toolbar" role="tablist" aria-label="资产类型切换">
				<button
					type="button"
					className={activeSection === "cash" ? "is-active" : undefined}
					onClick={() => setActiveSection("cash")}
				>
					现金
				</button>
				<button
					type="button"
					className={activeSection === "holding" ? "is-active" : undefined}
					onClick={() => setActiveSection("holding")}
				>
					证券
				</button>
			</div>

			<div className="asset-manager__workspace">
				{activeSection === "cash" ? (
					<>
						{showCashEditor ? (
							<CashAccountForm
								mode={cashFormMode}
								value={
									cashCollection.editingRecord
										? toCashDraft(cashCollection.editingRecord)
										: null
								}
								recordId={cashCollection.editingRecord?.id ?? null}
								subtitle="支持账户类型、备注与完整 CRUD，方便在手机上快速维护。"
								busy={cashCollection.isSubmitting}
								refreshing={cashCollection.isRefreshing}
								errorMessage={cashCollection.errorMessage}
								onCreate={(payload) => cashCollection.submit(payload)}
								onEdit={(_recordId, payload) => cashCollection.submit(payload)}
								onDelete={(recordId) => handleCashDelete(recordId)}
								onRefresh={() => cashCollection.refresh()}
								onCancel={cashCollection.closeEditor}
							/>
						) : null}

						<CashAccountList
							accounts={cashCollection.items}
							loading={cashCollection.isRefreshing}
							busy={cashCollection.isSubmitting}
							errorMessage={cashCollection.errorMessage}
							onCreate={cashCollection.openCreate}
							onEdit={(account) => cashCollection.openEdit(account)}
							onDelete={(recordId) => handleCashDelete(recordId)}
							onRefresh={() => cashCollection.refresh()}
						/>
					</>
				) : (
					<>
						{showHoldingEditor ? (
							<HoldingForm
								mode={holdingFormMode}
								value={
									holdingCollection.editingRecord
										? toHoldingDraft(holdingCollection.editingRecord)
										: null
								}
								recordId={holdingCollection.editingRecord?.id ?? null}
								subtitle="支持市场、券商与备注字段，便于完整管理港股、美股和基金。"
								busy={holdingCollection.isSubmitting}
								refreshing={holdingCollection.isRefreshing}
								errorMessage={holdingCollection.errorMessage}
								onCreate={(payload) => holdingCollection.submit(payload)}
								onEdit={(_recordId, payload) => holdingCollection.submit(payload)}
								onDelete={(recordId) => handleHoldingDelete(recordId)}
								onRefresh={() => holdingCollection.refresh()}
								onCancel={holdingCollection.closeEditor}
							/>
						) : null}

						<HoldingList
							holdings={holdingCollection.items}
							loading={holdingCollection.isRefreshing}
							busy={holdingCollection.isSubmitting}
							errorMessage={holdingCollection.errorMessage}
							onCreate={holdingCollection.openCreate}
							onEdit={(holding) => holdingCollection.openEdit(holding)}
							onDelete={(recordId) => handleHoldingDelete(recordId)}
							onRefresh={() => holdingCollection.refresh()}
						/>
					</>
				)}
			</div>
		</section>
	);
}
