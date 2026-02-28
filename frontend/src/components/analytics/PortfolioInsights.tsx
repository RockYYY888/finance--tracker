import type {
	ValuedCashAccount,
	ValuedHolding,
} from "../../types/portfolioAnalytics";
import {
	formatCny,
	formatPercentage,
	summarizePortfolioInsights,
} from "../../utils/portfolioAnalytics";
import "./analytics.css";

type PortfolioInsightsProps = {
	total_value_cny: number;
	cash_accounts: ValuedCashAccount[];
	holdings: ValuedHolding[];
	title?: string;
	description?: string;
};

export function PortfolioInsights({
	total_value_cny,
	cash_accounts,
	holdings,
	title = "关键洞察",
	description = "把集中度、流动性和账户覆盖压缩成几个可快速决策的信号。",
}: PortfolioInsightsProps) {
	const summary = summarizePortfolioInsights(total_value_cny, cash_accounts, holdings);
	const topHoldingName = summary.topHolding
		? summary.topHolding.name || summary.topHolding.symbol
		: "暂无持仓";
	const cashMessage = summary.cashRatio < 0.1
		? "现金缓冲偏薄，回撤时补仓弹性有限。"
		: summary.cashRatio > 0.45
			? "现金比重偏高，收益弹性可能被压低。"
			: "现金与风险资产比例较均衡。";
	const concentrationMessage = summary.topThreeRatio >= 0.6
		? "前三持仓占比较高，波动会更集中地传导到总资产。"
		: "前三持仓占比适中，分散度尚可。";
	const recommendations = holdings.length === 0
		? ["暂无证券持仓，可先录入核心仓位后再判断集中度。", cashMessage]
		: [concentrationMessage, cashMessage, "持续补齐历史快照，趋势判断会更稳定。"];

	return (
		<section className="analytics-card">
			<div>
				<p className="analytics-card__eyebrow">INSIGHTS</p>
				<h2 className="analytics-card__title">{title}</h2>
				<p className="analytics-card__description">{description}</p>
			</div>

			<div className="analytics-metric-grid">
				<div className="analytics-metric">
					<span>前三持仓集中度</span>
					<strong>{formatPercentage(summary.topThreeRatio)}</strong>
					<p>{concentrationMessage}</p>
				</div>
				<div className="analytics-metric">
					<span>最大持仓</span>
					<strong>{topHoldingName}</strong>
					<p>
						{summary.topHolding
							? `${formatCny(summary.topHolding.value_cny)} · ${formatPercentage(
								summary.topHoldingRatio,
							)}`
							: "录入持仓后自动识别"}
					</p>
				</div>
				<div className="analytics-metric">
					<span>现金占比</span>
					<strong>{formatPercentage(summary.cashRatio)}</strong>
					<p>{cashMessage}</p>
				</div>
				<div className="analytics-metric">
					<span>账户覆盖</span>
					<strong>{summary.cashAccountCount} 个账户</strong>
					<p>
						{summary.platformCount} 个现金平台，{summary.holdingsCount} 个有效持仓
					</p>
				</div>
			</div>

			<div className="analytics-note-list">
				{recommendations.map((item) => (
					<div className="analytics-note" key={item}>
						{item}
					</div>
				))}
			</div>
		</section>
	);
}
