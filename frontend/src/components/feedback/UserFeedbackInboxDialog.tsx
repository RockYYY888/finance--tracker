import { useEffect, useMemo, useState } from "react";

import { formatTimestamp as formatAssetTimestamp } from "../../lib/assetFormatting";
import {
	getFeedbackCategoryMeta,
	getFeedbackSourceMeta,
	getFeedbackStatusMeta,
} from "../../lib/feedbackMeta";
import {
	loadDismissedMessageKeys,
	saveDismissedMessageKeys,
	setSkipDismissConfirmation,
	shouldSkipDismissConfirmation,
} from "../../lib/messageDismissal";
import type {
	ReleaseNoteDeliveryRecord,
	UserFeedbackRecord,
} from "../../types/feedback";

export interface UserFeedbackInboxDialogProps {
	open: boolean;
	busy?: boolean;
	viewerUserId: string;
	items: UserFeedbackRecord[];
	releaseNotes: ReleaseNoteDeliveryRecord[];
	errorMessage?: string | null;
	onClose: () => void;
	onHideFeedbackItem: (feedbackId: number) => Promise<void>;
	onHideReleaseNote: (deliveryId: number) => Promise<void>;
}

function formatTimestamp(value: string | null): string {
	if (!value) {
		return "未记录";
	}

	const formattedValue = formatAssetTimestamp(value);
	return formattedValue === "待更新" ? "未记录" : formattedValue;
}

