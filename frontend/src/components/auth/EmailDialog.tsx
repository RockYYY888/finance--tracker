import { useEffect, useState } from "react";
import type { FormEvent } from "react";

export interface EmailDialogProps {
	open: boolean;
	busy?: boolean;
	initialEmail?: string | null;
	errorMessage?: string | null;
	onClose: () => void;
	onSubmit: (email: string) => Promise<void>;
}

export function EmailDialog({
	open,
	busy = false,
	initialEmail = null,
	errorMessage = null,
	onClose,
	onSubmit,
}: EmailDialogProps) {
	const [email, setEmail] = useState(initialEmail ?? "");
	const [localError, setLocalError] = useState<string | null>(null);

	useEffect(() => {
		if (!open) {
			setLocalError(null);
			return;
		}

		setEmail(initialEmail ?? "");
		setLocalError(null);
	}, [initialEmail, open]);

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
		const normalizedEmail = email.trim();
		if (!normalizedEmail) {
			setLocalError("请输入邮箱地址。");
			return;
		}

		setLocalError(null);
		await onSubmit(normalizedEmail);
	}

	return (
		<div className="feedback-modal" role="dialog" aria-modal="true" aria-labelledby="email-title">
			<button
				type="button"
				className="feedback-modal__backdrop"
				onClick={busy ? undefined : onClose}
				aria-label="关闭邮箱窗口"
			/>
			<div className="feedback-modal__panel">
				<div className="feedback-modal__head">
					<div>
						<p className="eyebrow">ACCOUNT EMAIL</p>
						<h2 id="email-title">{initialEmail ? "修改邮箱" : "绑定邮箱"}</h2>
						<p className="feedback-modal__copy">邮箱将用于找回密码，并显示在顶部账号信息里。</p>
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
						邮箱地址
						<input
							type="email"
							value={email}
							onChange={(event) => {
								setEmail(event.target.value);
								setLocalError(null);
							}}
							placeholder="例如：admin@example.com"
							disabled={busy}
						/>
					</label>

					<div className="feedback-form__footer">
						<span className="feedback-form__counter">
							{initialEmail ? "更新后立即生效" : "绑定后可用于找回密码"}
						</span>
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
								{busy ? "保存中..." : initialEmail ? "保存邮箱" : "绑定邮箱"}
							</button>
						</div>
					</div>
				</form>
			</div>
		</div>
	);
}
