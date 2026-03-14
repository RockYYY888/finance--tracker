import { useEffect, useMemo, useRef, useState } from "react";

import { useBodyScrollLock } from "../../hooks/useBodyScrollLock";
import {
	formatDateValue,
	formatMoneyAmount,
	formatPercentValue,
	formatPriceAmount,
	formatTimestamp,
} from "../../lib/assetFormatting";
import {
	ASSET_CLASS_BADGE_LABELS,
	ASSET_CLASS_OPTIONS,
	OPERATION_BADGE_LABELS,
	OPERATION_OPTIONS_BY_CLASS,
	SOURCE_BADGE_LABELS,
	SOURCE_FILTER_OPTIONS,
	type AssetRecordOperationFilterValue,
} from "../../lib/assetRecordMeta";
import type {
	AssetRecordAssetClass,
	AssetRecordOperationKind,
	AssetRecordRecord,
	AssetRecordSource,
} from "../../types/assets";
import "./asset-components.css";

type AssetRecordSourceFilter = AssetRecordSource | "ALL";

export interface AssetRecordsDialogProps {
	open: boolean;
	onClose: () => void;
	onLoadRecords: (params: {
		limit?: number;
		assetClass?: AssetRecordAssetClass;
		operationKind?: AssetRecordOperationKind;
		source?: AssetRecordSource;
	}) => Promise<AssetRecordRecord[]>;
	refreshToken?: number;
}

const DEFAULT_ASSET_CLASS: AssetRecordAssetClass = "cash";
const DEFAULT_OPERATION_KIND: AssetRecordOperationFilterValue = "ALL";
const DEFAULT_SOURCE_FILTER: AssetRecordSourceFilter = "ALL";

function formatRecordAmount(record: AssetRecordRecord): string | null {
	if (record.amount == null || !Number.isFinite(record.amount)) {
		return null;
	}
	if (record.currency) {
		if (record.asset_class === "investment") {
			return formatPriceAmount(record.amount, record.currency);
		}
		return formatMoneyAmount(record.amount, record.currency);
	}
	return String(record.amount);
}

function resolveAmountLabel(record: AssetRecordRecord): string {
	if (record.asset_class === "investment") {
		return record.operation_kind === "SELL" ? "卖出价" : "成交价";
	}
	if (record.asset_class === "cash") {
		return record.operation_kind === "TRANSFER" ? "划转金额" : "金额";
	}
	if (record.asset_class === "liability") {
		return "余额";
	}
	return "数值";
}

function resolveEffectiveDateLabel(record: AssetRecordRecord): string {
	if (record.asset_class === "investment") {
		return record.operation_kind === "SELL" ? "卖出日期" : "生效日期";
	}
	if (record.asset_class === "cash" && record.operation_kind === "TRANSFER") {
		return "划转日期";
	}
	return "生效日期";
}

