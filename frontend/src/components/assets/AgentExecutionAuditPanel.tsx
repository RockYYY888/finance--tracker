import { useMemo } from "react";

import {
	formatDateValue,
	formatMoneyAmount,
	formatPercentValue,
	formatPriceAmount,
	formatTimestamp,
} from "../../lib/assetFormatting";
import {
	ASSET_CLASS_BADGE_LABELS,
	OPERATION_BADGE_LABELS,
	SOURCE_BADGE_LABELS,
} from "../../lib/assetRecordMeta";
import type {
	AgentRegistrationRecord,
	AgentTaskRecord,
	AssetRecordRecord,
} from "../../types/assets";
import "./asset-components.css";

export interface AgentExecutionAuditPanelProps {
	registrations: AgentRegistrationRecord[];
	tasks: AgentTaskRecord[];
	records: AssetRecordRecord[];
	apiDocUrl: string;
	loading?: boolean;
	errorMessage?: string | null;
}

const TASK_LABELS: Record<string, string> = {
	CREATE_BUY_TRANSACTION: "新增买入",
	CREATE_SELL_TRANSACTION: "新增卖出",
	UPDATE_HOLDING_TRANSACTION: "编辑投资持仓",
	CREATE_CASH_TRANSFER: "新增账户划转",
	UPDATE_CASH_TRANSFER: "编辑账户划转",
	CREATE_CASH_LEDGER_ADJUSTMENT: "现金余额修正",
	UPDATE_CASH_LEDGER_ADJUSTMENT: "编辑现金余额修正",
	DELETE_CASH_LEDGER_ADJUSTMENT: "删除现金余额修正",
};

function formatTaskLabel(taskType: string): string {
	return TASK_LABELS[taskType] ?? taskType;
}

function formatJsonBlock(value: unknown): string {
	return JSON.stringify(value ?? {}, null, 2);
}

function formatRecordAmount(record: AssetRecordRecord): string | null {
	if (record.amount == null || !Number.isFinite(record.amount)) {
		return null;
	}
	if (!record.currency) {
		return String(record.amount);
	}
	if (record.asset_class === "investment") {
		return formatPriceAmount(record.amount, record.currency);
	}
	return formatMoneyAmount(record.amount, record.currency);
}

