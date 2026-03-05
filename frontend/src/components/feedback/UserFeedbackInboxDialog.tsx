import { useEffect } from "react";

import { formatTimestamp as formatAssetTimestamp } from "../../lib/assetFormatting";
import {
	getFeedbackCategoryMeta,
	getFeedbackPriorityMeta,
	getFeedbackStatusMeta,
} from "../../lib/feedbackMeta";
import type {
	ReleaseNoteDeliveryRecord,
	UserFeedbackRecord,
} from "../../types/feedback";

export interface UserFeedbackInboxDialogProps {
	open: boolean;
	busy?: boolean;
	items: UserFeedbackRecord[];
	releaseNotes: ReleaseNoteDeliveryRecord[];
	errorMessage?: string | null;
	onClose: () => void;
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
	items,
	releaseNotes,
	errorMessage = null,
	onClose,
}: UserFeedbackInboxDialogProps) {
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
						<p className="feedback-modal__copy">这里会显示你的反馈及管理员回复。</p>
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
					{releaseNotes.length === 0 && items.length === 0 ? (
						<div className="banner info">
							<p>当前没有消息。</p>
						</div>
					) : (
						<>
							{releaseNotes.map((releaseNote) => (
								<article
									key={`release-note-${releaseNote.delivery_id}`}
									className="admin-feedback-card panel"
								>
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
							{items.map((item) => {
								const statusMeta = getFeedbackStatusMeta(item.status);
								const priorityMeta = getFeedbackPriorityMeta(item.priority);
								const categoryMeta = getFeedbackCategoryMeta(item.category);
								return (
									<article key={item.id} className="admin-feedback-card panel">
										<div className="admin-feedback-card__head">
											<div>
												<strong>提交：{formatTimestamp(item.created_at)}</strong>
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
												</div>
												<p>
													{item.replied_at
														? `已回复：${formatTimestamp(item.replied_at)}`
														: "等待管理员回复"}
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
		</div>
	);
}
