import { useEffect, useMemo, useState } from "react";
import "./asset-components.css";
import { DatePickerField } from "./DatePickerField";
import { formatMoneyAmount } from "../../lib/assetFormatting";
import { useAutoRefreshGuard } from "../../lib/autoRefreshGuards";
import { toErrorMessage } from "../../lib/apiClient";
import type {
	CashAccountRecord,
	CashTransferFormDraft,
	CashTransferInput,
	MaybePromise,
} from "../../types/assets";
import { DEFAULT_CASH_TRANSFER_FORM_DRAFT } from "../../types/assets";

export interface CashTransferPanelProps {
	accounts: CashAccountRecord[];
	busy?: boolean;
	errorMessage?: string | null;
	maxStartedOnDate?: string;
	onCreate?: (payload: CashTransferInput) => MaybePromise<unknown>;
	onCancel?: () => void;
}

function getTodayDateValue(): string {
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function createTransferDraft(maxStartedOnDate?: string): CashTransferFormDraft {
	return {
		...DEFAULT_CASH_TRANSFER_FORM_DRAFT,
		transferred_on: maxStartedOnDate ?? getTodayDateValue(),
	};
}

function clampTransferAmount(nextValue: string, maxValue?: number): string {
	if (!nextValue.trim() || maxValue == null || !Number.isFinite(maxValue) || maxValue <= 0) {
		return nextValue;
	}

	const parsedValue = Number(nextValue);
	if (!Number.isFinite(parsedValue) || parsedValue <= maxValue) {
		return nextValue;
	}

	return String(maxValue);
}

export function CashTransferPanel({
	accounts,
	busy = false,
	errorMessage = null,
	maxStartedOnDate,
	onCreate,
	onCancel,
}: CashTransferPanelProps) {
	const [draft, setDraft] = useState<CashTransferFormDraft>(() =>
		createTransferDraft(maxStartedOnDate),
	);
	const [localError, setLocalError] = useState<string | null>(null);
	const [isWorking, setIsWorking] = useState(false);
	const effectiveError = localError ?? errorMessage;
	const sourceAccount = useMemo(
		() => accounts.find((account) => String(account.id) === draft.from_account_id) ?? null,
		[accounts, draft.from_account_id],
	);
	const targetAccount = useMemo(
		() => accounts.find((account) => String(account.id) === draft.to_account_id) ?? null,
		[accounts, draft.to_account_id],
	);
	useAutoRefreshGuard(true, "cash-transfer-form");

	useEffect(() => {
		if (draft.transferred_on) {
			return;
		}

		setDraft((currentDraft) => ({
			...currentDraft,
			transferred_on: maxStartedOnDate ?? getTodayDateValue(),
		}));
	}, [draft.transferred_on, maxStartedOnDate]);

	function updateDraft<K extends keyof CashTransferFormDraft>(
		field: K,
		nextValue: CashTransferFormDraft[K],
	): void {
		setLocalError(null);
		setDraft((currentDraft) => ({
			...currentDraft,
			[field]: nextValue,
		}));
	}

	async function handleSubmit(): Promise<void> {
		if (!onCreate) {
			return;
		}

		try {
			if (!draft.from_account_id || !draft.to_account_id) {
				throw new Error("请选择转出账户和转入账户。");
			}
			if (draft.from_account_id === draft.to_account_id) {
				throw new Error("转出账户和转入账户不能相同。");
			}

			const sourceAmount = Number(draft.source_amount);
			if (!Number.isFinite(sourceAmount) || sourceAmount <= 0) {
				throw new Error("请输入有效的划转金额。");
			}
			if (sourceAccount && sourceAmount > sourceAccount.balance) {
				throw new Error(
					`划转金额不能超过当前账户可用余额，当前最多可转 ${sourceAccount.balance} ${sourceAccount.currency}。`,
				);
			}
			if (!draft.transferred_on) {
				throw new Error("请选择划转日。");
			}

			setIsWorking(true);
			await onCreate({
				from_account_id: Number(draft.from_account_id),
				to_account_id: Number(draft.to_account_id),
				source_amount: sourceAmount,
				target_amount: draft.target_amount.trim()
					? Number(draft.target_amount)
					: undefined,
				transferred_on: draft.transferred_on,
				note: draft.note.trim() || undefined,
			});
		} catch (error) {
			setLocalError(toErrorMessage(error, "保存账户划转失败，请稍后重试。"));
		} finally {
			setIsWorking(false);
		}
	}

	return (
		<section className="asset-manager__panel">
			<div className="asset-manager__panel-head">
				<div>
					<p className="asset-manager__eyebrow">CASH TRANSFER</p>
					<h3>账户划转</h3>
					<p>在现金账户之间划转余额 后台会自动记账并刷新总资产历史。</p>
				</div>
			</div>

			{effectiveError ? (
				<div className="asset-manager__message asset-manager__message--error">
					{effectiveError}
				</div>
			) : null}

			<div className="asset-manager__form">
				<div className="asset-manager__field-grid">
					<label className="asset-manager__field">
						<span>转出账户</span>
						<select
							value={draft.from_account_id}
							onChange={(event) => {
								const nextAccount = accounts.find(
									(account) => String(account.id) === event.target.value,
								);
								updateDraft("from_account_id", event.target.value);
								updateDraft(
									"source_amount",
									clampTransferAmount(
										draft.source_amount,
										nextAccount?.balance,
									),
								);
							}}
						>
							<option value="">请选择</option>
							{accounts.map((account) => (
								<option key={account.id} value={String(account.id)}>
									{account.name} · {formatMoneyAmount(account.balance, account.currency)}
								</option>
							))}
						</select>
					</label>

					<label className="asset-manager__field">
						<span>转入账户</span>
						<select
							value={draft.to_account_id}
							onChange={(event) => updateDraft("to_account_id", event.target.value)}
						>
							<option value="">请选择</option>
							{accounts.map((account) => (
								<option key={account.id} value={String(account.id)}>
									{account.name} · {formatMoneyAmount(account.balance, account.currency)}
								</option>
							))}
						</select>
					</label>

					<label className="asset-manager__field">
						<span>划转金额</span>
						<input
							type="text"
							inputMode="decimal"
							value={draft.source_amount}
							onChange={(event) =>
								updateDraft(
									"source_amount",
									clampTransferAmount(event.target.value, sourceAccount?.balance),
								)
							}
							placeholder={sourceAccount?.currency ?? "输入金额"}
						/>
					</label>

					<label className="asset-manager__field">
						<span>划转日</span>
						<DatePickerField
							value={draft.transferred_on}
							onChange={(nextValue) => updateDraft("transferred_on", nextValue)}
							maxDate={maxStartedOnDate}
							placeholder="选择划转日"
						/>
					</label>
				</div>

				<label className="asset-manager__field">
					<span>备注</span>
					<textarea
						value={draft.note}
						onChange={(event) => updateDraft("note", event.target.value)}
						placeholder="可选"
					/>
				</label>

				{sourceAccount && targetAccount && sourceAccount.currency !== targetAccount.currency ? (
					<p className="asset-manager__helper-text">
						跨币种划转会按当前汇率自动换算到 {targetAccount.currency}
					</p>
				) : null}

				<div className="asset-manager__form-actions">
					<button
						type="button"
						className="asset-manager__button asset-manager__button--legacy-add"
						onClick={() => void handleSubmit()}
						disabled={busy || isWorking}
					>
						{busy || isWorking ? "保存中..." : "确认划转"}
					</button>
					{onCancel ? (
						<button
							type="button"
							className="asset-manager__button asset-manager__button--secondary"
							onClick={onCancel}
							disabled={busy || isWorking}
						>
							取消
						</button>
					) : null}
				</div>
			</div>
		</section>
	);
}
