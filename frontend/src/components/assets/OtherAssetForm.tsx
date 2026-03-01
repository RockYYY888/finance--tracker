import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import "./asset-components.css";
import { toErrorMessage } from "../../lib/apiClient";
import type {
	AssetEditorMode,
	MaybePromise,
	OtherAssetFormDraft,
	OtherAssetInput,
} from "../../types/assets";
import {
	DEFAULT_OTHER_ASSET_FORM_DRAFT,
	OTHER_ASSET_CATEGORY_OPTIONS,
} from "../../types/assets";

export interface OtherAssetFormProps {
	mode?: AssetEditorMode;
	value?: Partial<OtherAssetFormDraft> | null;
	recordId?: number | null;
	title?: string;
	subtitle?: string;
	submitLabel?: string;
	busy?: boolean;
	errorMessage?: string | null;
	onCreate?: (payload: OtherAssetInput) => MaybePromise<unknown>;
	onEdit?: (recordId: number, payload: OtherAssetInput) => MaybePromise<unknown>;
	onDelete?: (recordId: number) => MaybePromise<unknown>;
	onCancel?: () => void;
}

function toOtherAssetDraft(value?: Partial<OtherAssetFormDraft> | null): OtherAssetFormDraft {
	return {
		...DEFAULT_OTHER_ASSET_FORM_DRAFT,
		...value,
	};
}

function toOtherAssetInput(draft: OtherAssetFormDraft): OtherAssetInput {
	const normalizedNote = draft.note.trim();
	const originalValue = draft.original_value_cny.trim()
		? Number(draft.original_value_cny)
		: undefined;

	return {
		name: draft.name.trim(),
		category: draft.category,
		current_value_cny: Number(draft.current_value_cny),
		original_value_cny: originalValue,
		note: normalizedNote || undefined,
	};
}

export function OtherAssetForm({
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
}: OtherAssetFormProps) {
	const [draft, setDraft] = useState<OtherAssetFormDraft>(() => toOtherAssetDraft(value));
	const [localError, setLocalError] = useState<string | null>(null);
	const [isWorking, setIsWorking] = useState(false);

	useEffect(() => {
		setDraft(toOtherAssetDraft(value));
		setLocalError(null);
	}, [mode, value]);

	const effectiveError = localError ?? errorMessage;
	const isSubmitting = busy || isWorking;
	const resolvedTitle = title ?? (mode === "edit" ? "编辑其他资产" : "新增其他资产");
	const resolvedSubmitLabel = submitLabel ?? (mode === "edit" ? "编辑" : "新增");

	function updateDraft<K extends keyof OtherAssetFormDraft>(
		field: K,
		nextValue: OtherAssetFormDraft[K],
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
			const payload = toOtherAssetInput(draft);
			if (!payload.name) {
				throw new Error("请填写资产名称。");
			}
			if (!Number.isFinite(payload.current_value_cny) || payload.current_value_cny <= 0) {
				throw new Error("请输入有效的当前价值。");
			}
			if (
				payload.original_value_cny !== undefined &&
				(!Number.isFinite(payload.original_value_cny) || payload.original_value_cny <= 0)
			) {
				throw new Error("请输入有效的原价值。");
			}

			if (mode === "edit" && recordId !== null) {
				await onEdit?.(recordId, payload);
			} else {
				await onCreate?.(payload);
				setDraft(DEFAULT_OTHER_ASSET_FORM_DRAFT);
			}
		} catch (error) {
			setLocalError(toErrorMessage(error, "保存其他资产失败，请稍后重试。"));
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
			setLocalError(toErrorMessage(error, "删除其他资产失败，请稍后重试。"));
		} finally {
			setIsWorking(false);
		}
	}

	return (
		<section className="asset-manager__panel">
			<div className="asset-manager__panel-head">
				<div>
					<p className="asset-manager__eyebrow">OTHER ASSET</p>
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
						placeholder="例如：朋友借款 / 备用应收"
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
									event.target.value as OtherAssetFormDraft["category"],
								)
							}
						>
							{OTHER_ASSET_CATEGORY_OPTIONS.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</label>

					<label className="asset-manager__field">
						<span>现价（CNY）</span>
						<input
							required
							type="number"
							min="0.01"
							step="0.01"
							value={draft.current_value_cny}
							onChange={(event) => updateDraft("current_value_cny", event.target.value)}
							placeholder="10000"
						/>
					</label>

					<label className="asset-manager__field">
						<span>原价值（可选）</span>
						<input
							type="number"
							min="0.01"
							step="0.01"
							value={draft.original_value_cny}
							onChange={(event) => updateDraft("original_value_cny", event.target.value)}
							placeholder="9500"
						/>
					</label>
				</div>

				<label className="asset-manager__field">
					<span>备注</span>
					<textarea
						value={draft.note}
						onChange={(event) => updateDraft("note", event.target.value)}
						placeholder="可选，例如：预计回款时间"
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
