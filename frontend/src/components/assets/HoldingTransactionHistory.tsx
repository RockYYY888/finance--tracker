import { useEffect, useMemo, useState } from "react";
import "./asset-components.css";
import { DatePickerField } from "./DatePickerField";
import {
	formatDateValue,
	formatMoneyAmount,
	formatPriceAmount,
	formatQuantity,
} from "../../lib/assetFormatting";
import { toErrorMessage } from "../../lib/apiClient";
import type {
	CashAccountRecord,
	HoldingTransactionRecord,
	HoldingTransactionUpdateInput,
	MaybePromise,
	SellProceedsHandling,
} from "../../types/assets";

const SELL_PROCEEDS_OPTIONS: Array<{
	value: SellProceedsHandling;
	label: string;
}> = [
	{ value: "DISCARD", label: "不登记到现金账户" },
	{ value: "ADD_TO_EXISTING_CASH", label: "并入现有现金账户" },
	{ value: "CREATE_NEW_CASH", label: "自动新建现金账户" },
];

type TransactionDraft = {
	quantity: string;
	price: string;
	traded_on: string;
	note: string;
	sell_proceeds_handling: SellProceedsHandling;
	sell_proceeds_account_id: string;
	buy_funding_account_id: string;
};

export interface HoldingTransactionHistoryProps {
	transactions: HoldingTransactionRecord[];
	cashAccounts: CashAccountRecord[];
	loading?: boolean;
	busy?: boolean;
	errorMessage?: string | null;
	maxStartedOnDate?: string;
	onEdit?: (
		recordId: number,
		payload: HoldingTransactionUpdateInput,
	) => MaybePromise<HoldingTransactionRecord>;
	onDelete?: (recordId: number) => MaybePromise<void>;
}

function createDraft(transaction: HoldingTransactionRecord): TransactionDraft {
	return {
		quantity: String(transaction.quantity),
		price: transaction.price != null ? String(transaction.price) : "",
		traded_on: transaction.traded_on,
		note: transaction.note ?? "",
		sell_proceeds_handling: transaction.sell_proceeds_handling ?? "CREATE_NEW_CASH",
		sell_proceeds_account_id: transaction.sell_proceeds_account_id != null
			? String(transaction.sell_proceeds_account_id)
			: "",
		buy_funding_account_id: transaction.buy_funding_account_id != null
			? String(transaction.buy_funding_account_id)
			: "",
	};
}

