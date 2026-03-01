import { useEffect } from "react";

import type { UserFeedbackRecord } from "../../types/feedback";

export interface AdminFeedbackDialogProps {
	open: boolean;
	busy?: boolean;
	items: UserFeedbackRecord[];
	errorMessage?: string | null;
	onClose: () => void;
	onCloseItem: (feedbackId: number) => Promise<void>;
}

function formatTimestamp(value: string | null): string {
	if (!value) {
		return "未关闭";
	}

	const parsedValue = new Date(value);
	if (Number.isNaN(parsedValue.getTime())) {
		return "未关闭";
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
}: AdminFeedbackDialogProps) {
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
						<p className="feedback-modal__copy">查看所有反馈，并在处理后关闭。</p>
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
							return (
								<article key={item.id} className="admin-feedback-card panel">
									<div className="admin-feedback-card__head">
										<div>
											<strong>{item.user_id}</strong>
											<p>
												提交：{formatTimestamp(item.created_at)}
												{isClosed
													? ` · 已关闭：${formatTimestamp(item.resolved_at)}`
													: " · 待处理"}
											</p>
										</div>
										<button
											type="button"
											className="ghost-button"
											disabled={busy || isClosed}
											onClick={() => void onCloseItem(item.id)}
										>
											{isClosed ? "已关闭" : "关闭"}
										</button>
									</div>
									<p className="admin-feedback-card__message">{item.message}</p>
								</article>
							);
						})
					)}
				</div>
			</div>
		</div>
	);
}
