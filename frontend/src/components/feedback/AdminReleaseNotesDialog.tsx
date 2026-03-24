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
		return "N/A";
	}

	const formattedValue = formatAssetTimestamp(value);
	return formattedValue === "待更新" ? "N/A" : formattedValue;
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
				aria-label="Close release notes dialog"
			/>
			<div className="feedback-modal__panel">
				<div className="feedback-modal__head">
					<div>
						<p className="eyebrow">RELEASE NOTES</p>
						<h2 id="admin-release-title">Release Notes</h2>
						<p className="feedback-modal__copy">
							Admin only: create drafts and publish them to the in-app update stream.
						</p>
					</div>
					<button
						type="button"
						className="hero-note hero-note--action"
						onClick={onClose}
						disabled={busy}
					>
						Close
					</button>
				</div>

				{errorMessage ? (
					<div className="banner error">
						<p>{errorMessage}</p>
					</div>
				) : null}

				<div className="admin-release-note panel">
					<div className="admin-release-note__head">
						<strong>Publishing Center</strong>
						<span>Create a draft first, then publish it to users.</span>
					</div>
					<div className="admin-release-note__form">
						<label>
							<span>Version (x.y.z)</span>
							<input
								value={releaseVersion}
								onChange={(event) => setReleaseVersion(event.target.value)}
								placeholder="For example 0.2.0"
								disabled={busy}
							/>
						</label>
						<label>
							<span>Title</span>
							<input
								value={releaseTitle}
								onChange={(event) => setReleaseTitle(event.target.value)}
								placeholder="For example Stability and experience updates"
								disabled={busy}
							/>
						</label>
						<label>
							<span>Linked feedback IDs (optional, comma-separated)</span>
							<input
								value={releaseSourceFeedbackIds}
								onChange={(event) => setReleaseSourceFeedbackIds(event.target.value)}
								placeholder="For example 3,5,7"
								disabled={busy}
							/>
						</label>
						<label>
							<span>Content</span>
							<textarea
								value={releaseContent}
								onChange={(event) => setReleaseContent(event.target.value)}
								placeholder="Describe the user-facing changes in this release."
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
								Create Draft
							</button>
						</div>
					</div>
					<div className="admin-release-note__list">
						{releaseNotes.length === 0 ? (
							<p className="admin-release-note__empty">No release notes yet.</p>
						) : (
							releaseNotes.map((releaseNote) => (
								<div key={releaseNote.id} className="admin-release-note__item">
									<div>
										<strong>v{releaseNote.version}</strong>
										<p>{releaseNote.title}</p>
										<small>
											{releaseNote.published_at
												? `Published: ${formatTimestamp(releaseNote.published_at)} · Delivered to ${releaseNote.delivery_count}`
												: "Draft"}
										</small>
									</div>
									<button
										type="button"
										className="ghost-button"
										disabled={busy || Boolean(releaseNote.published_at)}
										onClick={() => void onPublishReleaseNote(releaseNote.id)}
									>
										{releaseNote.published_at ? "Published" : "Publish"}
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
