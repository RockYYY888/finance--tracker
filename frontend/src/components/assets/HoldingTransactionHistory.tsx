import "./asset-components.css";
import {
	formatDateValue,
	formatMoneyAmount,
	formatPriceAmount,
	formatQuantity,
} from "../../lib/assetFormatting";
import type { HoldingTransactionRecord } from "../../types/assets";

export interface HoldingTransactionHistoryProps {
	transactions: HoldingTransactionRecord[];
	loading?: boolean;
	errorMessage?: string | null;
}

function getTransactionSideLabel(side: HoldingTransactionRecord["side"]): string {
	switch (side) {
		case "BUY":
			return "买入";
		case "SELL":
			return "卖出";
		case "ADJUST":
			return "编辑";
	}
}

export function HoldingTransactionHistory({
	transactions,
	loading = false,
	errorMessage = null,
}: HoldingTransactionHistoryProps) {
	return (
		<section className="asset-manager__panel">
			<div className="asset-manager__list-head">
				<div>
					<p className="asset-manager__eyebrow">TRANSACTION HISTORY</p>
					<h3>交易记录</h3>
					<p>交易记录用于留痕和核对 持仓纠错请回到左侧持仓卡片点击编辑</p>
				</div>
			</div>

			{errorMessage ? (
				<div className="asset-manager__message asset-manager__message--error">
					{errorMessage}
				</div>
			) : null}

			{loading ? (
				<div className="asset-manager__empty-state">正在加载交易记录...</div>
			) : transactions.length === 0 ? (
				<div className="asset-manager__empty-state">还没有投资交易记录。</div>
			) : (
				<ul className="asset-manager__list">
					{transactions.map((transaction) => (
						<li key={transaction.id} className="asset-manager__card">
							<div className="asset-manager__card-top">
								<div className="asset-manager__card-title">
									<div className="asset-manager__badge-row">
										<span className="asset-manager__badge">
											{getTransactionSideLabel(transaction.side)}
										</span>
										<span className="asset-manager__badge">{transaction.market}</span>
									</div>
									<h3>
										{transaction.name} ({transaction.symbol})
									</h3>
									<p className="asset-manager__card-note">
										{transaction.note?.trim() || `记录 ID #${transaction.id}`}
									</p>
								</div>
							</div>

							<div className="asset-manager__metric-grid asset-manager__metric-grid--triple">
								<div className="asset-manager__metric">
									<span>数量</span>
									<strong>{formatQuantity(transaction.quantity)}</strong>
								</div>
								<div className="asset-manager__metric">
									<span>价格</span>
									<strong>
										{transaction.price != null
											? formatPriceAmount(
												transaction.price,
												transaction.fallback_currency,
											)
											: "未填写"}
									</strong>
								</div>
								<div className="asset-manager__metric">
									<span>{transaction.side === "ADJUST" ? "买入日期" : "交易日"}</span>
									<strong>{formatDateValue(transaction.traded_on)}</strong>
								</div>
							</div>

							{transaction.side === "SELL" ? (
								<div className="asset-manager__helper-block">
									<p>
										卖出金额
										{transaction.price != null
											? ` ${formatMoneyAmount(
												transaction.quantity * transaction.price,
												transaction.fallback_currency,
											)}`
											: " 未填写"}
									</p>
								</div>
							) : null}
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
