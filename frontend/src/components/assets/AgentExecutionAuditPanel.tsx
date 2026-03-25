import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";

import { useBodyScrollLock } from "../../hooks/useBodyScrollLock";
import { useAutoRefreshGuard } from "../../lib/autoRefreshGuards";
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
	AgentApiKeyIssueRecord,
	AgentApiKeyRecord,
	AgentRegistrationRecord,
	AgentTaskRecord,
	AssetRecordRecord,
	AssetRecordSource,
} from "../../types/assets";
import "./asset-components.css";

export interface AgentExecutionAuditPanelProps {
	apiKeys: AgentApiKeyRecord[];
	registrations: AgentRegistrationRecord[];
	tasks: AgentTaskRecord[];
	records: AssetRecordRecord[];
	apiDocUrl: string;
	loading?: boolean;
	errorMessage?: string | null;
	apiKeyErrorMessage?: string | null;
	apiKeyNoticeMessage?: string | null;
	issuedApiKey?: AgentApiKeyIssueRecord | null;
	isCreatingApiKey?: boolean;
	revokingApiKeyId?: number | null;
	onCreateApiKey?: (name: string) => void;
	onRevokeApiKey?: (tokenId: number) => void;
	onDismissIssuedApiKey?: () => void;
}

const MAX_ACTIVE_API_KEYS = 5;
const MAX_DAILY_API_KEY_CREATIONS = 10;

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

const REQUEST_SOURCE_LABELS: Record<AssetRecordSource, string> = {
	USER: "用户",
	SYSTEM: "系统",
	API: "直连 API",
	AGENT: "Agent",
};

type ActivityView = "ALL" | "TASKS" | "RECORDS";
type ActivitySourceFilter = "ALL" | "AGENT" | "API";

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

function isApiKeyActive(apiKey: AgentApiKeyRecord): boolean {
	if (apiKey.revoked_at) {
		return false;
	}
	if (!apiKey.expires_at) {
		return true;
	}
	const expiresAt = Date.parse(apiKey.expires_at);
	return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

function getApiKeyStatus(apiKey: AgentApiKeyRecord): {
	label: string;
	className: string;
} {
	if (apiKey.revoked_at) {
		return {
			label: "已删除",
			className: "asset-manager__badge asset-manager__badge--muted",
		};
	}
	if (apiKey.expires_at) {
		const expiresAt = Date.parse(apiKey.expires_at);
		if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
			return {
				label: "已过期",
				className: "asset-manager__badge asset-manager__badge--muted",
			};
		}
	}
	return {
		label: "有效",
		className: "asset-manager__badge asset-records__source-badge",
	};
}

function describeRequestIdentity(
	source: AssetRecordSource,
	agentName?: string | null,
): string {
	if (source === "AGENT") {
		return agentName?.trim() ? `Agent · ${agentName}` : "Agent";
	}
	return REQUEST_SOURCE_LABELS[source];
}

async function copyTextToClipboard(value: string): Promise<void> {
	if (
		typeof navigator !== "undefined"
		&& navigator.clipboard
		&& typeof navigator.clipboard.writeText === "function"
	) {
		await navigator.clipboard.writeText(value);
		return;
	}

	if (typeof document === "undefined") {
		throw new Error("当前环境不支持剪贴板复制。");
	}

	const textarea = document.createElement("textarea");
	textarea.value = value;
	textarea.setAttribute("readonly", "true");
	textarea.style.position = "absolute";
	textarea.style.opacity = "0";
	document.body.appendChild(textarea);
	textarea.select();
	try {
		document.execCommand("copy");
	} finally {
		document.body.removeChild(textarea);
	}
}

