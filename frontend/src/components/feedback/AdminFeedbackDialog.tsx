import { useEffect, useMemo, useState } from "react";

import { formatTimestamp as formatAssetTimestamp } from "../../lib/assetFormatting";
import {
	getFeedbackCategoryMeta,
	getFeedbackPriorityMeta,
	getFeedbackSourceMeta,
	getFeedbackStatusMeta,
} from "../../lib/feedbackMeta";
import {
	loadDismissedMessageKeys,
	saveDismissedMessageKeys,
	setSkipDismissConfirmation,
	shouldSkipDismissConfirmation,
} from "../../lib/messageDismissal";
import { useBodyScrollLock } from "../../hooks/useBodyScrollLock";
import { useAutoRefreshGuard } from "../../lib/autoRefreshGuards";
import type { AdminFeedbackRecord } from "../../types/feedback";

export interface AdminFeedbackDialogProps {
	open: boolean;
	busy?: boolean;
	viewerUserId: string;
	userItems: AdminFeedbackRecord[];
	systemItems: AdminFeedbackRecord[];
	showDismissed?: boolean;
	errorMessage?: string | null;
	onClose: () => void;
	onShowDismissedChange: (showDismissed: boolean) => void | Promise<void>;
	onHideItem: (feedbackId: number) => Promise<void>;
	onCloseItem: (feedbackId: number) => Promise<void>;
	onReplyItem: (feedbackId: number, replyMessage: string, close: boolean) => Promise<void>;
}

function formatTimestamp(value: string | null): string {
	if (!value) {
		return "暂无";
	}

	const formattedValue = formatAssetTimestamp(value);
	return formattedValue === "待更新" ? "暂无" : formattedValue;
}

