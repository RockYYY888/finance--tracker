import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import "./asset-components.css";
import { toErrorMessage } from "../../lib/apiClient";
import type {
	AssetEditorMode,
	FixedAssetFormDraft,
	FixedAssetInput,
	MaybePromise,
} from "../../types/assets";
import {
	DEFAULT_FIXED_ASSET_FORM_DRAFT,
	FIXED_ASSET_CATEGORY_OPTIONS,
} from "../../types/assets";

export interface FixedAssetFormProps {
	mode?: AssetEditorMode;
	value?: Partial<FixedAssetFormDraft> | null;
	recordId?: number | null;
	title?: string;
	subtitle?: string;
	submitLabel?: string;
	busy?: boolean;
	errorMessage?: string | null;
	onCreate?: (payload: FixedAssetInput) => MaybePromise<unknown>;
	onEdit?: (recordId: number, payload: FixedAssetInput) => MaybePromise<unknown>;
	onDelete?: (recordId: number) => MaybePromise<unknown>;
	onCancel?: () => void;
}

function toFixedAssetDraft(
	value?: Partial<FixedAssetFormDraft> | null,
): FixedAssetFormDraft {
	return {
		...DEFAULT_FIXED_ASSET_FORM_DRAFT,
		...value,
	};
}

function toFixedAssetInput(draft: FixedAssetFormDraft): FixedAssetInput {
	const normalizedNote = draft.note.trim();
	const purchaseValue = draft.purchase_value_cny.trim()
		? Number(draft.purchase_value_cny)
		: undefined;

	return {
		name: draft.name.trim(),
		category: draft.category,
		current_value_cny: Number(draft.current_value_cny),
		purchase_value_cny: purchaseValue,
		note: normalizedNote || undefined,
	};
}

export function FixedAssetForm({
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
}: FixedAssetFormProps) {
	const [draft, setDraft] = useState<FixedAssetFormDraft>(() => toFixedAssetDraft(value));
	const [localError, setLocalError] = useState<string | null>(null);
	const [isWorking, setIsWorking] = useState(false);

	useEffect(() => {
		setDraft(toFixedAssetDraft(value));
		setLocalError(null);
	}, [mode, value]);

	const effectiveError = localError ?? errorMessage;
	const isSubmitting = busy || isWorking;
	const resolvedTitle = title ?? (mode === "edit" ? "编辑固定资产" : "新增固定资产");
	const resolvedSubmitLabel = submitLabel ?? (mode === "edit" ? "编辑" : "新增");

	function updateDraft<K extends keyof FixedAssetFormDraft>(
		field: K,
		nextValue: FixedAssetFormDraft[K],
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
			const payload = toFixedAssetInput(draft);
			if (!payload.name) {
				throw new Error("请填写固定资产名称。");
			}
			if (!Number.isFinite(payload.current_value_cny) || payload.current_value_cny <= 0) {
				throw new Error("请输入有效的当前估值。");
			}
			if (
				payload.purchase_value_cny !== undefined &&
				(!Number.isFinite(payload.purchase_value_cny) || payload.purchase_value_cny <= 0)
			) {
				throw new Error("请输入有效的购入价。");
			}

			if (mode === "edit" && recordId !== null) {
				await onEdit?.(recordId, payload);
			} else {
				await onCreate?.(payload);
				setDraft(DEFAULT_FIXED_ASSET_FORM_DRAFT);
			}
		} catch (error) {
			setLocalError(toErrorMessage(error, "保存固定资产失败，请稍后重试。"));
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
			setLocalError(toErrorMessage(error, "删除固定资产失败，请稍后重试。"));
		} finally {
			setIsWorking(false);
		}
	}

	return (
		<section className="asset-manager__panel">
			<div className="asset-manager__panel-head">
				<div>
					<p className="asset-manager__eyebrow">FIXED ASSET</p>
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
					<span>名称</span>
					<input
						required
						value={draft.name}
						onChange={(event) => updateDraft("name", event.target.value)}
						placeholder="例如：自住房 / 公积金"
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
									event.target.value as FixedAssetFormDraft["category"],
								)
							}
						>
							{FIXED_ASSET_CATEGORY_OPTIONS.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</label>

					<label className="asset-manager__field">
						<span>当前估值（CNY）</span>
						<input
							required
							type="number"
							min="0.01"
							step="0.01"
							value={draft.current_value_cny}
							onChange={(event) => updateDraft("current_value_cny", event.target.value)}
							placeholder="500000"
						/>
					</label>

					<label className="asset-manager__field">
						<span>购入价（可选）</span>
						<input
							type="number"
							min="0.01"
							step="0.01"
							value={draft.purchase_value_cny}
							onChange={(event) => updateDraft("purchase_value_cny", event.target.value)}
							placeholder="450000"
						/>
					</label>
				</div>

				<label className="asset-manager__field">
					<span>备注</span>
					<textarea
						value={draft.note}
						onChange={(event) => updateDraft("note", event.target.value)}
						placeholder="可选，例如：保守估值 / 最近一次更新来源"
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
							删除资产
						</button>
					) : null}
				</div>
			</form>
		</section>
	);
}