function AgentWorkspaceDialog({
	open,
	onClose,
	title,
	eyebrow,
	description,
	children,
	panelClassName,
	dialogScope,
}: {
	open: boolean;
	onClose: () => void;
	title: string;
	eyebrow: string;
	description: string;
	children: ReactNode;
	panelClassName?: string;
	dialogScope: string;
}) {
	useBodyScrollLock(open);
	useAutoRefreshGuard(open, dialogScope);

	useEffect(() => {
		if (!open) {
			return;
		}

		function handleKeyDown(event: KeyboardEvent): void {
			if (event.key === "Escape") {
				onClose();
			}
		}

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [onClose, open]);

	if (!open) {
		return null;
	}

	return (
		<div className="feedback-modal" role="dialog" aria-modal="true" aria-labelledby={`${dialogScope}-title`}>
			<button
				type="button"
				className="feedback-modal__backdrop"
				onClick={onClose}
				aria-label={`关闭${title}`}
			/>
			<div
				className={`feedback-modal__panel agent-workspace__modal-panel ${panelClassName ?? ""}`.trim()}
			>
				<div className="feedback-modal__head agent-workspace__modal-head">
					<div>
						<p className="eyebrow">{eyebrow}</p>
						<h2 id={`${dialogScope}-title`}>{title}</h2>
						<p className="feedback-modal__copy">{description}</p>
					</div>
					<button
						type="button"
						className="hero-note hero-note--action"
						onClick={onClose}
					>
						关闭
					</button>
				</div>
				{children}
			</div>
		</div>
	);
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
		<ul className="asset-manager__list asset-records__list">
			{records.map((record) => {
				const amount = formatRecordAmount(record);
				const hasProfit =
					record.profit_amount != null
					&& record.profit_currency
					&& record.profit_rate_pct != null;
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
									<span className="asset-manager__badge asset-manager__badge--muted">
										{describeRequestIdentity(record.source, record.agent_name)}
									</span>
								</div>
								<h3>{record.title}</h3>
								<p className="asset-manager__card-note">{record.summary}</p>
							</div>
						</div>

						<div className="asset-manager__metric-grid">
							<div className="asset-manager__metric">
								<span>API Key</span>
								<strong>{record.api_key_name ?? "—"}</strong>
							</div>
							<div className="asset-manager__metric">
								<span>Agent 名称</span>
								<strong>{record.source === "AGENT" ? record.agent_name ?? "Agent" : "直连 API"}</strong>
							</div>
							<div className="asset-manager__metric">
								<span>生效日期</span>
								<strong>{formatDateValue(record.effective_date)}</strong>
							</div>
							<div className="asset-manager__metric">
								<span>记录时间</span>
								<strong>{formatTimestamp(record.created_at)}</strong>
							</div>
							{record.agent_task_id ? (
								<div className="asset-manager__metric">
									<span>关联任务</span>
									<strong>#{record.agent_task_id}</strong>
								</div>
							) : null}
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

function AgentTaskList({
	tasks,
	recordsByTaskId,
	emptyMessage,
}: {
	tasks: AgentTaskRecord[];
	recordsByTaskId: Map<number, AssetRecordRecord[]>;
	emptyMessage: string;
}) {
	if (tasks.length === 0) {
		return <div className="asset-manager__empty-state">{emptyMessage}</div>;
	}

	return (
		<ul className="asset-manager__list">
			{tasks.map((task) => {
				const relatedRecords = recordsByTaskId.get(task.id) ?? [];

				return (
					<li key={task.id} className="asset-manager__card">
						<div className="asset-manager__card-top">
							<div className="asset-manager__card-title">
								<div className="asset-manager__badge-row">
									<span className="asset-manager__badge">
										{REQUEST_SOURCE_LABELS[task.request_source]}
									</span>
									<span className="asset-manager__badge asset-manager__badge--muted">
										{task.status}
									</span>
									{task.agent_name ? (
										<span className="asset-manager__badge asset-records__source-badge">
											{task.agent_name}
										</span>
									) : (
										<span className="asset-manager__badge asset-manager__badge--muted">
											直连 API
										</span>
									)}
								</div>
								<h3>{formatTaskLabel(task.task_type)} · 任务 #{task.id}</h3>
								<p className="asset-manager__card-note">
									通过 {describeRequestIdentity(task.request_source, task.agent_name)} 发起。
								</p>
							</div>
						</div>

						<div className="asset-manager__metric-grid">
							<div className="asset-manager__metric">
								<span>API Key</span>
								<strong>{task.api_key_name ?? "—"}</strong>
							</div>
							<div className="asset-manager__metric">
								<span>创建时间</span>
								<strong>{formatTimestamp(task.created_at)}</strong>
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
								<pre className="asset-manager__code-block">{formatJsonBlock(task.payload)}</pre>
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
					</li>
				);
			})}
		</ul>
	);
}

export function AgentExecutionAuditPanel({
	apiKeys,
	registrations,
	tasks,
	records,
	apiDocUrl,
	loading = false,
	errorMessage = null,
	apiKeyErrorMessage = null,
	apiKeyNoticeMessage = null,
	issuedApiKey = null,
	isCreatingApiKey = false,
	revokingApiKeyId = null,
	onCreateApiKey,
	onRevokeApiKey,
	onDismissIssuedApiKey,
}: AgentExecutionAuditPanelProps) {
	const [draftApiKeyName, setDraftApiKeyName] = useState("");
	const [clipboardNotice, setClipboardNotice] = useState<string | null>(null);
	const [clipboardError, setClipboardError] = useState<string | null>(null);
	const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
	const [isManageKeysDialogOpen, setIsManageKeysDialogOpen] = useState(false);
	const [isActivityDialogOpen, setIsActivityDialogOpen] = useState(false);
	const [activityView, setActivityView] = useState<ActivityView>("ALL");
	const [activitySourceFilter, setActivitySourceFilter] =
		useState<ActivitySourceFilter>("ALL");

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

	const activeRegistrationCount = registrations.filter(
		(registration) => registration.status === "ACTIVE",
	).length;
	const activeApiKeyCount = apiKeys.filter((apiKey) => isApiKeyActive(apiKey)).length;

	const filteredTasks = useMemo(() => {
		if (activitySourceFilter === "ALL") {
			return tasks;
		}
		return tasks.filter((task) => task.request_source === activitySourceFilter);
	}, [activitySourceFilter, tasks]);

	const filteredRecords = useMemo(() => {
		if (activitySourceFilter === "ALL") {
			return records;
		}
		return records.filter((record) => record.source === activitySourceFilter);
	}, [activitySourceFilter, records]);

	useEffect(() => {
		if (issuedApiKey) {
			setIsCreateDialogOpen(true);
			setDraftApiKeyName("");
		}
	}, [issuedApiKey]);

	function resetClipboardMessages(): void {
		setClipboardNotice(null);
		setClipboardError(null);
	}

	function closeCreateDialog(): void {
		setIsCreateDialogOpen(false);
		setDraftApiKeyName("");
		resetClipboardMessages();
		if (issuedApiKey) {
			onDismissIssuedApiKey?.();
		}
	}

	function handleCreateApiKeySubmit(event: FormEvent<HTMLFormElement>): void {
		event.preventDefault();
		resetClipboardMessages();
		onCreateApiKey?.(draftApiKeyName);
	}

	async function handleCopyIssuedApiKey(): Promise<void> {
		if (!issuedApiKey) {
			return;
		}

		try {
			await copyTextToClipboard(issuedApiKey.access_token);
			setClipboardError(null);
			setClipboardNotice("已复制到剪贴板。请立即保存，这串 API Key 关闭后不会再次显示。");
		} catch (error) {
			setClipboardNotice(null);
			setClipboardError(error instanceof Error ? error.message : "复制失败，请手动保存。");
		}
	}

	return (
		<section className="asset-manager__panel">
			<div className="asset-manager__list-head">
				<div>
					<p className="asset-manager__eyebrow">AGENT WORKSPACE</p>
					<h3>智能体工作台</h3>
					<p>查看已注册 Agent、Agent 任务，以及由 API Key 驱动的真实落库记录。</p>
				</div>
				<div className="asset-manager__panel-actions">
					<button
						type="button"
						className="hero-note hero-note--action"
						onClick={() => setIsActivityDialogOpen(true)}
					>
						查看记录
					</button>
					<button
						type="button"
						className="hero-note hero-note--action"
						onClick={() => setIsManageKeysDialogOpen(true)}
					>
						有效 Key {activeApiKeyCount} / {MAX_ACTIVE_API_KEYS}
					</button>
				</div>
			</div>

			<div className="agent-workspace__top-grid">
				<div className="asset-manager__helper-block">
					<strong>Agent API</strong>
					<p>
						文档已整理到 GitHub。使用 <code>Authorization: Bearer &lt;api_key&gt;</code>{" "}
						调用；如需登记为 Agent，可额外传入 <code>Agent-Name</code>。
					</p>
					<div className="agent-workspace__doc-actions">
						<a
							className="hero-note hero-note--action agent-workspace__doc-link"
							href={apiDocUrl}
							target="_blank"
							rel="noreferrer"
						>
							打开 API 文档
						</a>
						<button
							type="button"
							className="hero-note hero-note--action"
							onClick={() => {
								resetClipboardMessages();
								setIsCreateDialogOpen(true);
							}}
						>
							创建新的 API Key
						</button>
					</div>
				</div>
				<div
					className="asset-manager__summary agent-workspace__summary"
					data-testid="agent-workspace-summary"
				>
					<div className="asset-manager__summary-card">
						<span>已注册 Agent</span>
						<strong>{registrations.length}</strong>
					</div>
					<div className="asset-manager__summary-card">
						<span>活跃 Agent</span>
						<strong>{activeRegistrationCount}</strong>
					</div>
					<div className="asset-manager__summary-card">
						<span>Agent 任务</span>
						<strong>{tasks.length}</strong>
					</div>
					<div className="asset-manager__summary-card">
						<span>API / Agent 记录</span>
						<strong>{records.length}</strong>
					</div>
				</div>
			</div>

			{errorMessage ? (
				<div className="asset-manager__message asset-manager__message--error">
					{errorMessage}
				</div>
			) : null}
			{apiKeyErrorMessage ? (
				<div className="asset-manager__message asset-manager__message--error">
					{apiKeyErrorMessage}
				</div>
			) : null}
			{apiKeyNoticeMessage ? (
				<div className="asset-manager__status-note">{apiKeyNoticeMessage}</div>
			) : null}

			{loading ? (
				<div className="asset-manager__empty-state">正在加载智能体工作台...</div>
			) : (
				<section className="agent-workspace__section">
					<div className="asset-manager__list-head">
						<div>
							<p className="asset-manager__eyebrow">REGISTERED AGENTS</p>
							<h3>已注册 Agent</h3>
							<p>
								只有带非空 <code>Agent-Name</code> 的 Bearer 请求才会在这里登记并累计请求次数。
							</p>
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
													{registration.status === "ACTIVE" ? "活跃" : "非活跃"}
												</span>
											</div>
											<h3>{registration.name}</h3>
											<p className="asset-manager__card-note">账号：{registration.user_id}</p>
										</div>
									</div>
									<div className="asset-manager__metric-grid">
										<div className="asset-manager__metric">
											<span>请求次数</span>
											<strong>{registration.request_count}</strong>
										</div>
										<div className="asset-manager__metric">
											<span>最近 API Key</span>
											<strong>{registration.latest_api_key_name ?? "—"}</strong>
										</div>
										<div className="asset-manager__metric">
											<span>最近接入</span>
											<strong>{formatTimestamp(registration.last_seen_at)}</strong>
										</div>
										<div className="asset-manager__metric">
											<span>首次登记</span>
											<strong>{formatTimestamp(registration.created_at)}</strong>
										</div>
									</div>
								</li>
							))}
						</ul>
					)}
				</section>
			)}

			<AgentWorkspaceDialog
				open={isCreateDialogOpen}
				onClose={closeCreateDialog}
				title={issuedApiKey ? "新 API Key" : "创建新的 API Key"}
				eyebrow="API KEY"
				description={
					issuedApiKey
						? "完整 Key 只会显示这一次。请立即复制并存入密码管理器、系统钥匙串或其他安全位置。"
						: `每个账号最多保留 ${MAX_ACTIVE_API_KEYS} 个有效 Key，每日最多生成 ${MAX_DAILY_API_KEY_CREATIONS} 次。新签发的 Key 统一以 sk- 开头。`
				}
				dialogScope="agent-workspace-create-key"
			>
				<div className="agent-workspace__modal-body">
					{apiKeyErrorMessage ? (
						<div className="asset-manager__message asset-manager__message--error">
							{apiKeyErrorMessage}
						</div>
					) : null}
					{clipboardError ? (
						<div className="asset-manager__message asset-manager__message--error">
							{clipboardError}
						</div>
					) : null}
					{clipboardNotice ? (
						<div className="asset-manager__status-note">{clipboardNotice}</div>
					) : null}
					{issuedApiKey ? (
						<div className="agent-workspace__one-time-secret">
							<div className="asset-manager__helper-block asset-manager__helper-block--highlight">
								<strong>{issuedApiKey.name}</strong>
								<p>这是完整密钥的唯一展示机会。关闭窗口后，平台只会保留掩码提示。</p>
							</div>
							<pre className="asset-manager__code-block">{issuedApiKey.access_token}</pre>
							<div className="asset-manager__form-actions">
								<button
									type="button"
									className="asset-manager__button"
									onClick={() => void handleCopyIssuedApiKey()}
								>
									复制到剪贴板
								</button>
								<button
									type="button"
									className="asset-manager__button asset-manager__button--secondary"
									onClick={closeCreateDialog}
								>
									我已保存
								</button>
							</div>
						</div>
					) : (
						<form className="asset-manager__form" onSubmit={handleCreateApiKeySubmit}>
							<div className="asset-manager__helper-block">
								<strong>命名建议</strong>
								<p>
									用稳定且能区分用途的名称，例如 <code>local-cli</code>、<code>daily-sync</code>{" "}
									或 <code>portfolio-agent</code>。
								</p>
							</div>
							<label className="asset-manager__field">
								<span>Key 名称</span>
								<input
									value={draftApiKeyName}
									onChange={(event) => setDraftApiKeyName(event.target.value)}
									placeholder="例如：daily-sync"
									maxLength={80}
									disabled={isCreatingApiKey || activeApiKeyCount >= MAX_ACTIVE_API_KEYS}
								/>
							</label>
							<div className="asset-manager__form-actions">
								<button
									type="submit"
									className="asset-manager__button"
									disabled={
										isCreatingApiKey
										|| activeApiKeyCount >= MAX_ACTIVE_API_KEYS
										|| draftApiKeyName.trim().length < 3
									}
								>
									{isCreatingApiKey ? "生成中..." : "生成 API Key"}
								</button>
							</div>
						</form>
					)}
				</div>
			</AgentWorkspaceDialog>

			<AgentWorkspaceDialog
				open={isManageKeysDialogOpen}
				onClose={() => setIsManageKeysDialogOpen(false)}
				title="有效 Key"
				eyebrow="API KEYS"
				description="这里可以查看当前账号的 API Key 元信息并删除旧 Key。出于安全原因，完整 Key 不会再次显示，也不支持从这里复制。"
				dialogScope="agent-workspace-manage-keys"
			>
				<div className="agent-workspace__modal-body">
					{apiKeyNoticeMessage ? (
						<div className="asset-manager__status-note">{apiKeyNoticeMessage}</div>
					) : null}
					<div className="asset-manager__helper-block">
						<strong>当前状态</strong>
						<p>
							有效 Key {activeApiKeyCount} / {MAX_ACTIVE_API_KEYS}。删除后可释放名额，但历史记录仍会保留对应的 Key 名称。
						</p>
					</div>
					<div className="agent-workspace__scroll-region">
						{apiKeys.length === 0 ? (
							<div className="asset-manager__empty-state">当前账号还没有 API Key。</div>
						) : (
							<ul className="asset-manager__list">
								{apiKeys.map((apiKey) => {
									const status = getApiKeyStatus(apiKey);
									const canRevoke = !apiKey.revoked_at;
									return (
										<li key={apiKey.id} className="asset-manager__card">
											<div className="asset-manager__card-top">
												<div className="asset-manager__card-title">
													<div className="asset-manager__badge-row">
														<span className="asset-manager__badge">API KEY</span>
														<span className={status.className}>{status.label}</span>
														<span className="asset-manager__badge asset-manager__badge--muted">
															{apiKey.token_hint}
														</span>
													</div>
													<h3>{apiKey.name}</h3>
													<p className="asset-manager__card-note">
														仅保留掩码提示，完整密钥在创建后不会再次返回。
													</p>
												</div>
												{canRevoke ? (
													<div className="asset-manager__card-actions">
														<button
															type="button"
															className="asset-manager__button asset-manager__button--secondary"
															onClick={() => onRevokeApiKey?.(apiKey.id)}
															disabled={revokingApiKeyId === apiKey.id}
														>
															{revokingApiKeyId === apiKey.id ? "删除中..." : "删除"}
														</button>
													</div>
												) : null}
											</div>
											<div className="asset-manager__metric-grid">
												<div className="asset-manager__metric">
													<span>创建时间</span>
													<strong>{formatTimestamp(apiKey.created_at)}</strong>
												</div>
												<div className="asset-manager__metric">
													<span>最近使用</span>
													<strong>{formatTimestamp(apiKey.last_used_at)}</strong>
												</div>
												<div className="asset-manager__metric">
													<span>过期时间</span>
													<strong>
														{apiKey.expires_at ? formatTimestamp(apiKey.expires_at) : "永不过期"}
													</strong>
												</div>
												<div className="asset-manager__metric">
													<span>删除时间</span>
													<strong>{formatTimestamp(apiKey.revoked_at)}</strong>
												</div>
											</div>
										</li>
									);
								})}
							</ul>
						)}
					</div>
				</div>
			</AgentWorkspaceDialog>

			<AgentWorkspaceDialog
				open={isActivityDialogOpen}
				onClose={() => setIsActivityDialogOpen(false)}
				title="记录"
				eyebrow="AGENT ACTIVITY"
				description="按来源查看仅由 API Key 鉴权触发的任务与真实落库记录。这里只读展示，不支持撤销。"
				dialogScope="agent-workspace-activity"
			>
				<div className="agent-workspace__modal-body">
					<div className="asset-records__filters">
						<div className="asset-records__filter-group">
							<span className="asset-records__filter-label">视图</span>
							<div className="asset-manager__filter-row">
								{([
									["ALL", "全部"],
									["TASKS", "任务"],
									["RECORDS", "落库记录"],
								] as const).map(([value, label]) => (
									<button
										key={value}
										type="button"
										className={`asset-manager__filter-chip ${
											activityView === value ? "is-active" : ""
										}`}
										onClick={() => setActivityView(value)}
									>
										{label}
									</button>
								))}
							</div>
						</div>
						<div className="asset-records__filter-group">
							<span className="asset-records__filter-label">来源</span>
							<div className="asset-manager__filter-row">
								{([
									["ALL", "全部"],
									["AGENT", "Agent"],
									["API", "直连 API"],
								] as const).map(([value, label]) => (
									<button
										key={value}
										type="button"
										className={`asset-manager__filter-chip ${
											activitySourceFilter === value ? "is-active" : ""
										}`}
										onClick={() => setActivitySourceFilter(value)}
									>
										{label}
									</button>
								))}
							</div>
						</div>
					</div>
					<div className="agent-workspace__scroll-region">
						<div className="agent-workspace__dialog-sections">
							{activityView !== "RECORDS" ? (
								<section className="agent-workspace__dialog-section">
									<div className="asset-manager__list-head">
										<div>
											<h3>任务</h3>
											<p>记录任务的发起来源、API Key、Agent 名称以及执行输入输出。</p>
										</div>
									</div>
									<AgentTaskList
										tasks={filteredTasks}
										recordsByTaskId={recordsByTaskId}
										emptyMessage="当前筛选条件下还没有任务。"
									/>
								</section>
							) : null}

							{activityView !== "TASKS" ? (
								<section className="agent-workspace__dialog-section">
									<div className="asset-manager__list-head">
										<div>
											<h3>落库记录</h3>
											<p>记录真实写入数据库的资产操作，并标明 API Key 与 Agent 名称。</p>
										</div>
									</div>
									<AgentRecordList
										records={filteredRecords}
										emptyMessage="当前筛选条件下还没有落库记录。"
									/>
								</section>
							) : null}
						</div>
					</div>
				</div>
			</AgentWorkspaceDialog>
		</section>
	);
}