export function UserFeedbackInboxDialog({
	open,
	busy = false,
	viewerUserId,
	items,
	releaseNotes,
	errorMessage = null,
	onClose,
	onHideFeedbackItem,
	onHideReleaseNote,
}: UserFeedbackInboxDialogProps) {
	const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set<string>());
	const [pendingDismissTarget, setPendingDismissTarget] = useState<{
		key: string;
		label: string;
		messageKind: "FEEDBACK" | "RELEASE_NOTE";
		messageId: number;
	} | null>(null);
	const [skipDismissConfirmChecked, setSkipDismissConfirmChecked] = useState(false);

	useEffect(() => {
		if (!open) {
			setPendingDismissTarget(null);
			setSkipDismissConfirmChecked(false);
			return;
		}

		setDismissedKeys(loadDismissedMessageKeys("user-inbox", viewerUserId));
	}, [open, viewerUserId]);

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

	const visibleReleaseNotes = useMemo(
		() =>
			releaseNotes.filter(
				(item) => !dismissedKeys.has(`release-note:${item.delivery_id}`),
			),
		[dismissedKeys, releaseNotes],
	);
	const visibleFeedbackItems = useMemo(
		() => items.filter((item) => !dismissedKeys.has(`feedback:${item.id}`)),
		[dismissedKeys, items],
	);

	function applyDismiss(key: string): void {
		setDismissedKeys((currentKeys) => {
			const nextKeys = new Set(currentKeys);
			nextKeys.add(key);
			saveDismissedMessageKeys("user-inbox", viewerUserId, nextKeys);
			return nextKeys;
		});
	}

	async function handleDismiss(
		messageKind: "FEEDBACK" | "RELEASE_NOTE",
		messageId: number,
		key: string,
	): Promise<void> {
		if (messageKind === "FEEDBACK") {
			await onHideFeedbackItem(messageId);
		} else {
			await onHideReleaseNote(messageId);
		}
		applyDismiss(key);
	}

	function handleRequestDismiss(
		key: string,
		label: string,
		messageKind: "FEEDBACK" | "RELEASE_NOTE",
		messageId: number,
	): void {
		if (shouldSkipDismissConfirmation()) {
			void handleDismiss(messageKind, messageId, key);
			return;
		}

		setSkipDismissConfirmChecked(false);
		setPendingDismissTarget({ key, label, messageKind, messageId });
	}

	function handleCancelDismiss(): void {
		setPendingDismissTarget(null);
		setSkipDismissConfirmChecked(false);
	}

	async function handleConfirmDismiss(): Promise<void> {
		if (!pendingDismissTarget) {
			return;
		}

		if (skipDismissConfirmChecked) {
			setSkipDismissConfirmation(true);
		}
		await handleDismiss(
			pendingDismissTarget.messageKind,
			pendingDismissTarget.messageId,
			pendingDismissTarget.key,
		);
		setPendingDismissTarget(null);
		setSkipDismissConfirmChecked(false);
	}

	if (!open) {
		return null;
	}

	return (
		<div className="feedback-modal" role="dialog" aria-modal="true" aria-labelledby="user-feedback-title">
			<button
				type="button"
				className="feedback-modal__backdrop"
				onClick={busy ? undefined : onClose}
				aria-label="关闭我的消息窗口"
			/>
			<div className="feedback-modal__panel">
				<div className="feedback-modal__head">
					<div>
						<p className="eyebrow">MY MESSAGES</p>
						<h2 id="user-feedback-title">消息</h2>
						<p className="feedback-modal__copy">
							这里会显示你的工单进展与回复；提交 bug 请使用主页的“反馈问题”按钮。
						</p>
					</div>
					<button
						type="button"
						className="hero-note hero-note--action"
						onClick={onClose}
						disabled={busy}
					>
						关闭
					</button>
				</div>

				{errorMessage ? (
					<div className="banner error">
						<p>{errorMessage}</p>
					</div>
				) : null}

				<div className="admin-feedback-list">
					{visibleReleaseNotes.length === 0 && visibleFeedbackItems.length === 0 ? (
						<div className="banner info">
							<p>当前没有消息。</p>
						</div>
					) : (
						<>
							{visibleReleaseNotes.map((releaseNote) => (
								<article
									key={`release-note-${releaseNote.delivery_id}`}
									className="admin-feedback-card panel"
								>
									<button
										type="button"
										className="message-dismiss-button"
										disabled={busy}
										onClick={() =>
											handleRequestDismiss(
												`release-note:${releaseNote.delivery_id}`,
												`版本 v${releaseNote.version}`,
												"RELEASE_NOTE",
												releaseNote.delivery_id,
											)
										}
										aria-label={`从当前列表移除版本消息 v${releaseNote.version}`}
										title="从当前列表移除"
									>
										×
									</button>
									<div className="admin-feedback-card__head">
										<div>
											<strong>版本 v{releaseNote.version}</strong>
											<p>发布：{formatTimestamp(releaseNote.published_at)}</p>
										</div>
									</div>
									<p className="admin-feedback-card__message">{releaseNote.title}</p>
									<div className="admin-feedback-card__detail">
										<div className="admin-feedback-card__reply-history">
											<strong>更新内容</strong>
											<p>{releaseNote.content}</p>
										</div>
										{releaseNote.source_feedback_ids.length > 0 ? (
											<div className="admin-feedback-card__footer">
												<span>
													关联反馈：#
													{releaseNote.source_feedback_ids.join(", #")}
												</span>
											</div>
										) : null}
									</div>
								</article>
							))}
							{visibleFeedbackItems.map((item) => {
								const statusMeta = getFeedbackStatusMeta(item.status);
								const categoryMeta = getFeedbackCategoryMeta(item.category);
								const sourceMeta = getFeedbackSourceMeta(item.source);
								return (
									<article key={item.id} className="admin-feedback-card panel">
										<button
											type="button"
											className="message-dismiss-button"
											disabled={busy}
											onClick={() =>
												handleRequestDismiss(
													`feedback:${item.id}`,
													`#${item.id}`,
													"FEEDBACK",
													item.id,
												)
											}
											aria-label={`从当前列表移除消息 #${item.id}`}
											title="从当前列表移除"
										>
											×
										</button>
										<div className="admin-feedback-card__head">
											<div>
												<strong>提交：{formatTimestamp(item.created_at)}</strong>
												<div className="feedback-badge-row" aria-label="工单属性标签">
													<span className={`feedback-badge feedback-badge--${statusMeta.tone}`}>
														{statusMeta.label}
													</span>
													<span className={`feedback-badge feedback-badge--${categoryMeta.tone}`}>
														{categoryMeta.label}
													</span>
													<span className={`feedback-badge feedback-badge--${sourceMeta.tone}`}>
														{sourceMeta.label}
													</span>
												</div>
												<p>
													{item.replied_at
														? `已回复：${formatTimestamp(item.replied_at)}`
														: `状态：${statusMeta.label}`}
													{item.resolved_at
														? ` · 已关闭：${formatTimestamp(item.resolved_at)}`
														: ""}
												</p>
											</div>
										</div>
										<p className="admin-feedback-card__message">{item.message}</p>
										<div className="admin-feedback-card__detail">
											<div className="admin-feedback-card__reply-history">
												<strong>管理员回复</strong>
												<p>{item.reply_message ?? "暂无回复"}</p>
											</div>
										</div>
									</article>
								);
							})}
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
							<button
								type="button"
								className="ghost-button"
								onClick={handleCancelDismiss}
							>
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