function AgentRecordList({
	records,
	emptyMessage,
}: {
	records: AssetRecordRecord[];
	emptyMessage: string;
}) {
	if (records.length === 0) {
		return <div className="asset-manager__empty-state">{emptyMessage}</div>;
	}

	return (
		<ul className="asset-manager__list">
			{records.map((record) => {
				const amount = formatRecordAmount(record);
				const hasProfit =
					record.profit_amount != null &&
					record.profit_currency &&
					record.profit_rate_pct != null;
				const profitToneClass =
					(record.profit_amount ?? 0) >= 0
						? "asset-records__profit-chip--positive"
						: "asset-records__profit-chip--negative";

				return (
					<li key={`${record.id}-${record.entity_type}`} className="asset-manager__card">
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
									{record.agent_task_id ? (
										<span className="asset-manager__badge asset-manager__badge--muted">
											任务 #{record.agent_task_id}
										</span>
									) : (
										<span className="asset-manager__badge asset-manager__badge--muted">
											直连 API
										</span>
									)}
								</div>
								<h3>{record.title}</h3>
								<p className="asset-manager__card-note">{record.summary}</p>
							</div>
						</div>

						<div className="asset-manager__metric-grid">
							<div className="asset-manager__metric">
								<span>生效日期</span>
								<strong>{formatDateValue(record.effective_date)}</strong>
							</div>
							<div className="asset-manager__metric">
								<span>记录时间</span>
								<strong>{formatTimestamp(record.created_at)}</strong>
							</div>
							{amount ? (
								<div className="asset-manager__metric">
									<span>记录值</span>
									<strong>{amount}</strong>
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
	);
}

export function AgentExecutionAuditPanel({
	registrations,
	tasks,
	records,
	apiDocUrl,
	loading = false,
	errorMessage = null,
}: AgentExecutionAuditPanelProps) {
	const recordsByTaskId = useMemo(() => {
		const nextMap = new Map<number, AssetRecordRecord[]>();
		for (const record of records) {
			if (record.agent_task_id == null) {
				continue;
			}
			const currentItems = nextMap.get(record.agent_task_id) ?? [];
			currentItems.push(record);
			nextMap.set(record.agent_task_id, currentItems);
		}
		return nextMap;
	}, [records]);

	const directApiRecords = useMemo(
		() => records.filter((record) => record.agent_task_id == null),
		[records],
	);

	const activeRegistrationCount = registrations.filter(
		(registration) => registration.status === "ACTIVE",
	).length;
	const connectedAccountCount = new Set(registrations.map((registration) => registration.user_id)).size;

	return (
		<section className="asset-manager__panel">
			<div className="asset-manager__list-head">
				<div>
					<p className="asset-manager__eyebrow">AGENT WORKSPACE</p>
					<h3>智能体工作台</h3>
					<p>查看已注册 Agent、Agent 任务和仅来源于 Agent 的真实落库记录。</p>
				</div>
			</div>

			<div className="agent-workspace__top-grid">
				<div className="asset-manager__helper-block">
					<strong>Agent API</strong>
					<p>文档已整理到 GitHub，供外部 Agent 或自动化服务按约定调用。</p>
					<a
						className="hero-note hero-note--action agent-workspace__doc-link"
						href={apiDocUrl}
						target="_blank"
						rel="noreferrer"
					>
						打开 API 文档
					</a>
				</div>
				<div className="asset-manager__summary">
					<div className="asset-manager__summary-card">
						<span>已注册 Agent</span>
						<strong>{registrations.length}</strong>
					</div>
					<div className="asset-manager__summary-card">
						<span>活跃 Agent</span>
						<strong>{activeRegistrationCount}</strong>
					</div>
					<div className="asset-manager__summary-card">
						<span>接入账号</span>
						<strong>{connectedAccountCount}</strong>
					</div>
					<div className="asset-manager__summary-card">
						<span>Agent 记录</span>
						<strong>{records.length}</strong>
					</div>
				</div>
			</div>

			{errorMessage ? (
				<div className="asset-manager__message asset-manager__message--error">
					{errorMessage}
				</div>
			) : null}

			{loading ? (
				<div className="asset-manager__empty-state">正在加载智能体工作台...</div>
			) : (
				<div className="agent-workspace__sections">
					<section className="agent-workspace__section">
						<div className="asset-manager__list-head">
							<div>
								<p className="asset-manager__eyebrow">REGISTERED AGENTS</p>
								<h3>已注册 Agent</h3>
								<p>这里展示当前系统里已经登记并可追踪的 Agent 接入关系和活跃状态。</p>
							</div>
						</div>
						{registrations.length === 0 ? (
							<div className="asset-manager__empty-state">当前还没有已注册的 Agent。</div>
						) : (
							<ul className="asset-manager__list">
								{registrations.map((registration) => (
									<li key={registration.id} className="asset-manager__card">
										<div className="asset-manager__card-top">
											<div className="asset-manager__card-title">
												<div className="asset-manager__badge-row">
													<span className="asset-manager__badge">#{registration.id}</span>
													<span
														className={`asset-manager__badge ${
															registration.status === "ACTIVE"
																? "asset-records__source-badge"
																: "asset-manager__badge--muted"
														}`}
													>
														{registration.status === "ACTIVE" ? "活跃" : "停用"}
													</span>
												</div>
												<h3>{registration.name}</h3>
												<p className="asset-manager__card-note">
													接入账号：{registration.user_id}
												</p>
											</div>
										</div>
										<div className="asset-manager__metric-grid">
											<div className="asset-manager__metric">
												<span>活跃令牌</span>
												<strong>{registration.active_token_count}</strong>
											</div>
											<div className="asset-manager__metric">
												<span>全部令牌</span>
												<strong>{registration.total_token_count}</strong>
											</div>
											<div className="asset-manager__metric">
												<span>最近使用</span>
												<strong>{formatTimestamp(registration.last_used_at)}</strong>
											</div>
											<div className="asset-manager__metric">
												<span>最近接入</span>
												<strong>{formatTimestamp(registration.last_seen_at)}</strong>
											</div>
										</div>
										{registration.latest_token_hint ? (
											<div className="asset-manager__helper-block">
												<strong>最近令牌提示</strong>
												<p>{registration.latest_token_hint}</p>
											</div>
										) : null}
									</li>
								))}
							</ul>
						)}
					</section>

					<section className="agent-workspace__section">
						<div className="asset-manager__list-head">
							<div>
								<p className="asset-manager__eyebrow">TASKS AND AUDIT</p>
								<h3>任务与审计</h3>
								<p>任务展示 Agent 的执行输入和结果，审计展示只来源于 Agent 的真实记录。</p>
							</div>
						</div>
						{tasks.length === 0 ? (
							<div className="asset-manager__empty-state">还没有 Agent 任务。</div>
						) : (
							<ul className="asset-manager__list">
								{tasks.map((task) => {
									const relatedRecords = recordsByTaskId.get(task.id) ?? [];
									return (
										<li key={task.id} className="asset-manager__card">
											<div className="asset-manager__card-top">
												<div className="asset-manager__card-title">
													<div className="asset-manager__badge-row">
														<span className="asset-manager__badge">AGENT</span>
														<span className="asset-manager__badge asset-manager__badge--muted">
															{task.status}
														</span>
													</div>
													<h3>{formatTaskLabel(task.task_type)} · 任务 #{task.id}</h3>
													<p className="asset-manager__card-note">
														创建于 {formatTimestamp(task.created_at)}
													</p>
												</div>
											</div>

											<div className="asset-manager__metric-grid">
												<div className="asset-manager__metric">
													<span>任务状态</span>
													<strong>{task.status}</strong>
												</div>
												<div className="asset-manager__metric">
													<span>完成时间</span>
													<strong>{formatTimestamp(task.completed_at)}</strong>
												</div>
												<div className="asset-manager__metric">
													<span>关联记录</span>
													<strong>{relatedRecords.length}</strong>
												</div>
											</div>

											<div className="asset-manager__preview-grid">
												<div className="asset-manager__preview-item">
													<span>任务输入</span>
													<pre className="asset-manager__code-block">
														{formatJsonBlock(task.payload)}
													</pre>
												</div>
												<div className="asset-manager__preview-item">
													<span>任务结果</span>
													<pre className="asset-manager__code-block">
														{task.error_message?.trim()
															? task.error_message
															: formatJsonBlock(task.result)}
													</pre>
												</div>
											</div>

											<div className="agent-workspace__task-records">
												<strong>关联审计记录</strong>
												<AgentRecordList
													records={relatedRecords}
													emptyMessage="这个任务还没有关联的 Agent 记录。"
												/>
											</div>
										</li>
									);
								})}
							</ul>
						)}
					</section>

					<section className="agent-workspace__section">
						<div className="asset-manager__list-head">
							<div>
								<p className="asset-manager__eyebrow">DIRECT AGENT RECORDS</p>
								<h3>直连 API 记录</h3>
								<p>这里展示未经过任务队列、但来源明确为 Agent 的直接调用落库记录。</p>
							</div>
						</div>
						<AgentRecordList
							records={directApiRecords}
							emptyMessage="当前没有直连 API 的 Agent 记录。"
						/>
					</section>
				</div>
			)}
		</section>
	);
}
