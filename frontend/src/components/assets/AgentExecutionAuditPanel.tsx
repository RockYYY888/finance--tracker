import { useMemo } from "react";
import "./asset-components.css";
import type {
	AgentTaskRecord,
	AssetMutationAuditRecord,
} from "../../types/assets";

export interface AgentExecutionAuditPanelProps {
	tasks: AgentTaskRecord[];
	audits: AssetMutationAuditRecord[];
	loading?: boolean;
	errorMessage?: string | null;
}

const TASK_LABELS: Record<string, string> = {
	CREATE_BUY_TRANSACTION: "新增买入",
	CREATE_SELL_TRANSACTION: "新增卖出",
	UPDATE_HOLDING_TRANSACTION: "修正交易单",
	CREATE_CASH_TRANSFER: "新增账户划转",
	UPDATE_CASH_TRANSFER: "修正账户划转",
	CREATE_CASH_LEDGER_ADJUSTMENT: "新增手工账本调整",
	UPDATE_CASH_LEDGER_ADJUSTMENT: "修正手工账本调整",
	DELETE_CASH_LEDGER_ADJUSTMENT: "删除手工账本调整",
};

function formatTimestamp(value?: string | null): string {
	if (!value) {
		return "未记录";
	}
	const parsedDate = new Date(value);
	if (Number.isNaN(parsedDate.getTime())) {
		return value;
	}
	return new Intl.DateTimeFormat("zh-CN", {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	}).format(parsedDate);
}

function formatTaskLabel(taskType: string): string {
	return TASK_LABELS[taskType] ?? taskType;
}

function formatJsonBlock(value: unknown): string {
	return JSON.stringify(value ?? {}, null, 2);
}

function formatAuditState(value?: string | null): string | null {
	if (!value?.trim()) {
		return null;
	}
	try {
		return JSON.stringify(JSON.parse(value), null, 2);
	} catch {
		return value;
	}
}

export function AgentExecutionAuditPanel({
	tasks,
	audits,
	loading = false,
	errorMessage = null,
}: AgentExecutionAuditPanelProps) {
	const auditsByTaskId = useMemo(() => {
		const nextMap = new Map<number, AssetMutationAuditRecord[]>();
		for (const audit of audits) {
			if (audit.agent_task_id == null) {
				continue;
			}
			const currentItems = nextMap.get(audit.agent_task_id) ?? [];
			currentItems.push(audit);
			nextMap.set(audit.agent_task_id, currentItems);
		}
		return nextMap;
	}, [audits]);

	return (
		<section className="asset-manager__panel">
			<div className="asset-manager__list-head">
				<div>
					<p className="asset-manager__eyebrow">AGENT AUDIT</p>
					<h3>智能体执行审计</h3>
					<p>这里展示 agent 任务输入、结果和落到数据库的实际变更 便于回看和追责。</p>
				</div>
			</div>

			<div className="asset-manager__helper-block">
				<strong>审计边界</strong>
				<p>每个任务卡片都会绑定对应的资产变更审计日志 任务成功不代表没有副作用 这里应作为最终核对面板。</p>
			</div>

			{errorMessage ? (
				<div className="asset-manager__message asset-manager__message--error">
					{errorMessage}
				</div>
			) : null}

			{loading ? (
				<div className="asset-manager__empty-state">正在加载智能体审计...</div>
			) : tasks.length === 0 ? (
				<div className="asset-manager__empty-state">还没有智能体执行记录。</div>
			) : (
				<ul className="asset-manager__list">
					{tasks.map((task) => {
						const relatedAudits = auditsByTaskId.get(task.id) ?? [];

						return (
							<li key={task.id} className="asset-manager__card">
								<div className="asset-manager__card-top">
									<div className="asset-manager__card-title">
										<div className="asset-manager__badge-row">
											<span className="asset-manager__badge">AGENT</span>
											<span className="asset-manager__badge">{task.status}</span>
										</div>
										<h3>
											{formatTaskLabel(task.task_type)} · 任务 #{task.id}
										</h3>
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
										<span>落库变更</span>
										<strong>{relatedAudits.length}</strong>
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

								{relatedAudits.length > 0 ? (
									<div className="asset-manager__form">
										{relatedAudits.map((audit) => {
											const beforeState = formatAuditState(audit.before_state);
											const afterState = formatAuditState(audit.after_state);

											return (
												<div key={audit.id} className="asset-manager__helper-block">
													<strong>
														{audit.entity_type} · {audit.operation}
													</strong>
													<p>
														{audit.reason?.trim() || "无附加原因"} ·{" "}
														{formatTimestamp(audit.created_at)}
													</p>
													{beforeState ? (
														<pre className="asset-manager__code-block">{beforeState}</pre>
													) : null}
													{afterState ? (
														<pre className="asset-manager__code-block">{afterState}</pre>
													) : null}
												</div>
											);
										})}
									</div>
								) : null}
							</li>
						);
					})}
				</ul>
			)}
		</section>
	);
}
