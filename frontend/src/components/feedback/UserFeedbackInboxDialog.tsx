import { useEffect } from "react";

import type { UserFeedbackRecord } from "../../types/feedback";

export interface UserFeedbackInboxDialogProps {
	open: boolean;
	busy?: boolean;
	items: UserFeedbackRecord[];
	errorMessage?: string | null;
	onClose: () => void;
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

export function UserFeedbackInboxDialog({
	open,
	busy = false,
	items,
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
					{items.length === 0 ? (
						<div className="banner info">
							<p>当前没有消息。</p>
						</div>
					) : (
						items.map((item) => (
							<article key={item.id} className="admin-feedback-card panel">
								<div className="admin-feedback-card__head">
									<div>
										<strong>提交：{formatTimestamp(item.created_at)}</strong>
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
						))
					)}
				</div>
			</div>
		</div>
	);
}