export function AssetRecordsDialog({
	open,
	onClose,
	onLoadRecords,
	refreshToken = 0,
}: AssetRecordsDialogProps) {
	const [selectedAssetClass, setSelectedAssetClass] =
		useState<AssetRecordAssetClass>(DEFAULT_ASSET_CLASS);
	const [selectedOperationKind, setSelectedOperationKind] =
		useState<AssetRecordOperationFilterValue>(DEFAULT_OPERATION_KIND);
	const [selectedSource, setSelectedSource] =
		useState<AssetRecordSourceFilter>(DEFAULT_SOURCE_FILTER);
	const [records, setRecords] = useState<AssetRecordRecord[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const requestSequenceRef = useRef(0);

	useBodyScrollLock(open);

	const operationOptions = useMemo(
		() => OPERATION_OPTIONS_BY_CLASS[selectedAssetClass],
		[selectedAssetClass],
	);
	const effectiveOperationKind = operationOptions.some(
		(option) => option.value === selectedOperationKind,
	)
		? selectedOperationKind
		: operationOptions[0].value;

	useEffect(() => {
		if (!open) {
			return;
		}

		setSelectedAssetClass(DEFAULT_ASSET_CLASS);
		setSelectedOperationKind(DEFAULT_OPERATION_KIND);
		setSelectedSource(DEFAULT_SOURCE_FILTER);
		setRecords([]);
		setErrorMessage(null);
	}, [open]);

	useEffect(() => {
		if (!open) {
			return;
		}

		if (!operationOptions.some((option) => option.value === selectedOperationKind)) {
			setSelectedOperationKind(operationOptions[0].value);
		}
	}, [open, operationOptions, selectedOperationKind]);

	useEffect(() => {
		if (!open) {
			return;
		}

		function handleKeyDown(event: KeyboardEvent): void {
			if (event.key === "Escape" && !isLoading) {
				onClose();
			}
		}

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isLoading, onClose, open]);

	useEffect(() => {
		if (!open) {
			return;
		}

		const requestId = requestSequenceRef.current + 1;
		requestSequenceRef.current = requestId;
		setIsLoading(true);
		setErrorMessage(null);

		void onLoadRecords({
			limit: 200,
			assetClass: selectedAssetClass,
			operationKind:
				effectiveOperationKind === "ALL" ? undefined : effectiveOperationKind,
			source: selectedSource === "ALL" ? undefined : selectedSource,
		})
			.then((nextRecords) => {
				if (requestSequenceRef.current !== requestId) {
					return;
				}
				setRecords(nextRecords);
			})
			.catch((error: unknown) => {
				if (requestSequenceRef.current !== requestId) {
					return;
				}
				setErrorMessage(error instanceof Error ? error.message : "记录加载失败，请稍后再试。");
			})
			.finally(() => {
				if (requestSequenceRef.current === requestId) {
					setIsLoading(false);
				}
			});
	}, [effectiveOperationKind, open, onLoadRecords, refreshToken, selectedAssetClass, selectedSource]);

	if (!open) {
		return null;
	}

	return (
		<div className="feedback-modal" role="dialog" aria-modal="true" aria-labelledby="asset-records-title">
			<button
				type="button"
				className="feedback-modal__backdrop"
				onClick={isLoading ? undefined : onClose}
				aria-label="关闭记录窗口"
			/>
			<div className="feedback-modal__panel asset-records__modal-panel">
				<div className="feedback-modal__head asset-records__head">
					<div>
						<p className="eyebrow">ASSET RECORDS</p>
						<h2 id="asset-records-title">记录</h2>
						<p className="feedback-modal__copy">
							这里按资产类别和实际操作分类展示已落库记录 仅供查看与核对 不支持修改。
						</p>
					</div>
					<button
						type="button"
						className="hero-note hero-note--action"
						onClick={onClose}
						disabled={isLoading}
					>
						关闭
					</button>
				</div>

				<div className="asset-records__filters">
					<div className="asset-records__filter-group">
						<span className="asset-records__filter-label">资产类别</span>
						<div className="asset-manager__filter-row">
							{ASSET_CLASS_OPTIONS.map((option) => (
								<button
									key={option.value}
									type="button"
									className={`asset-manager__filter-chip ${
										selectedAssetClass === option.value ? "is-active" : ""
									}`}
									onClick={() => setSelectedAssetClass(option.value)}
								>
									{option.label}
								</button>
							))}
						</div>
					</div>

					<div className="asset-records__filter-group">
						<span className="asset-records__filter-label">操作类型</span>
						<div className="asset-manager__filter-row">
							{operationOptions.map((option) => (
								<button
									key={option.value}
									type="button"
									className={`asset-manager__filter-chip ${
										selectedOperationKind === option.value ? "is-active" : ""
									}`}
									onClick={() => setSelectedOperationKind(option.value)}
								>
									{option.label}
								</button>
							))}
						</div>
					</div>

					<div className="asset-records__filter-group">
						<span className="asset-records__filter-label">来源</span>
						<div className="asset-manager__filter-row">
							{SOURCE_FILTER_OPTIONS.map((option) => (
								<button
									key={option.value}
									type="button"
									className={`asset-manager__filter-chip ${
										selectedSource === option.value ? "is-active" : ""
									}`}
									onClick={() => setSelectedSource(option.value)}
								>
									{option.label}
								</button>
							))}
						</div>
					</div>
				</div>

				{errorMessage ? (
					<div className="asset-manager__message asset-manager__message--error">
						{errorMessage}
					</div>
				) : null}

				{isLoading ? (
					<div className="asset-manager__empty-state">正在加载记录...</div>
				) : records.length === 0 ? (
					<div className="asset-manager__empty-state">当前筛选下还没有记录。</div>
				) : (
					<ul className="asset-manager__list asset-records__list">
						{records.map((record) => {
							const formattedAmount = formatRecordAmount(record);
							const hasProfit =
								record.profit_amount != null &&
								record.profit_currency &&
								record.profit_rate_pct != null;
							const profitToneClass =
								(record.profit_amount ?? 0) >= 0
									? "asset-records__profit-chip--positive"
									: "asset-records__profit-chip--negative";

							return (
								<li key={`${record.entity_type}-${record.id}`} className="asset-manager__card">
									<div className="asset-manager__card-top">
										<div className="asset-manager__card-title">
											<div className="asset-manager__badge-row">
												<span className="asset-manager__badge asset-manager__badge--muted">
													{ASSET_CLASS_BADGE_LABELS[record.asset_class]}
												</span>
												<span className="asset-manager__badge">
													{OPERATION_BADGE_LABELS[record.operation_kind]}
												</span>
												<span className="asset-manager__badge asset-records__source-badge">
													{SOURCE_BADGE_LABELS[record.source]}
												</span>
											</div>
											<h3>{record.title}</h3>
											<p className="asset-manager__card-note">{record.summary}</p>
										</div>
									</div>

									<div className="asset-manager__metric-grid">
										<div className="asset-manager__metric">
											<span>{resolveEffectiveDateLabel(record)}</span>
											<strong>{formatDateValue(record.effective_date)}</strong>
										</div>
										<div className="asset-manager__metric">
											<span>记录时间</span>
											<strong>{formatTimestamp(record.created_at)}</strong>
										</div>
										{formattedAmount ? (
											<div className="asset-manager__metric">
												<span>{resolveAmountLabel(record)}</span>
												<strong>{formattedAmount}</strong>
											</div>
										) : null}
										{hasProfit ? (
											<div className={`asset-manager__metric asset-records__profit-chip ${profitToneClass}`}>
												<span>已实现盈利</span>
												<strong>
													{formatMoneyAmount(
														record.profit_amount ?? 0,
														record.profit_currency ?? "CNY",
													)}
												</strong>
												<p className="asset-records__profit-rate">
													收益率 {formatPercentValue(record.profit_rate_pct)}
												</p>
											</div>
										) : null}
									</div>
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</div>
	);
}
