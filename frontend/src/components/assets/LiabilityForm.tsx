import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import "./asset-components.css";
import { toErrorMessage } from "../../lib/apiClient";
import type {
	AssetEditorMode,
	LiabilityFormDraft,
	LiabilityInput,
	MaybePromise,
} from "../../types/assets";
import {
	DEFAULT_LIABILITY_FORM_DRAFT,
	LIABILITY_CATEGORY_OPTIONS,
	LIABILITY_CURRENCY_OPTIONS,
} from "../../types/assets";

export interface LiabilityFormProps {
	mode?: AssetEditorMode;
	value?: Partial<LiabilityFormDraft> | null;
	recordId?: number | null;
	title?: string;
	subtitle?: string;
	submitLabel?: string;
	busy?: boolean;
	errorMessage?: string | null;
	onCreate?: (payload: LiabilityInput) => MaybePromise<unknown>;
	onEdit?: (recordId: number, payload: LiabilityInput) => MaybePromise<unknown>;
	onDelete?: (recordId: number) => MaybePromise<unknown>;
	onCancel?: () => void;
}

function toLiabilityDraft(value?: Partial<LiabilityFormDraft> | null): LiabilityFormDraft {
	const nextDraft = {
		...DEFAULT_LIABILITY_FORM_DRAFT,
		...value,
	};

	return {
		...nextDraft,
		currency: nextDraft.currency === "USD" ? "USD" : "CNY",
	};
}

function toLiabilityInput(draft: LiabilityFormDraft): LiabilityInput {
	const normalizedNote = draft.note.trim();
	return {
		name: draft.name.trim(),
		category: draft.category,
		currency: draft.currency,
		balance: Number(draft.balance),
		started_on: draft.started_on.trim() || undefined,
		note: normalizedNote || undefined,
	};
}

export function LiabilityForm({
	mode = "create",
	value,
	recordId = null,
	title,
	subtitle,
	submitLabel,
	busy = false,
	errorMessage = null,
	onCreate,
	onEdit,
	onDelete,
	onCancel,
}: LiabilityFormProps) {
	const [draft, setDraft] = useState<LiabilityFormDraft>(() => toLiabilityDraft(value));
	const [localError, setLocalError] = useState<string | null>(null);
	const [isWorking, setIsWorking] = useState(false);

	useEffect(() => {
		setDraft(toLiabilityDraft(value));
		setLocalError(null);
	}, [mode, value]);

	const effectiveError = localError ?? errorMessage;
	const isSubmitting = busy || isWorking;
	const resolvedTitle = title ?? (mode === "edit" ? "编辑负债" : "新增负债");
	const resolvedSubmitLabel = submitLabel ?? (mode === "edit" ? "编辑" : "新增");

	function updateDraft<K extends keyof LiabilityFormDraft>(
		field: K,
		nextValue: LiabilityFormDraft[K],
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
			const payload = toLiabilityInput(draft);
			if (!payload.name || !payload.currency) {
				throw new Error("请完整填写负债名称和币种。");
			}
			if (!Number.isFinite(payload.balance) || payload.balance < 0) {
				throw new Error("请输入有效的待偿余额。");
			}

			if (mode === "edit" && recordId !== null) {
				await onEdit?.(recordId, payload);
			} else {
				await onCreate?.(payload);
				setDraft(DEFAULT_LIABILITY_FORM_DRAFT);
			}
		} catch (error) {
			setLocalError(toErrorMessage(error, "保存负债失败，请稍后重试。"));
		} finally {
			setIsWorking(false);
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
			setLocalError(toErrorMessage(error, "删除负债失败，请稍后重试。"));
		} finally {
			setIsWorking(false);
		}
	}

	return (
		<section className="asset-manager__panel">
			<div className="asset-manager__panel-head">
				<div>
					<p className="asset-manager__eyebrow">LIABILITY</p>
					<h3>{resolvedTitle}</h3>
					{subtitle ? <p>{subtitle}</p> : null}
				</div>
			</div>

			{effectiveError ? (
				<div className="asset-manager__message asset-manager__message--error">
					{effectiveError}
				</div>
			) : null}

			<form className="asset-manager__form" onSubmit={(event) => void handleSubmit(event)}>
				<label className="asset-manager__field">
					<span>负债名称</span>
					<input
						required
						value={draft.name}
						onChange={(event) => updateDraft("name", event.target.value)}
						placeholder="例如：房贷 / 信用卡账单"
					/>
				</label>

				<div className="asset-manager__field-grid asset-manager__field-grid--triple">
					<label className="asset-manager__field">
						<span>类型</span>
						<select
							value={draft.category}
							onChange={(event) =>
								updateDraft(
									"category",
									event.target.value as LiabilityFormDraft["category"],
								)
							}
						>
							{LIABILITY_CATEGORY_OPTIONS.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</label>

					<label className="asset-manager__field">
						<span>计价币种</span>
						<select
							value={draft.currency}
							onChange={(event) =>
								updateDraft("currency", event.target.value as LiabilityFormDraft["currency"])
							}
						>
							{LIABILITY_CURRENCY_OPTIONS.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</label>

					<label className="asset-manager__field">
						<span>待偿余额</span>
						<input
							required
							type="number"
							min="0"
							step="0.01"
							value={draft.balance}
							onChange={(event) => updateDraft("balance", event.target.value)}
							placeholder="100000"
						/>
					</label>

					<label className="asset-manager__field">
						<span>起贷日</span>
						<input
							type="date"
							value={draft.started_on}
							onChange={(event) => updateDraft("started_on", event.target.value)}
						/>
					</label>
				</div>

				<label className="asset-manager__field">
					<span>备注</span>
					<textarea
						value={draft.note}
						onChange={(event) => updateDraft("note", event.target.value)}
						placeholder="可选，例如：下次还款日 / 分期说明"
					/>
				</label>

				<div className="asset-manager__form-actions">
					<button type="submit" className="asset-manager__button" disabled={isSubmitting}>
						{isSubmitting ? "保存中..." : resolvedSubmitLabel}
					</button>

					{mode === "edit" && onCancel ? (
						<button
							type="button"
							className="asset-manager__button asset-manager__button--secondary"
							onClick={onCancel}
							disabled={isSubmitting}
						>
							取消编辑
						</button>
					) : null}

					{mode === "edit" && recordId !== null && onDelete ? (
						<button
							type="button"
							className="asset-manager__button asset-manager__button--danger"
							onClick={() => void handleDelete()}
							disabled={isSubmitting}
						>
							删除负债
						</button>
					) : null}
				</div>
			</form>
		</section>
	);
}
