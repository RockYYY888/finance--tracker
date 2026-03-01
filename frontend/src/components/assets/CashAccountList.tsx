import { useState } from "react";
import "./asset-components.css";
import {
	formatCashAccountType,
	formatCnyAmount,
	formatMoneyAmount,
} from "../../lib/assetFormatting";
import { toErrorMessage } from "../../lib/apiClient";
import type { CashAccountRecord, MaybePromise } from "../../types/assets";

export interface CashAccountListProps {
	accounts: CashAccountRecord[];
	title?: string;
	subtitle?: string;
	loading?: boolean;
	busy?: boolean;
	errorMessage?: string | null;
	emptyMessage?: string;
	onCreate?: () => void;
	onEdit?: (account: CashAccountRecord) => void;
	onDelete?: (recordId: number) => MaybePromise<unknown>;
}

export function CashAccountList({
	accounts,
	title = "现金账户",
	subtitle,
	loading = false,
	busy = false,
	errorMessage = null,
	emptyMessage = "暂无现金账户，先录入一笔备用金或存款。",
	onCreate,
	onEdit,
	onDelete,
}: CashAccountListProps) {
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
			setLocalError(toErrorMessage(error, "删除现金账户失败，请稍后重试。"));
		} finally {
			setDeletingId(null);
		}
	}

	return (
		<section className="asset-manager__panel">
			<div className="asset-manager__list-head">
				<div>
					<p className="asset-manager__eyebrow">CASH LIST</p>
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
				<div className="asset-manager__empty-state">正在加载现金账户...</div>
			) : accounts.length === 0 ? (
				<div className="asset-manager__empty-state">{emptyMessage}</div>
			) : (
				<ul className="asset-manager__list">
					{accounts.map((account) => (
						<li key={account.id} className="asset-manager__card">
							<div className="asset-manager__card-top">
								<div className="asset-manager__card-title">
									<div className="asset-manager__badge-row">
										<span className="asset-manager__badge">
											{formatCashAccountType(account.account_type)}
										</span>
									</div>
									<h3>{account.name}</h3>
									<p className="asset-manager__card-note">
										{account.note?.trim() || `账户 ID #${account.id}`}
									</p>
								</div>
								<div className="asset-manager__card-actions">
									{onEdit ? (
										<button
											type="button"
											className="asset-manager__button asset-manager__button--secondary"
											onClick={() => onEdit(account)}
											disabled={isActionLocked}
										>
											编辑
										</button>
									) : null}
									{onDelete ? (
										<button
											type="button"
											className="asset-manager__button asset-manager__button--danger"
											onClick={() => void handleDelete(account.id)}
											disabled={busy || deletingId === account.id}
										>
											{deletingId === account.id ? "删除中..." : "删除"}
										</button>
									) : null}
								</div>
							</div>

							<div className="asset-manager__metric-grid">
								<div className="asset-manager__metric">
									<span>账户余额</span>
									<strong>
										{formatMoneyAmount(account.balance, account.currency)}
									</strong>
								</div>
								<div className="asset-manager__metric">
									<span>折算人民币</span>
									<strong>{formatCnyAmount(account.value_cny)}</strong>
								</div>
							</div>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