export function HoldingTransactionHistory({
	transactions,
	cashAccounts,
	loading = false,
	busy = false,
	errorMessage = null,
	maxStartedOnDate,
	onEdit,
	onDelete,
}: HoldingTransactionHistoryProps) {
	const [editingId, setEditingId] = useState<number | null>(null);
	const [draft, setDraft] = useState<TransactionDraft | null>(null);
	const [localError, setLocalError] = useState<string | null>(null);
	const [isWorking, setIsWorking] = useState(false);
	const effectiveError = localError ?? errorMessage;
	const editingTransaction = useMemo(
		() => transactions.find((transaction) => transaction.id === editingId) ?? null,
		[editingId, transactions],
	);

	useEffect(() => {
		if (editingTransaction == null) {
			return;
		}
		setDraft((currentDraft) => currentDraft ?? createDraft(editingTransaction));
	}, [editingTransaction]);

	function openEditor(transaction: HoldingTransactionRecord): void {
		setLocalError(null);
		setEditingId(transaction.id);
		setDraft(createDraft(transaction));
	}

	function closeEditor(): void {
		setLocalError(null);
		setEditingId(null);
		setDraft(null);
	}

	function updateDraft<K extends keyof TransactionDraft>(
		field: K,
		nextValue: TransactionDraft[K],
	): void {
		setLocalError(null);
		setDraft((currentDraft) =>
			currentDraft == null
				? currentDraft
				: {
					...currentDraft,
					[field]: nextValue,
				},
		);
	}

	async function handleSave(transaction: HoldingTransactionRecord): Promise<void> {
		if (!onEdit || draft == null) {
			return;
		}

		try {
			const quantity = Number(draft.quantity);
			if (!Number.isFinite(quantity) || quantity <= 0) {
				throw new Error("请输入有效的交易数量。");
			}
			const payload: HoldingTransactionUpdateInput = {
				quantity,
				traded_on: draft.traded_on,
				note: draft.note.trim() || undefined,
			};
			if (draft.price.trim()) {
				const price = Number(draft.price);
				if (!Number.isFinite(price) || price <= 0) {
					throw new Error("请输入有效的成交价。");
				}
				payload.price = price;
			}

			if (transaction.side === "SELL") {
				payload.sell_proceeds_handling = draft.sell_proceeds_handling;
				if (draft.sell_proceeds_handling === "ADD_TO_EXISTING_CASH") {
					if (!draft.sell_proceeds_account_id) {
						throw new Error("请选择一个已有现金账户来接收卖出回款。");
					}
					payload.sell_proceeds_account_id = Number(draft.sell_proceeds_account_id);
				}
			}

			if (transaction.side === "BUY") {
				if (draft.buy_funding_account_id) {
					payload.buy_funding_handling = "DEDUCT_FROM_EXISTING_CASH";
					payload.buy_funding_account_id = Number(draft.buy_funding_account_id);
				}
			}

			setIsWorking(true);
			await onEdit(transaction.id, payload);
			closeEditor();
		} catch (error) {
			setLocalError(toErrorMessage(error, "修正交易记录失败，请稍后重试。"));
		} finally {
			setIsWorking(false);
		}
	}

	async function handleDelete(transactionId: number): Promise<void> {
		if (!onDelete) {
			return;
		}

		try {
			setIsWorking(true);
			await onDelete(transactionId);
			if (editingId === transactionId) {
				closeEditor();
			}
		} catch (error) {
			setLocalError(toErrorMessage(error, "删除交易记录失败，请稍后重试。"));
		} finally {
			setIsWorking(false);
		}
	}

	return (
		<section className="asset-manager__panel">
			<div className="asset-manager__list-head">
				<div>
					<p className="asset-manager__eyebrow">TRANSACTION HISTORY</p>
					<h3>交易记录</h3>
					<p>逐笔交易是持仓与收益曲线的事实源，修改这里的记录会同步更新相关结果。</p>
				</div>
			</div>

			{effectiveError ? (
				<div className="asset-manager__message asset-manager__message--error">
					{effectiveError}
				</div>
			) : null}

			{loading ? (
				<div className="asset-manager__empty-state">正在加载交易记录...</div>
			) : transactions.length === 0 ? (
				<div className="asset-manager__empty-state">还没有投资交易记录。</div>
			) : (
				<ul className="asset-manager__list">
					{transactions.map((transaction) => {
						const isEditing = transaction.id === editingId && draft != null;

						return (
							<li key={transaction.id} className="asset-manager__card">
								<div className="asset-manager__card-top">
									<div className="asset-manager__card-title">
										<div className="asset-manager__badge-row">
											<span className="asset-manager__badge">{transaction.side}</span>
											<span className="asset-manager__badge">{transaction.market}</span>
										</div>
										<h3>
											{transaction.name} ({transaction.symbol})
										</h3>
										<p className="asset-manager__card-note">
											{transaction.note?.trim() || `交易 ID #${transaction.id}`}
										</p>
									</div>
									<div className="asset-manager__card-actions">
										{!isEditing ? (
											<button
												type="button"
												className="asset-manager__button asset-manager__button--secondary"
												onClick={() => openEditor(transaction)}
												disabled={busy || isWorking}
											>
												修正记录
											</button>
										) : null}
									</div>
								</div>

								{isEditing ? (
									<div className="asset-manager__form">
										<div className="asset-manager__field-grid">
											<label className="asset-manager__field">
												<span>数量</span>
												<input
													type="text"
													inputMode="decimal"
													value={draft.quantity}
													onChange={(event) =>
														updateDraft("quantity", event.target.value)
													}
												/>
											</label>
											<label className="asset-manager__field">
												<span>成交价</span>
												<input
													type="text"
													inputMode="decimal"
													value={draft.price}
													onChange={(event) =>
														updateDraft("price", event.target.value)
													}
												/>
											</label>
											<label className="asset-manager__field">
												<span>交易日</span>
												<DatePickerField
													value={draft.traded_on}
													onChange={(nextValue) =>
														updateDraft("traded_on", nextValue)
													}
													maxDate={maxStartedOnDate}
													placeholder="选择交易日"
												/>
											</label>
										</div>

										{transaction.side === "SELL" ? (
											<div className="asset-manager__field-grid">
												<label className="asset-manager__field">
													<span>卖出回款去向</span>
													<select
														value={draft.sell_proceeds_handling}
														onChange={(event) => {
															const nextHandling =
																event.target.value as SellProceedsHandling;
															updateDraft("sell_proceeds_handling", nextHandling);
															if (nextHandling !== "ADD_TO_EXISTING_CASH") {
																updateDraft("sell_proceeds_account_id", "");
															}
														}}
													>
														{SELL_PROCEEDS_OPTIONS.map((option) => (
															<option key={option.value} value={option.value}>
																{option.label}
															</option>
														))}
													</select>
												</label>

												{draft.sell_proceeds_handling === "ADD_TO_EXISTING_CASH" ? (
													<label className="asset-manager__field">
														<span>目标现金账户</span>
														<select
															value={draft.sell_proceeds_account_id}
															onChange={(event) =>
																updateDraft(
																	"sell_proceeds_account_id",
																	event.target.value,
																)
															}
														>
															<option value="">请选择</option>
															{cashAccounts.map((account) => (
																<option key={account.id} value={String(account.id)}>
																	{account.name} ·{" "}
																	{formatMoneyAmount(account.balance, account.currency)}
																</option>
															))}
														</select>
													</label>
												) : null}
											</div>
										) : null}

										{transaction.side === "BUY" ? (
											<label className="asset-manager__field">
												<span>扣款现金账户</span>
												<select
													value={draft.buy_funding_account_id}
													onChange={(event) =>
														updateDraft("buy_funding_account_id", event.target.value)
													}
												>
													<option value="">不登记到现金账户</option>
													{cashAccounts.map((account) => (
														<option key={account.id} value={String(account.id)}>
															{account.name} ·{" "}
															{formatMoneyAmount(account.balance, account.currency)}
														</option>
													))}
												</select>
											</label>
										) : null}

										<label className="asset-manager__field">
											<span>备注</span>
											<textarea
												value={draft.note}
												onChange={(event) => updateDraft("note", event.target.value)}
												placeholder="可选"
											/>
										</label>

										<div className="asset-manager__form-actions">
											<button
												type="button"
												className="asset-manager__button asset-manager__button--legacy-add"
												onClick={() => void handleSave(transaction)}
												disabled={busy || isWorking}
											>
												{busy || isWorking ? "保存中..." : "保存修正"}
											</button>
											<button
												type="button"
												className="asset-manager__button asset-manager__button--secondary"
												onClick={closeEditor}
												disabled={busy || isWorking}
											>
												取消
											</button>
											{onDelete ? (
												<button
													type="button"
													className="asset-manager__button asset-manager__button--legacy-delete"
													onClick={() => void handleDelete(transaction.id)}
													disabled={busy || isWorking}
												>
													删除记录
												</button>
											) : null}
										</div>
									</div>
								) : (
									<div className="asset-manager__metric-grid">
										<div className="asset-manager__metric">
											<span>数量</span>
											<strong>{formatQuantity(transaction.quantity)}</strong>
										</div>
										<div className="asset-manager__metric">
											<span>成交价</span>
											<strong>
												{transaction.price != null
													? formatPriceAmount(
														transaction.price,
														transaction.fallback_currency,
													)
													: "未填写"}
											</strong>
										</div>
										<div className="asset-manager__metric">
											<span>交易日</span>
											<strong>{formatDateValue(transaction.traded_on)}</strong>
										</div>
									</div>
								)}
							</li>
						);
					})}
				</ul>
			)}
		</section>
	);
}
