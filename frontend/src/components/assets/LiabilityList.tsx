import { useState } from "react";
import "./asset-components.css";
import {
	formatCnyAmount,
	formatLiabilityCategory,
	formatMoneyAmount,
} from "../../lib/assetFormatting";
import { toErrorMessage } from "../../lib/apiClient";
import type { LiabilityRecord, MaybePromise } from "../../types/assets";

export interface LiabilityListProps {
	liabilities: LiabilityRecord[];
	title?: string;
	subtitle?: string;
	loading?: boolean;
	busy?: boolean;
	errorMessage?: string | null;
	emptyMessage?: string;
	onCreate?: () => void;
	onEdit?: (entry: LiabilityRecord) => void;
	onDelete?: (recordId: number) => MaybePromise<unknown>;
}

export function LiabilityList({
	liabilities,
	title = "负债",
	subtitle,
	loading = false,
	busy = false,
	errorMessage = null,
	emptyMessage = "暂无负债记录。",
	onCreate,
	onEdit,
	onDelete,
}: LiabilityListProps) {
	const [localError, setLocalError] = useState<string | null>(null);
	const [deletingId, setDeletingId] = useState<number | null>(null);

	const effectiveError = localError ?? errorMessage;

	async function handleDelete(recordId: number): Promise<void> {
		if (!onDelete) {
			return;
		}

		setLocalError(null);
		setDeletingId(recordId);

		try {
			await onDelete(recordId);
		} catch (error) {
			setLocalError(toErrorMessage(error, "删除负债失败，请稍后重试。"));
		} finally {
			setDeletingId(null);
		}
	}

	return (
		<section className="asset-manager__panel">
			<div className="asset-manager__list-head">
				<div>
					<p className="asset-manager__eyebrow">LIABILITY LIST</p>
					<h3>{title}</h3>
					{subtitle ? <p>{subtitle}</p> : null}
				</div>
				<div className="asset-manager__mini-actions">
					{onCreate ? (
						<button
							type="button"
							className="asset-manager__button"
							onClick={onCreate}
							disabled={busy}
						>
							新增
						</button>
					) : null}
				</div>
			</div>

			{effectiveError ? (
				<div className="asset-manager__message asset-manager__message--error">
					{effectiveError}
				</div>
			) : null}

			{loading ? (
				<div className="asset-manager__empty-state">正在加载负债...</div>
			) : liabilities.length === 0 ? (
				<div className="asset-manager__empty-state">{emptyMessage}</div>
			) : (
				<ul className="asset-manager__list">
					{liabilities.map((entry) => (
						<li key={entry.id} className="asset-manager__card">
							<div className="asset-manager__card-top">
								<div className="asset-manager__card-title">
									<div className="asset-manager__badge-row">
										<span className="asset-manager__badge">
											{formatLiabilityCategory(entry.category)}
										</span>
									</div>
									<h3>{entry.name}</h3>
									<p className="asset-manager__card-note">
										{entry.note?.trim() || `负债 #${entry.id}`}
									</p>
								</div>
								<div className="asset-manager__card-actions">
									{onEdit ? (
										<button
											type="button"
											className="asset-manager__button asset-manager__button--secondary"
											onClick={() => onEdit(entry)}
											disabled={busy}
										>
											编辑
										</button>
									) : null}
									{onDelete ? (
										<button
											type="button"
											className="asset-manager__button asset-manager__button--danger"
											onClick={() => void handleDelete(entry.id)}
											disabled={busy || deletingId === entry.id}
										>
											{deletingId === entry.id ? "删除中..." : "删除"}
										</button>
									) : null}
								</div>
							</div>

							<div className="asset-manager__metric-grid">
								<div className="asset-manager__metric">
									<span>待偿余额</span>
									<strong>{formatMoneyAmount(entry.balance, entry.currency)}</strong>
								</div>
								<div className="asset-manager__metric">
									<span>折算人民币</span>
									<strong>{formatCnyAmount(entry.value_cny)}</strong>
								</div>
							</div>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
