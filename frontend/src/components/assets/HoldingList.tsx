import { useState } from "react";
import "./asset-components.css";
import {
	formatCnyAmount,
	formatDateValue,
	formatPercentValue,
	formatPriceAmount,
	formatQuantity,
	formatSecurityMarket,
	formatTimestamp,
} from "../../lib/assetFormatting";
import { toErrorMessage } from "../../lib/apiClient";
import type { HoldingRecord, MaybePromise } from "../../types/assets";

function shouldShowHoldingSource(source?: string | null): boolean {
	return Boolean(source && source !== "代码推断" && source !== "本地映射");
}

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
}

export function HoldingList({
	holdings,
	title = "投资类持仓",
	subtitle,
	loading = false,
	busy = false,
	errorMessage = null,
	emptyMessage = "暂无投资类资产。",
	onCreate,
	onEdit,
	onDelete,
}: HoldingListProps) {
	const [localError, setLocalError] = useState<string | null>(null);
	const [deletingId, setDeletingId] = useState<number | null>(null);

	const effectiveError = localError ?? errorMessage;
	const isActionLocked = busy;

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
					{subtitle ? <p>{subtitle}</p> : null}
				</div>
				<div className="asset-manager__mini-actions">
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
				<div className="asset-manager__empty-state">正在加载投资类资产...</div>
			) : holdings.length === 0 ? (
				<div className="asset-manager__empty-state">{emptyMessage}</div>
			) : (
				<ul className="asset-manager__list">
					{holdings.map((holding) => (
						<li key={holding.id} className="asset-manager__card">
							<div className="asset-manager__card-top">
								<div className="asset-manager__card-title">
									<div className="asset-manager__badge-row">
										<span className="asset-manager__badge">{holding.symbol}</span>
										<span className="asset-manager__badge asset-manager__badge--muted">
											{formatSecurityMarket(holding.market)}
										</span>
									</div>
									<h3>{holding.name}</h3>
									<p className="asset-manager__card-note">
										更新：{formatTimestamp(holding.last_updated)}
										{shouldShowHoldingSource(holding.broker?.trim())
											? ` · ${holding.broker?.trim()}`
											: ""}
										{holding.note?.trim() ? ` · ${holding.note}` : ""}
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
									<span>
										{holding.market === "FUND"
											? "份额"
											: holding.market === "CRYPTO"
												? "数量"
												: "数量（股/支）"}
									</span>
									<strong>{formatQuantity(holding.quantity)}</strong>
								</div>
								<div className="asset-manager__metric">
									<span>折算人民币</span>
									<strong>{formatCnyAmount(holding.value_cny)}</strong>
								</div>
								<div className="asset-manager__metric">
									<span>现价</span>
									<strong>
										{formatPriceAmount(
											holding.price ?? 0,
											holding.price_currency ?? holding.fallback_currency,
										)}
									</strong>
								</div>
								<div className="asset-manager__metric">
									<span>持仓价</span>
									<strong>
										{holding.cost_basis_price != null
											? formatPriceAmount(
												holding.cost_basis_price,
												holding.fallback_currency,
											)
											: "待填写"}
									</strong>
								</div>
								<div className="asset-manager__metric">
									<span>收益率</span>
									<strong>
										{holding.return_pct != null
											? formatPercentValue(holding.return_pct)
											: "待计算"}
									</strong>
								</div>
								<div className="asset-manager__metric">
									<span>计价币种</span>
									<strong>{holding.fallback_currency}</strong>
								</div>
								<div className="asset-manager__metric">
									<span>市场</span>
									<strong>{formatSecurityMarket(holding.market)}</strong>
								</div>
								<div className="asset-manager__metric">
									<span>持仓日</span>
									<strong>{formatDateValue(holding.started_on)}</strong>
								</div>
							</div>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