export function AdminFeedbackDialog({
	open,
	busy = false,
	viewerUserId,
	userItems,
	systemItems,
	showDismissed = false,
	errorMessage = null,
	onClose,
	onShowDismissedChange,
	onHideItem,
	onCloseItem,
	onReplyItem,
}: AdminFeedbackDialogProps) {
	const [expandedId, setExpandedId] = useState<number | null>(null);
	const [draftReply, setDraftReply] = useState("");
	const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set<string>());
	const [pendingDismissTarget, setPendingDismissTarget] = useState<{
		key: string;
		label: string;
		feedbackId: number;
	} | null>(null);
	const [skipDismissConfirmChecked, setSkipDismissConfirmChecked] = useState(false);
	useBodyScrollLock(open);
	useAutoRefreshGuard(open, "admin-feedback-dialog");

	useEffect(() => {
		if (!open) {
			setExpandedId(null);
			setDraftReply("");
			setPendingDismissTarget(null);
			setSkipDismissConfirmChecked(false);
			return;
		}

		setDismissedKeys(loadDismissedMessageKeys("admin-inbox", viewerUserId));
	}, [open, viewerUserId]);

	useEffect(() => {
		if (!open || expandedId === null) {
			return;
		}

		if (dismissedKeys.has(`feedback:${expandedId}`)) {
			setExpandedId(null);
			setDraftReply("");
		}
	}, [dismissedKeys, expandedId, open]);

	useEffect(() => {
		if (!open) {
			return;
		}

		function handleKeyDown(event: KeyboardEvent): void {
			if (event.key === "Escape" && !busy) {
				onClose();
			}
		}

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [busy, onClose, open]);

	const visibleUserItems = useMemo(
		() => userItems.filter((item) => !dismissedKeys.has(`feedback:${item.id}`)),
		[dismissedKeys, userItems],
	);
	const visibleSystemItems = useMemo(
		() => systemItems.filter((item) => !dismissedKeys.has(`feedback:${item.id}`)),
		[dismissedKeys, systemItems],
	);
	const allVisibleItems = useMemo(
		() => [...visibleUserItems, ...visibleSystemItems],
		[visibleSystemItems, visibleUserItems],
	);
	const expandedItem = useMemo(
		() => allVisibleItems.find((item) => item.id === expandedId) ?? null,
		[allVisibleItems, expandedId],
	);

	function handleToggle(item: AdminFeedbackRecord): void {
		if (expandedId === item.id) {
			setExpandedId(null);
			setDraftReply("");
			return;
		}

		setExpandedId(item.id);
		setDraftReply(item.reply_message ?? "");
	}

	async function handleReply(itemId: number, close: boolean): Promise<void> {
		const normalizedReply = draftReply.trim();
		if (!normalizedReply) {
			return;
		}

		await onReplyItem(itemId, normalizedReply, close);
	}

	function applyDismiss(key: string): void {
		if (expandedId !== null && key === `feedback:${expandedId}`) {
			setExpandedId(null);
			setDraftReply("");
		}

		setDismissedKeys((currentKeys) => {
			const nextKeys = new Set(currentKeys);
			nextKeys.add(key);
			saveDismissedMessageKeys("admin-inbox", viewerUserId, nextKeys);
			return nextKeys;
		});
	}

	function handleRequestDismiss(itemId: number): void {
		const key = `feedback:${itemId}`;
		if (shouldSkipDismissConfirmation()) {
			void handleDismiss(itemId, key);
			return;
		}

		setSkipDismissConfirmChecked(false);
		setPendingDismissTarget({
			key,
			label: `#${itemId}`,
			feedbackId: itemId,
		});
	}

	function handleCancelDismiss(): void {
		setPendingDismissTarget(null);
		setSkipDismissConfirmChecked(false);
	}

	async function handleDismiss(feedbackId: number, key: string): Promise<void> {
		await onHideItem(feedbackId);
		applyDismiss(key);
	}

	async function handleConfirmDismiss(): Promise<void> {
		if (!pendingDismissTarget) {
			return;
		}

		if (skipDismissConfirmChecked) {
			setSkipDismissConfirmation(true);
		}

		await handleDismiss(pendingDismissTarget.feedbackId, pendingDismissTarget.key);
		setPendingDismissTarget(null);
		setSkipDismissConfirmChecked(false);
	}

	function renderFeedbackCard(item: AdminFeedbackRecord): JSX.Element {
		const statusMeta = getFeedbackStatusMeta(item.status);
		const priorityMeta = getFeedbackPriorityMeta(item.priority);
		const categoryMeta = getFeedbackCategoryMeta(item.category);
		const sourceMeta = getFeedbackSourceMeta(item.source);
		const isClosed = item.status === "RESOLVED" || Boolean(item.resolved_at);
		const canReply = item.source === "USER";
		const isExpanded = expandedId === item.id;

		return (
			<article key={item.id} className="admin-feedback-card admin-feedback-card--dismissible panel">
				<button
					type="button"
					className="message-dismiss-button"
					disabled={busy}
					onClick={() => handleRequestDismiss(item.id)}
					aria-label={`从当前列表移除消息 #${item.id}`}
					title="从当前列表移除"
				>
					×
				</button>
				<div className="admin-feedback-card__head">
					<div className="admin-feedback-card__meta">
						<strong>{item.user_id}</strong>
						<div className="feedback-badge-row" aria-label="工单属性标签">
							<span className={`feedback-badge feedback-badge--${statusMeta.tone}`}>
								{statusMeta.label}
							</span>
							<span className={`feedback-badge feedback-badge--${priorityMeta.tone}`}>
								{priorityMeta.label}
							</span>
							<span className={`feedback-badge feedback-badge--${categoryMeta.tone}`}>
								{categoryMeta.label}
							</span>
							<span className={`feedback-badge feedback-badge--${sourceMeta.tone}`}>
								{sourceMeta.label}
							</span>
						</div>
						<p>
							提交：{formatTimestamp(item.created_at)}
							{item.replied_at
								? ` · 最近回复：${formatTimestamp(item.replied_at)}`
								: canReply
								? " · 暂未回复"
								: " · 系统工单（无需回复）"}
							{isClosed
								? ` · 已关闭：${formatTimestamp(item.resolved_at)}`
								: ` · ${statusMeta.label}`}
						</p>
					</div>
					<div className="admin-feedback-card__actions">
						<button
							type="button"
							className="ghost-button"
							disabled={busy}
							onClick={() => handleToggle(item)}
						>
							{isExpanded ? "收起" : "展开"}
						</button>
						<button
							type="button"
							className="ghost-button ghost-button--danger"
							disabled={busy || isClosed}
							onClick={() => void onCloseItem(item.id)}
						>
							{isClosed ? "已关闭" : "关闭"}
						</button>
					</div>
				</div>
				<p className="admin-feedback-card__message">{item.message}</p>
				{isExpanded ? (
					<div className="admin-feedback-card__detail">
						{canReply ? (
							<>
								<div className="admin-feedback-card__reply-history">
									<strong>回复内容</strong>
									<p>{item.reply_message ?? "暂未回复"}</p>
								</div>
								<div className="admin-feedback-card__footer">
									<span>
										{item.replied_by ? `最近回复人：${item.replied_by}` : "尚未回复"}
									</span>
								</div>
								{!isClosed ? (
									<>
										<label className="admin-feedback-card__editor">
											<span>回复</span>
											<textarea
												value={expandedItem?.id === item.id ? draftReply : item.reply_message ?? ""}
												onChange={(event) => setDraftReply(event.target.value)}
												placeholder="输入回复，用户会在自己的消息里看到。"
												disabled={busy}
											/>
										</label>
										<div className="admin-feedback-card__footer">
											<span>保存后用户会在自己的消息中看到回复。</span>
											<div className="admin-feedback-card__footer-actions">
												<button
													type="button"
													className="ghost-button"
													disabled={busy || !draftReply.trim()}
													onClick={() => void handleReply(item.id, false)}
												>
													保存回复
												</button>
												<button
													type="button"
													disabled={busy || !draftReply.trim()}
													onClick={() => void handleReply(item.id, true)}
												>
													回复并关闭
												</button>
											</div>
										</div>
									</>
								) : null}
							</>
						) : (
							<div className="admin-feedback-card__footer">
								<span>
									{isClosed ? "系统来源消息已处理，无需回复。" : "系统来源消息无需回复，可直接关闭。"}
								</span>
							</div>
						)}
					</div>
				) : null}
			</article>
		);
	}

	if (!open) {
		return null;
	}

	return (
		<div className="feedback-modal" role="dialog" aria-modal="true" aria-labelledby="admin-feedback-title">
			<button
				type="button"
				className="feedback-modal__backdrop"
				onClick={busy ? undefined : onClose}
				aria-label="关闭消息窗口"
			/>
			<div className="feedback-modal__panel feedback-modal__panel--list-layout">
				<div className="feedback-modal__head">
					<div>
						<p className="eyebrow">ADMIN INBOX</p>
						<h2 id="admin-feedback-title">消息</h2>
						<p className="feedback-modal__copy">
							仅管理员可见：展开后可查看详情，用户工单支持回复，系统工单仅支持关闭与分类。
						</p>
					</div>
					<div className="feedback-modal__head-actions">
						<button
							type="button"
							className="hero-note hero-note--action"
							onClick={() => void onShowDismissedChange(!showDismissed)}
							disabled={busy}
						>
							{showDismissed ? "仅看当前" : "显示已移除"}
						</button>
						<button
							type="button"
							className="hero-note hero-note--action"
							onClick={onClose}
							disabled={busy}
						>
							关闭
						</button>
					</div>
				</div>

				{errorMessage ? (
					<div className="banner error">
						<p>{errorMessage}</p>
					</div>
				) : null}

				<div className="admin-feedback-list">
					{visibleUserItems.length === 0 && visibleSystemItems.length === 0 ? (
						<div className="banner info">
							<p>当前没有反馈消息。</p>
						</div>
					) : (
						<>
							<section className="admin-feedback-section" aria-label="用户工单">
								<div className="admin-feedback-section__head">
									<strong>用户工单</strong>
									<span>{visibleUserItems.length} 条</span>
								</div>
								{visibleUserItems.length === 0 ? (
									<p className="admin-release-note__empty">暂无用户工单。</p>
								) : (
									visibleUserItems.map((item) => renderFeedbackCard(item))
								)}
							</section>
							<section className="admin-feedback-section" aria-label="系统工单">
								<div className="admin-feedback-section__head">
									<strong>系统工单</strong>
									<span>{visibleSystemItems.length} 条</span>
								</div>
								{visibleSystemItems.length === 0 ? (
									<p className="admin-release-note__empty">暂无系统工单。</p>
								) : (
									visibleSystemItems.map((item) => renderFeedbackCard(item))
								)}
							</section>
						</>
					)}
				</div>
			</div>
			{pendingDismissTarget ? (
				<div className="message-dismiss-confirm" role="dialog" aria-modal="true">
					<button
						type="button"
						className="message-dismiss-confirm__backdrop"
						onClick={handleCancelDismiss}
						aria-label="关闭确认框"
					/>
					<div className="message-dismiss-confirm__panel panel">
						<h3>移除消息</h3>
						<p>
							将从你的消息列表中移除
							{pendingDismissTarget.label}。此操作不可逆，但不会删除后台记录。
						</p>
						<label className="message-dismiss-confirm__checkbox">
							<input
								type="checkbox"
								checked={skipDismissConfirmChecked}
								onChange={(event) => setSkipDismissConfirmChecked(event.target.checked)}
							/>
							<span>以后不再提示</span>
						</label>
						<div className="message-dismiss-confirm__actions">
							<button type="button" className="ghost-button" onClick={handleCancelDismiss}>
								取消
							</button>
							<button
								type="button"
								className="ghost-button ghost-button--danger"
								disabled={busy}
								onClick={() => void handleConfirmDismiss()}
							>
								移除消息
							</button>
						</div>
					</div>
				</div>
			) : null}
		</div>
	);
}
