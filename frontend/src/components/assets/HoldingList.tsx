import { useState } from "react";
import "./asset-components.css";
import {
	formatCnyAmount,
	formatMoneyAmount,
	formatQuantity,
	formatTimestamp,
} from "../../lib/assetFormatting";
import { toErrorMessage } from "../../lib/apiClient";
import type { HoldingRecord, MaybePromise } from "../../types/assets";

export interface HoldingListProps {
	holdings: HoldingRecord[];
	title?: string;
	subtitle?: string;
	loading?: boolean;
	busy?: boolean;
	errorMessage?: string | null;
	emptyMessage?: string;
	onCreate?: () => void;
	onEdit?: (holding: HoldingRecord) => void;
	onDelete?: (recordId: number) => MaybePromise<unknown>;
	onRefresh?: () => MaybePromise<unknown>;
}

export function HoldingList({
	holdings,
	title = "证券持仓",
	subtitle = "使用卡片展示关键信息，减少横向滚动。",
	loading = false,
	busy = false,
	errorMessage = null,
	emptyMessage = "暂无证券持仓，可先录入港股、美股或 A 股。",
	onCreate,
	onEdit,
	onDelete,
	onRefresh,
}: HoldingListProps) {
	const [localError, setLocalError] = useState<string | null>(null);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [deletingId, setDeletingId] = useState<number | null>(null);

	const effectiveError = localError ?? errorMessage;
	const isActionLocked = busy || isRefreshing;

	async function handleRefresh(): Promise<void> {
		if (!onRefresh) {
			return;
		}

		setLocalError(null);
		setIsRefreshing(true);

		try {
			await onRefresh();
		} catch (error) {
			setLocalError(toErrorMessage(error, "刷新持仓失败，请稍后重试。"));
		} finally {
			setIsRefreshing(false);
		}
	}

	async function handleDelete(recordId: number): Promise<void> {
		if (!onDelete) {
			return;
		}

		setLocalError(null);
		setDeletingId(recordId);

		try {
			await onDelete(recordId);
		} catch (error) {
			setLocalError(toErrorMessage(error, "删除持仓失败，请稍后重试。"));
		} finally {
			setDeletingId(null);
		}
	}

	return (
		<section className="asset-manager__panel">
			<div className="asset-manager__list-head">
				<div>
					<p className="asset-manager__eyebrow">HOLDING LIST</p>
					<h3>{title}</h3>
					<p>{subtitle}</p>
				</div>
				<div className="asset-manager__mini-actions">
					{onRefresh ? (
						<button
							type="button"
							className="asset-manager__button asset-manager__button--secondary"
							onClick={() => void handleRefresh()}
							disabled={isActionLocked}
						>
							{isRefreshing ? "刷新中..." : "刷新"}
						</button>
					) : null}
					{onCreate ? (
						<button
							type="button"
							className="asset-manager__button"
							onClick={onCreate}
							disabled={isActionLocked}
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
				<div className="asset-manager__empty-state">正在同步证券持仓...</div>
			) : holdings.length === 0 ? (
				<div className="asset-manager__empty-state">{emptyMessage}</div>
			) : (
				<ul className="asset-manager__list">
					{holdings.map((holding) => (
						<li key={holding.id} className="asset-manager__card">
							<div className="asset-manager__card-top">
								<div className="asset-manager__card-title">
									<span className="asset-manager__badge">{holding.symbol}</span>
									<h3>{holding.name}</h3>
									<p className="asset-manager__card-note">
										最近同步：{formatTimestamp(holding.last_updated)}
									</p>
								</div>
								<div className="asset-manager__card-actions">
									{onEdit ? (
										<button
											type="button"
											className="asset-manager__button asset-manager__button--secondary"
											onClick={() => onEdit(holding)}
											disabled={isActionLocked}
										>
											编辑
										</button>
									) : null}
									{onDelete ? (
										<button
											type="button"
											className="asset-manager__button asset-manager__button--danger"
											onClick={() => void handleDelete(holding.id)}
											disabled={busy || deletingId === holding.id}
										>
											{deletingId === holding.id ? "删除中..." : "删除"}
										</button>
									) : null}
								</div>
							</div>

							<div className="asset-manager__metric-grid">
								<div className="asset-manager__metric">
									<span>持仓数量</span>
									<strong>{formatQuantity(holding.quantity)}</strong>
								</div>
								<div className="asset-manager__metric">
									<span>折算人民币</span>
									<strong>{formatCnyAmount(holding.value_cny)}</strong>
								</div>
								<div className="asset-manager__metric">
									<span>现价</span>
									<strong>
										{formatMoneyAmount(
											holding.price ?? 0,
											holding.price_currency ?? holding.fallback_currency,
										)}
									</strong>
								</div>
								<div className="asset-manager__metric">
									<span>备用币种</span>
									<strong>{holding.fallback_currency}</strong>
								</div>
							</div>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
