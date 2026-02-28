import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import "./asset-components.css";
import { toErrorMessage } from "../../lib/apiClient";
import type {
	AssetEditorMode,
	HoldingFormDraft,
	HoldingInput,
	MaybePromise,
} from "../../types/assets";
import { DEFAULT_HOLDING_FORM_DRAFT } from "../../types/assets";

export interface HoldingFormProps {
	mode?: AssetEditorMode;
	value?: Partial<HoldingFormDraft> | null;
	recordId?: number | null;
	title?: string;
	subtitle?: string;
	submitLabel?: string;
	busy?: boolean;
	refreshing?: boolean;
	errorMessage?: string | null;
	onCreate?: (payload: HoldingInput) => MaybePromise<unknown>;
	onEdit?: (recordId: number, payload: HoldingInput) => MaybePromise<unknown>;
	onDelete?: (recordId: number) => MaybePromise<unknown>;
	onRefresh?: () => MaybePromise<unknown>;
	onCancel?: () => void;
}

function toHoldingDraft(value?: Partial<HoldingFormDraft> | null): HoldingFormDraft {
	return {
		...DEFAULT_HOLDING_FORM_DRAFT,
		...value,
	};
}

function toHoldingInput(draft: HoldingFormDraft): HoldingInput {
	return {
		symbol: draft.symbol.trim().toUpperCase(),
		name: draft.name.trim(),
		quantity: Number(draft.quantity),
		fallback_currency: draft.fallback_currency.trim().toUpperCase(),
	};
}

export function HoldingForm({
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
}: HoldingFormProps) {
	const [draft, setDraft] = useState<HoldingFormDraft>(() => toHoldingDraft(value));
	const [localError, setLocalError] = useState<string | null>(null);
	const [isWorking, setIsWorking] = useState(false);
	const [isRefreshingLocal, setIsRefreshingLocal] = useState(false);

	useEffect(() => {
		setDraft(toHoldingDraft(value));
		setLocalError(null);
	}, [mode, value]);

	const effectiveError = localError ?? errorMessage;
	const isSubmitting = busy || isWorking;
	const isRefreshingActive = refreshing || isRefreshingLocal;
	const resolvedTitle = title ?? (mode === "edit" ? "编辑证券持仓" : "新增证券持仓");
	const resolvedSubmitLabel =
		submitLabel ?? (mode === "edit" ? "保存修改" : "保存持仓");

	function updateDraft<K extends keyof HoldingFormDraft>(
		field: K,
		nextValue: HoldingFormDraft[K],
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
			const payload = toHoldingInput(draft);
			if (!payload.symbol || !payload.name || !payload.fallback_currency) {
				throw new Error("请完整填写代码、名称和备用币种。");
			}
			if (!Number.isFinite(payload.quantity) || payload.quantity <= 0) {
				throw new Error("请输入有效的持仓数量。");
			}

			if (mode === "edit" && recordId !== null) {
				await onEdit?.(recordId, payload);
			} else {
				await onCreate?.(payload);
				setDraft(DEFAULT_HOLDING_FORM_DRAFT);
			}
		} catch (error) {
			setLocalError(toErrorMessage(error, "保存持仓失败，请稍后重试。"));
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
			setLocalError(toErrorMessage(error, "刷新持仓失败，请稍后重试。"));
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
			setLocalError(toErrorMessage(error, "删除持仓失败，请稍后重试。"));
		} finally {
			setIsWorking(false);
		}
	}

	return (
		<section className="asset-manager__panel">
			<div className="asset-manager__panel-head">
				<div>
					<p className="asset-manager__eyebrow">HOLDING FORM</p>
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
					<span>证券代码</span>
					<input
						required
						value={draft.symbol}
						onChange={(event) => updateDraft("symbol", event.target.value)}
						placeholder="0700.HK / AAPL / 600519.SS"
					/>
				</label>

				<label className="asset-manager__field">
					<span>名称</span>
					<input
						required
						value={draft.name}
						onChange={(event) => updateDraft("name", event.target.value)}
						placeholder="腾讯控股"
					/>
				</label>

				<div className="asset-manager__field-grid">
					<label className="asset-manager__field">
						<span>数量</span>
						<input
							required
							type="number"
							min="0.0001"
							step="0.0001"
							value={draft.quantity}
							onChange={(event) => updateDraft("quantity", event.target.value)}
							placeholder="100"
						/>
					</label>

					<label className="asset-manager__field">
						<span>备用币种</span>
						<input
							required
							value={draft.fallback_currency}
							onChange={(event) =>
								updateDraft("fallback_currency", event.target.value)
							}
							placeholder="HKD"
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
							删除持仓
						</button>
					) : null}
				</div>
			</form>
		</section>
	);
}
