import { useEffect, useState } from "react";
import type { FormEvent } from "react";

export interface FeedbackDialogProps {
	open: boolean;
	busy?: boolean;
	errorMessage?: string | null;
	onClose: () => void;
	onSubmit: (message: string) => Promise<void>;
}

export function FeedbackDialog({
	open,
	busy = false,
	errorMessage = null,
	onClose,
	onSubmit,
}: FeedbackDialogProps) {
	const [message, setMessage] = useState("");
	const [localError, setLocalError] = useState<string | null>(null);

	useEffect(() => {
		if (!open) {
			setMessage("");
			setLocalError(null);
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

	if (!open) {
		return null;
	}

	const effectiveError = localError ?? errorMessage;

	async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
		event.preventDefault();
		const normalizedMessage = message.trim();
		if (normalizedMessage.length < 5) {
			setLocalError("请至少输入 5 个字，方便定位问题。");
			return;
		}

		setLocalError(null);
		await onSubmit(normalizedMessage);
	}

	return (
		<div className="feedback-modal" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
			<button
				type="button"
				className="feedback-modal__backdrop"
				onClick={busy ? undefined : onClose}
				aria-label="关闭反馈窗口"
			/>
			<div className="feedback-modal__panel">
				<div className="feedback-modal__head">
					<div>
						<p className="eyebrow">USER FEEDBACK</p>
						<h2 id="feedback-title">反馈问题</h2>
						<p className="feedback-modal__copy">每天最多提交 3 次，我们会按账号归档处理。</p>
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

				{effectiveError ? (
					<div className="banner error">
						<p>{effectiveError}</p>
					</div>
				) : null}

				<form onSubmit={(event) => void handleSubmit(event)} className="feedback-form">
					<label>
						问题描述
						<textarea
							value={message}
							onChange={(event) => {
								setMessage(event.target.value);
								setLocalError(null);
							}}
							maxLength={1000}
							placeholder="例如：编辑后现价没有立即刷新，点击同步后才更新。"
							disabled={busy}
						/>
					</label>

					<div className="feedback-form__footer">
						<span className="feedback-form__counter">{message.trim().length}/1000</span>
						<div className="feedback-form__actions">
							<button
								type="button"
								className="ghost-button"
								onClick={onClose}
								disabled={busy}
							>
								取消
							</button>
							<button type="submit" disabled={busy}>
								{busy ? "提交中..." : "提交反馈"}
							</button>
						</div>
					</div>
				</form>
			</div>
		</div>
	);
}
