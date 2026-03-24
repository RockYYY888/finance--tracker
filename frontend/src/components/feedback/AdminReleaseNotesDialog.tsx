import { useEffect, useState } from "react";

import { formatTimestamp as formatAssetTimestamp } from "../../lib/assetFormatting";
import { useBodyScrollLock } from "../../hooks/useBodyScrollLock";
import { useAutoRefreshGuard } from "../../lib/autoRefreshGuards";
import type { ReleaseNoteInput, ReleaseNoteRecord } from "../../types/feedback";

export interface AdminReleaseNotesDialogProps {
	open: boolean;
	busy?: boolean;
	releaseNotes: ReleaseNoteRecord[];
	errorMessage?: string | null;
	onClose: () => void;
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

function parseSourceFeedbackIds(rawValue: string): number[] {
	const parsedIds = rawValue
		.split(",")
		.map((item) => item.trim())
		.filter((item) => /^\d+$/.test(item))
		.map((item) => Number.parseInt(item, 10))
		.filter((item) => item > 0);

	return Array.from(new Set(parsedIds)).sort((left, right) => left - right);
}

export function AdminReleaseNotesDialog({
	open,
	busy = false,
	releaseNotes,
	errorMessage = null,
	onClose,
	onCreateReleaseNote,
	onPublishReleaseNote,
}: AdminReleaseNotesDialogProps) {
	const [releaseVersion, setReleaseVersion] = useState("");
	const [releaseTitle, setReleaseTitle] = useState("");
	const [releaseContent, setReleaseContent] = useState("");
	const [releaseSourceFeedbackIds, setReleaseSourceFeedbackIds] = useState("");
	useBodyScrollLock(open);
	useAutoRefreshGuard(open, "admin-release-notes-dialog");

	useEffect(() => {
		if (!open) {
			setReleaseVersion("");
			setReleaseTitle("");
			setReleaseContent("");
			setReleaseSourceFeedbackIds("");
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
		<div className="feedback-modal" role="dialog" aria-modal="true" aria-labelledby="admin-release-title">
			<button
				type="button"
				className="feedback-modal__backdrop"
				onClick={busy ? undefined : onClose}
				aria-label="关闭更新日志窗口"
			/>
			<div className="feedback-modal__panel">
				<div className="feedback-modal__head">
					<div>
						<p className="eyebrow">RELEASE NOTES</p>
						<h2 id="admin-release-title">版本更新日志</h2>
						<p className="feedback-modal__copy">仅管理员可见：创建草稿并发布为站内更新。</p>
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
						<strong>发布中心</strong>
						<span>先创建草稿，再发布给用户。</span>
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
			</div>
		</div>
	);
}
