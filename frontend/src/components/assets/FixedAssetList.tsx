import { useState } from "react";
import "./asset-components.css";
import {
	formatCnyAmount,
	formatDateValue,
	formatFixedAssetCategory,
	formatPercentValue,
} from "../../lib/assetFormatting";
import { toErrorMessage } from "../../lib/apiClient";
import type { FixedAssetRecord, MaybePromise } from "../../types/assets";

export interface FixedAssetListProps {
	assets: FixedAssetRecord[];
	title?: string;
	subtitle?: string;
	loading?: boolean;
	busy?: boolean;
	errorMessage?: string | null;
	emptyMessage?: string;
	onCreate?: () => void;
	onEdit?: (asset: FixedAssetRecord) => void;
	onDelete?: (recordId: number) => MaybePromise<unknown>;
}

export function FixedAssetList({
	assets,
	title = "固定资产",
	subtitle,
	loading = false,
	busy = false,
	errorMessage = null,
	emptyMessage = "暂无固定资产。",
	onCreate,
	onEdit,
	onDelete,
}: FixedAssetListProps) {
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
			setLocalError(toErrorMessage(error, "删除固定资产失败，请稍后重试。"));
		} finally {
			setDeletingId(null);
		}
	}

	return (
		<section className="asset-manager__panel">
			<div className="asset-manager__list-head">
				<div>
					<p className="asset-manager__eyebrow">FIXED LIST</p>
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
				<div className="asset-manager__empty-state">正在加载固定资产...</div>
			) : assets.length === 0 ? (
				<div className="asset-manager__empty-state">{emptyMessage}</div>
			) : (
				<ul className="asset-manager__list">
					{assets.map((asset) => (
						<li key={asset.id} className="asset-manager__card">
							<div className="asset-manager__card-top">
								<div className="asset-manager__card-title">
									<div className="asset-manager__badge-row">
										<span className="asset-manager__badge">
											{formatFixedAssetCategory(asset.category)}
										</span>
									</div>
									<h3>{asset.name}</h3>
									<p className="asset-manager__card-note">
										{asset.note?.trim() || `固定资产 #${asset.id}`}
									</p>
								</div>
								<div className="asset-manager__card-actions">
									{onEdit ? (
										<button
											type="button"
											className="asset-manager__button asset-manager__button--secondary"
											onClick={() => onEdit(asset)}
											disabled={busy}
										>
											编辑
										</button>
									) : null}
									{onDelete ? (
										<button
											type="button"
											className="asset-manager__button asset-manager__button--danger"
											onClick={() => void handleDelete(asset.id)}
											disabled={busy || deletingId === asset.id}
										>
											{deletingId === asset.id ? "删除中..." : "删除"}
										</button>
									) : null}
								</div>
							</div>

							<div className="asset-manager__metric-grid">
								<div className="asset-manager__metric">
									<span>当前估值</span>
									<strong>{formatCnyAmount(asset.value_cny)}</strong>
								</div>
								<div className="asset-manager__metric">
									<span>购入价</span>
									<strong>
										{asset.purchase_value_cny != null
											? formatCnyAmount(asset.purchase_value_cny)
											: "未填写"}
									</strong>
								</div>
								<div className="asset-manager__metric">
									<span>收益率</span>
									<strong>
										{asset.return_pct != null
											? formatPercentValue(asset.return_pct)
											: "待计算"}
									</strong>
								</div>
								<div className="asset-manager__metric">
									<span>购入日</span>
									<strong>{formatDateValue(asset.started_on)}</strong>
								</div>
							</div>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
