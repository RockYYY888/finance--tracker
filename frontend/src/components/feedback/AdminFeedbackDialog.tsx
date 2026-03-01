import { useEffect, useMemo, useState } from "react";

import type { UserFeedbackRecord } from "../../types/feedback";

export interface AdminFeedbackDialogProps {
	open: boolean;
	busy?: boolean;
	items: UserFeedbackRecord[];
	errorMessage?: string | null;
	onClose: () => void;
	onCloseItem: (feedbackId: number) => Promise<void>;
	onReplyItem: (feedbackId: number, replyMessage: string, close: boolean) => Promise<void>;
}

function formatTimestamp(value: string | null): string {
	if (!value) {
		return "未记录";
	}

	const parsedValue = new Date(value);
	if (Number.isNaN(parsedValue.getTime())) {
		return "未记录";
	}

	return new Intl.DateTimeFormat("zh-CN", {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	}).format(parsedValue);
}

export function AdminFeedbackDialog({
	open,
	busy = false,
	items,
	errorMessage = null,
	onClose,
	onCloseItem,
	onReplyItem,
}: AdminFeedbackDialogProps) {
	const [expandedId, setExpandedId] = useState<number | null>(null);
	const [draftReply, setDraftReply] = useState("");

	useEffect(() => {
		if (!open) {
			setExpandedId(null);
			setDraftReply("");
		}
	}, [open]);

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

	const expandedItem = useMemo(
		() => items.find((item) => item.id === expandedId) ?? null,
		[expandedId, items],
	);

	function handleToggle(item: UserFeedbackRecord): void {
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
			<div className="feedback-modal__panel">
				<div className="feedback-modal__head">
					<div>
						<p className="eyebrow">ADMIN INBOX</p>
						<h2 id="admin-feedback-title">消息</h2>
						<p className="feedback-modal__copy">展开后可查看详情、回复，并按需关闭。</p>
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
					{items.length === 0 ? (
						<div className="banner info">
							<p>当前没有反馈消息。</p>
						</div>
					) : (
						items.map((item) => {
							const isClosed = Boolean(item.resolved_at);
							const isExpanded = expandedId === item.id;
							return (
								<article key={item.id} className="admin-feedback-card panel">
									<div className="admin-feedback-card__head">
										<div>
											<strong>{item.user_id}</strong>
											<p>
												提交：{formatTimestamp(item.created_at)}
												{item.replied_at
													? ` · 已回复：${formatTimestamp(item.replied_at)}`
													: " · 未回复"}
												{isClosed
													? ` · 已关闭：${formatTimestamp(item.resolved_at)}`
													: " · 待处理"}
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
												className="ghost-button"
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
											<div className="admin-feedback-card__reply-history">
												<strong>回复内容</strong>
												<p>{item.reply_message ?? "暂无回复"}</p>
											</div>
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
												<span>
													{item.replied_by
														? `最近回复人：${item.replied_by}`
														: "尚未回复"}
												</span>
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
										</div>
									) : null}
								</article>
							);
						})
					)}
				</div>
			</div>
		</div>
	);
}
