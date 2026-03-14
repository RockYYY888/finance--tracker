import { useMemo, useState } from "react";
import "./asset-components.css";
import {
	formatDateValue,
	formatMoneyAmount,
} from "../../lib/assetFormatting";
import type {
	CashAccountRecord,
	CashLedgerEntryRecord,
} from "../../types/assets";
import { getCollectionLoadingState } from "./loadingState";

type CashActivityFilter = "ALL" | "TRANSFER" | "TRADE" | "BALANCE";

const CASH_ACTIVITY_FILTER_OPTIONS: Array<{
	value: CashActivityFilter;
	label: string;
}> = [
	{ value: "ALL", label: "全部" },
	{ value: "TRANSFER", label: "划转" },
	{ value: "TRADE", label: "交易" },
	{ value: "BALANCE", label: "余额修正" },
];

function getActivityFilter(entry: CashLedgerEntryRecord): CashActivityFilter {
	switch (entry.entry_type) {
		case "TRANSFER_IN":
		case "TRANSFER_OUT":
			return "TRANSFER";
		case "BUY_FUNDING":
		case "SELL_PROCEEDS":
			return "TRADE";
		case "INITIAL_BALANCE":
		case "MANUAL_ADJUSTMENT":
		default:
			return "BALANCE";
	}
}

function getActivityTitle(entry: CashLedgerEntryRecord): string {
	switch (entry.entry_type) {
		case "TRANSFER_IN":
			return "转入";
		case "TRANSFER_OUT":
			return "转出";
		case "BUY_FUNDING":
			return "买入扣款";
		case "SELL_PROCEEDS":
			return "卖出回款";
		case "INITIAL_BALANCE":
			return "余额修正";
		case "MANUAL_ADJUSTMENT":
		default:
			return "账本修正";
	}
}

function getActivityBadge(entry: CashLedgerEntryRecord): string {
	switch (entry.entry_type) {
		case "TRANSFER_IN":
		case "TRANSFER_OUT":
			return "TRANSFER";
		case "BUY_FUNDING":
		case "SELL_PROCEEDS":
			return "TRADE";
		case "INITIAL_BALANCE":
		case "MANUAL_ADJUSTMENT":
		default:
			return "BALANCE";
	}
}

export interface CashAccountActivityListProps {
	account: CashAccountRecord;
	entries: CashLedgerEntryRecord[];
	loading?: boolean;
	errorMessage?: string | null;
}

export function CashAccountActivityList({
	account,
	entries,
	loading = false,
	errorMessage = null,
}: CashAccountActivityListProps) {
	const [activeFilter, setActiveFilter] = useState<CashActivityFilter>("ALL");
	const filteredEntries = useMemo(
		() =>
			activeFilter === "ALL"
				? entries
				: entries.filter((entry) => getActivityFilter(entry) === activeFilter),
		[activeFilter, entries],
	);
	const { showBlockingLoader, showRefreshingHint } = getCollectionLoadingState(
		loading,
		filteredEntries.length,
	);

	return (
		<section className="asset-manager__panel">
			<div className="asset-manager__list-head">
				<div>
					<p className="asset-manager__eyebrow">CASH ACTIVITY</p>
					<h3>账户变动记录</h3>
					<p>{account.name} 的划转、交易回款与余额修正都会记录在这里。</p>
				</div>
			</div>

			<div className="asset-manager__filter-row" role="tablist" aria-label="现金账户记录筛选">
				{CASH_ACTIVITY_FILTER_OPTIONS.map((option) => (
					<button
						key={option.value}
						type="button"
						role="tab"
						aria-selected={activeFilter === option.value}
						className={`asset-manager__filter-chip ${
							activeFilter === option.value ? "is-active" : ""
						}`}
						onClick={() => setActiveFilter(option.value)}
					>
						{option.label}
					</button>
				))}
			</div>

			{errorMessage ? (
				<div className="asset-manager__message asset-manager__message--error">
					{errorMessage}
				</div>
			) : null}

			{showRefreshingHint ? (
				<div className="asset-manager__status-note" role="status" aria-live="polite">
					正在更新账户记录...
				</div>
			) : null}

			{showBlockingLoader ? (
				<div className="asset-manager__empty-state">正在加载账户记录...</div>
			) : filteredEntries.length === 0 ? (
				<div className="asset-manager__empty-state">当前筛选下还没有记录。</div>
			) : (
				<ul className="asset-manager__list">
					{filteredEntries.map((entry) => (
						<li key={entry.id} className="asset-manager__card">
							<div className="asset-manager__card-top">
								<div className="asset-manager__card-title">
									<div className="asset-manager__badge-row">
										<span className="asset-manager__badge">
											{getActivityBadge(entry)}
										</span>
									</div>
									<h3>{getActivityTitle(entry)}</h3>
									<p className="asset-manager__card-note">
										{entry.note?.trim() || `记录 #${entry.id}`}
									</p>
								</div>
							</div>

							<div className="asset-manager__metric-grid">
								<div className="asset-manager__metric">
									<span>金额</span>
									<strong>{formatMoneyAmount(entry.amount, entry.currency)}</strong>
								</div>
								<div className="asset-manager__metric">
									<span>日期</span>
									<strong>{formatDateValue(entry.happened_on)}</strong>
								</div>
								<div className="asset-manager__metric">
									<span>来源</span>
									<strong>
										{entry.cash_transfer_id != null
											? `划转 #${entry.cash_transfer_id}`
											: entry.holding_transaction_id != null
												? `交易 #${entry.holding_transaction_id}`
												: "账户余额"}
									</strong>
								</div>
							</div>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
