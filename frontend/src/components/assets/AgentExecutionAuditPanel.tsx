import { useMemo, useState, type FormEvent } from "react";

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
			label: "已撤销",
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
	const activeApiKeyCount = apiKeys.filter((apiKey) => isApiKeyActive(apiKey)).length;

	function handleCreateApiKeySubmit(event: FormEvent<HTMLFormElement>): void {
		event.preventDefault();
		setClipboardNotice(null);
		setClipboardError(null);
		onCreateApiKey?.(draftApiKeyName);
		setDraftApiKeyName("");
	}

	async function handleCopyIssuedApiKey(): Promise<void> {
		if (!issuedApiKey) {
			return;
		}

		try {
			await copyTextToClipboard(issuedApiKey.access_token);
			setClipboardError(null);
			setClipboardNotice("已复制到剪贴板。请立即保存，这串 API Key 不会再次显示。");
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
								<p className="asset-manager__eyebrow">API KEYS</p>
								<h3>账户 API Keys</h3>
								<p>
									为当前账号生成直连 API 的 Bearer Key。每个账号最多保留 3 个有效 Key，
									完整密钥只会在创建成功后显示一次。
								</p>
							</div>
							<div className="asset-manager__mini-actions">
								<span className="asset-manager__status-note">
									有效 Key {activeApiKeyCount} / 3
								</span>
							</div>
						</div>

						{apiKeyErrorMessage ? (
							<div className="asset-manager__message asset-manager__message--error">
								{apiKeyErrorMessage}
							</div>
						) : null}
						{apiKeyNoticeMessage ? (
							<div className="asset-manager__status-note">{apiKeyNoticeMessage}</div>
						) : null}
						{clipboardError ? (
							<div className="asset-manager__message asset-manager__message--error">
								{clipboardError}
							</div>
						) : null}
						{clipboardNotice ? (
							<div className="asset-manager__status-note">{clipboardNotice}</div>
						) : null}

						<div className="agent-api-keys__layout">
							<form
								className="asset-manager__helper-block agent-api-keys__create"
								onSubmit={handleCreateApiKeySubmit}
							>
								<strong>创建新的 API Key</strong>
								<p>
									给 Key 一个清晰用途名称，例如 <code>local-cli</code>、<code>daily-sync</code>
									或 <code>portfolio-agent</code>。
								</p>
								<label className="asset-manager__field">
									<span>Key 名称</span>
									<input
										value={draftApiKeyName}
										onChange={(event) => setDraftApiKeyName(event.target.value)}
										placeholder="例如：local-cli"
										maxLength={80}
										disabled={isCreatingApiKey || activeApiKeyCount >= 3}
									/>
								</label>
								<div className="asset-manager__form-actions">
									<button
										type="submit"
										className="asset-manager__button"
										disabled={isCreatingApiKey || activeApiKeyCount >= 3}
									>
										{isCreatingApiKey ? "生成中..." : "生成 API Key"}
									</button>
								</div>
							</form>

							{issuedApiKey ? (
								<div className="asset-manager__helper-block asset-manager__helper-block--highlight">
									<strong>只显示一次的 API Key</strong>
									<p>
										请现在复制并保存到密码管理器、系统钥匙串或其他安全的密钥管理位置。
										关闭这张卡片后，平台只会保留掩码提示，不会再次返回完整 Key。
									</p>
									<pre className="asset-manager__code-block">{issuedApiKey.access_token}</pre>
									<div className="asset-manager__form-actions agent-api-keys__issued-actions">
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
											onClick={onDismissIssuedApiKey}
										>
											我已保存
										</button>
									</div>
								</div>
							) : (
								<div className="asset-manager__helper-block">
									<strong>调用方式</strong>
									<p>
										生成后，把完整 Key 放到请求头
										<code> Authorization: Bearer &lt;your_api_key&gt;</code> 中。
										可用 <code>GET /api/auth/session</code> 立即验证这串 Key 当前归属的账户。
									</p>
								</div>
							)}
						</div>

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
														仅显示掩码提示；完整密钥在创建后不会再次返回。
													</p>
												</div>
												<div className="asset-manager__card-actions">
													<button
														type="button"
														className="asset-manager__button asset-manager__button--secondary"
														onClick={() => onRevokeApiKey?.(apiKey.id)}
														disabled={!canRevoke || revokingApiKeyId === apiKey.id}
													>
														{revokingApiKeyId === apiKey.id ? "撤销中..." : "撤销"}
													</button>
												</div>
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
													<span>撤销时间</span>
													<strong>{formatTimestamp(apiKey.revoked_at)}</strong>
												</div>
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
