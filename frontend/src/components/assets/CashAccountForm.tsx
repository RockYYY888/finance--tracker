import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import "./asset-components.css";
import { toErrorMessage } from "../../lib/apiClient";
import type {
	AssetEditorMode,
	CashAccountFormDraft,
	CashAccountInput,
	MaybePromise,
} from "../../types/assets";
import { DEFAULT_CASH_ACCOUNT_FORM_DRAFT } from "../../types/assets";

export interface CashAccountFormProps {
	mode?: AssetEditorMode;
	value?: Partial<CashAccountFormDraft> | null;
	recordId?: number | null;
	title?: string;
	subtitle?: string;
	submitLabel?: string;
	busy?: boolean;
	refreshing?: boolean;
	errorMessage?: string | null;
	onCreate?: (payload: CashAccountInput) => MaybePromise<unknown>;
	onEdit?: (recordId: number, payload: CashAccountInput) => MaybePromise<unknown>;
	onDelete?: (recordId: number) => MaybePromise<unknown>;
	onRefresh?: () => MaybePromise<unknown>;
	onCancel?: () => void;
}

function toCashAccountDraft(
	value?: Partial<CashAccountFormDraft> | null,
): CashAccountFormDraft {
	return {
		...DEFAULT_CASH_ACCOUNT_FORM_DRAFT,
		...value,
	};
}

function toCashAccountInput(draft: CashAccountFormDraft): CashAccountInput {
	return {
		name: draft.name.trim(),
		platform: draft.platform.trim(),
		currency: draft.currency.trim().toUpperCase(),
		balance: Number(draft.balance),
	};
}

export function CashAccountForm({
	mode = "create",
	value,
	recordId = null,
	title,
	subtitle,
	submitLabel,
	busy = false,
	refreshing = false,
	errorMessage = null,
	onCreate,
	onEdit,
	onDelete,
	onRefresh,
	onCancel,
}: CashAccountFormProps) {
	const [draft, setDraft] = useState<CashAccountFormDraft>(() =>
		toCashAccountDraft(value),
	);
	const [localError, setLocalError] = useState<string | null>(null);
	const [isWorking, setIsWorking] = useState(false);
	const [isRefreshingLocal, setIsRefreshingLocal] = useState(false);

	useEffect(() => {
		setDraft(toCashAccountDraft(value));
		setLocalError(null);
	}, [mode, value]);

	const effectiveError = localError ?? errorMessage;
	const isSubmitting = busy || isWorking;
	const isRefreshingActive = refreshing || isRefreshingLocal;
	const resolvedTitle = title ?? (mode === "edit" ? "编辑现金账户" : "新增现金账户");
	const resolvedSubmitLabel =
		submitLabel ?? (mode === "edit" ? "保存修改" : "保存现金账户");

	function updateDraft<K extends keyof CashAccountFormDraft>(
		field: K,
		nextValue: CashAccountFormDraft[K],
	): void {
		setLocalError(null);
		setDraft((currentDraft) => ({
			...currentDraft,
			[field]: nextValue,
		}));
	}

	async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
		event.preventDefault();
		setLocalError(null);
		setIsWorking(true);

		try {
			const payload = toCashAccountInput(draft);
			if (!payload.name || !payload.platform || !payload.currency) {
				throw new Error("请完整填写账户名称、平台和币种。");
			}
			if (!Number.isFinite(payload.balance) || payload.balance < 0) {
				throw new Error("请输入有效的账户余额。");
			}

			if (mode === "edit" && recordId !== null) {
				await onEdit?.(recordId, payload);
			} else {
				await onCreate?.(payload);
				setDraft(DEFAULT_CASH_ACCOUNT_FORM_DRAFT);
			}
		} catch (error) {
			setLocalError(toErrorMessage(error, "保存现金账户失败，请稍后重试。"));
		} finally {
			setIsWorking(false);
		}
	}

	async function handleRefresh(): Promise<void> {
		if (!onRefresh) {
			return;
		}

		setLocalError(null);
		setIsRefreshingLocal(true);

		try {
			await onRefresh();
		} catch (error) {
			setLocalError(toErrorMessage(error, "刷新现金账户失败，请稍后重试。"));
		} finally {
			setIsRefreshingLocal(false);
		}
	}

	async function handleDelete(): Promise<void> {
		if (!onDelete || recordId === null) {
			return;
		}

		setLocalError(null);
		setIsWorking(true);

		try {
			await onDelete(recordId);
		} catch (error) {
			setLocalError(toErrorMessage(error, "删除现金账户失败，请稍后重试。"));
		} finally {
			setIsWorking(false);
		}
	}

	return (
		<section className="asset-manager__panel">
			<div className="asset-manager__panel-head">
				<div>
					<p className="asset-manager__eyebrow">CASH FORM</p>
					<h3>{resolvedTitle}</h3>
					{subtitle ? <p>{subtitle}</p> : null}
				</div>
				<div className="asset-manager__mini-actions">
					{onRefresh ? (
						<button
							type="button"
							className="asset-manager__button asset-manager__button--secondary"
							onClick={() => void handleRefresh()}
							disabled={isSubmitting || isRefreshingActive}
						>
							{isRefreshingActive ? "同步中..." : "同步"}
						</button>
					) : null}
				</div>
			</div>

			{effectiveError ? (
				<div className="asset-manager__message asset-manager__message--error">
					{effectiveError}
				</div>
			) : null}

			<form className="asset-manager__form" onSubmit={(event) => void handleSubmit(event)}>
				<label className="asset-manager__field">
					<span>账户名称</span>
					<input
						required
						value={draft.name}
						onChange={(event) => updateDraft("name", event.target.value)}
						placeholder="例如：日常备用金"
					/>
				</label>

				<label className="asset-manager__field">
					<span>平台</span>
					<input
						required
						value={draft.platform}
						onChange={(event) => updateDraft("platform", event.target.value)}
						placeholder="支付宝 / 微信 / 银行卡"
					/>
				</label>

				<div className="asset-manager__field-grid">
					<label className="asset-manager__field">
						<span>币种</span>
						<input
							required
							value={draft.currency}
							onChange={(event) => updateDraft("currency", event.target.value)}
							placeholder="CNY"
						/>
					</label>

					<label className="asset-manager__field">
						<span>余额</span>
						<input
							required
							type="number"
							min="0"
							step="0.01"
							value={draft.balance}
							onChange={(event) => updateDraft("balance", event.target.value)}
							placeholder="10000"
						/>
					</label>
				</div>

				<div className="asset-manager__form-actions">
					<button
						type="submit"
						className="asset-manager__button"
						disabled={isSubmitting || isRefreshingActive}
					>
						{isSubmitting ? "保存中..." : resolvedSubmitLabel}
					</button>

					{mode === "edit" && onCancel ? (
						<button
							type="button"
							className="asset-manager__button asset-manager__button--secondary"
							onClick={onCancel}
							disabled={isSubmitting || isRefreshingActive}
						>
							取消编辑
						</button>
					) : null}

					{mode === "edit" && recordId !== null && onDelete ? (
						<button
							type="button"
							className="asset-manager__button asset-manager__button--danger"
							onClick={() => void handleDelete()}
							disabled={isSubmitting || isRefreshingActive}
						>
							删除账户
						</button>
					) : null}
				</div>
			</form>
		</section>
	);
}
