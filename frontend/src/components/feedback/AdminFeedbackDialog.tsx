import { useEffect, useMemo, useState } from "react";

import { formatTimestamp as formatAssetTimestamp } from "../../lib/assetFormatting";
import {
	getFeedbackCategoryMeta,
	getFeedbackPriorityMeta,
	getFeedbackSourceMeta,
	getFeedbackStatusMeta,
} from "../../lib/feedbackMeta";
import type {
	ReleaseNoteInput,
	ReleaseNoteRecord,
	UserFeedbackRecord,
} from "../../types/feedback";

export interface AdminFeedbackDialogProps {
	open: boolean;
	busy?: boolean;
	items: UserFeedbackRecord[];
	releaseNotes: ReleaseNoteRecord[];
	errorMessage?: string | null;
	onClose: () => void;
	onCloseItem: (feedbackId: number) => Promise<void>;
	onReplyItem: (feedbackId: number, replyMessage: string, close: boolean) => Promise<void>;
	onCreateReleaseNote: (payload: ReleaseNoteInput) => Promise<void>;
	onPublishReleaseNote: (releaseNoteId: number) => Promise<void>;
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
	items,
	releaseNotes,
	errorMessage = null,
	onClose,
	onCloseItem,
	onReplyItem,
	onCreateReleaseNote,
	onPublishReleaseNote,
}: AdminFeedbackDialogProps) {
	const [expandedId, setExpandedId] = useState<number | null>(null);
	const [draftReply, setDraftReply] = useState("");
	const [releaseVersion, setReleaseVersion] = useState("");
	const [releaseTitle, setReleaseTitle] = useState("");
	const [releaseContent, setReleaseContent] = useState("");
	const [releaseSourceFeedbackIds, setReleaseSourceFeedbackIds] = useState("");

	useEffect(() => {
		if (!open) {
			setExpandedId(null);
			setDraftReply("");
			setReleaseVersion("");
			setReleaseTitle("");
			setReleaseContent("");
			setReleaseSourceFeedbackIds("");
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

	function parseSourceFeedbackIds(rawValue: string): number[] {
		const parsedIds = rawValue
			.split(",")
			.map((item) => item.trim())
			.filter((item) => /^\d+$/.test(item))
			.map((item) => Number.parseInt(item, 10))
			.filter((item) => item > 0);

		return Array.from(new Set(parsedIds)).sort((left, right) => left - right);
	}

	async function handleCreateReleaseNote(): Promise<void> {
		const version = releaseVersion.trim();
		const title = releaseTitle.trim();
		const content = releaseContent.trim();
		if (!version || !title || !content) {
			return;
		}

		await onCreateReleaseNote({
			version,
			title,
			content,
			source_feedback_ids: parseSourceFeedbackIds(releaseSourceFeedbackIds),
		});
		setReleaseVersion("");
		setReleaseTitle("");
		setReleaseContent("");
		setReleaseSourceFeedbackIds("");
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
						<p className="feedback-modal__copy">展开后可查看详情，未关闭的反馈支持回复与关闭。</p>
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

				<div className="admin-release-note panel">
					<div className="admin-release-note__head">
						<strong>版本更新日志</strong>
						<span>先创建草稿，再发布为站内消息。</span>
					</div>
					<div className="admin-release-note__form">
						<label>
							<span>版本号（x.y.z）</span>
							<input
								value={releaseVersion}
								onChange={(event) => setReleaseVersion(event.target.value)}
								placeholder="例如 0.2.0"
								disabled={busy}
							/>
						</label>
						<label>
							<span>标题</span>
							<input
								value={releaseTitle}
								onChange={(event) => setReleaseTitle(event.target.value)}
								placeholder="例如 图表可读性与修正能力更新"
								disabled={busy}
							/>
						</label>
						<label>
							<span>关联反馈 ID（可选，逗号分隔）</span>
							<input
								value={releaseSourceFeedbackIds}
								onChange={(event) => setReleaseSourceFeedbackIds(event.target.value)}
								placeholder="例如 3,5,7"
								disabled={busy}
							/>
						</label>
						<label>
							<span>更新内容</span>
							<textarea
								value={releaseContent}
								onChange={(event) => setReleaseContent(event.target.value)}
								placeholder="填写这次上线实际修改内容。"
								disabled={busy}
							/>
						</label>
						<div className="admin-release-note__actions">
							<button
								type="button"
								className="ghost-button"
								disabled={
									busy ||
									!releaseVersion.trim() ||
									!releaseTitle.trim() ||
									!releaseContent.trim()
								}
								onClick={() => void handleCreateReleaseNote()}
							>
								创建草稿
							</button>
						</div>
					</div>
					<div className="admin-release-note__list">
						{releaseNotes.length === 0 ? (
							<p className="admin-release-note__empty">暂无版本日志。</p>
						) : (
							releaseNotes.map((releaseNote) => (
								<div key={releaseNote.id} className="admin-release-note__item">
									<div>
										<strong>v{releaseNote.version}</strong>
										<p>{releaseNote.title}</p>
										<small>
											{releaseNote.published_at
												? `已发布：${formatTimestamp(releaseNote.published_at)} · 推送 ${releaseNote.delivery_count} 人`
												: "草稿"}
										</small>
									</div>
									<button
										type="button"
										className="ghost-button"
										disabled={busy || Boolean(releaseNote.published_at)}
										onClick={() => void onPublishReleaseNote(releaseNote.id)}
									>
										{releaseNote.published_at ? "已发布" : "发布"}
									</button>
								</div>
							))
						)}
					</div>
				</div>

				<div className="admin-feedback-list">
					{items.length === 0 ? (
						<div className="banner info">
							<p>当前没有反馈消息。</p>
						</div>
					) : (
						items.map((item) => {
							const statusMeta = getFeedbackStatusMeta(item.status);
							const priorityMeta = getFeedbackPriorityMeta(item.priority);
							const categoryMeta = getFeedbackCategoryMeta(item.category);
							const sourceMeta = getFeedbackSourceMeta(item.source);
							const isClosed = item.status === "RESOLVED" || Boolean(item.resolved_at);
							const isExpanded = expandedId === item.id;
							return (
								<article key={item.id} className="admin-feedback-card panel">
									<div className="admin-feedback-card__head">
										<div>
											<strong>{item.user_id}</strong>
											<div className="feedback-badge-row" aria-label="工单属性标签">
												<span
													className={`feedback-badge feedback-badge--${statusMeta.tone}`}
												>
													{statusMeta.label}
												</span>
												<span
													className={`feedback-badge feedback-badge--${priorityMeta.tone}`}
												>
													{priorityMeta.label}
												</span>
												<span
													className={`feedback-badge feedback-badge--${categoryMeta.tone}`}
												>
													{categoryMeta.label}
												</span>
												<span
													className={`feedback-badge feedback-badge--${sourceMeta.tone}`}
												>
													{sourceMeta.label}
												</span>
											</div>
											<p>
												提交：{formatTimestamp(item.created_at)}
												{item.replied_at
													? ` · 最近回复：${formatTimestamp(item.replied_at)}`
													: " · 暂未回复"}
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
											<div className="admin-feedback-card__reply-history">
												<strong>回复内容</strong>
												<p>{item.reply_message ?? "暂未回复"}</p>
											</div>
											<div className="admin-feedback-card__footer">
												<span>
													{item.replied_by
														? `最近回复人：${item.replied_by}`
														: "尚未回复"}
												</span>
											</div>
											{!isClosed ? (
												<>
													<label className="admin-feedback-card__editor">
														<span>回复</span>
														<textarea
															value={
																expandedItem?.id === item.id
																	? draftReply
																	: item.reply_message ?? ""
															}
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
