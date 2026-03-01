import { useState } from "react";

import type { AuthCredentials } from "../../types/auth";

type AuthMode = "login" | "register";

type LoginScreenProps = {
	loading?: boolean;
	errorMessage?: string | null;
	onLogin: (payload: AuthCredentials) => Promise<void>;
	onRegister: (payload: AuthCredentials) => Promise<void>;
};

export function LoginScreen({
	loading = false,
	errorMessage,
	onLogin,
	onRegister,
}: LoginScreenProps) {
	const [mode, setMode] = useState<AuthMode>("login");
	const [userId, setUserId] = useState("");
	const [password, setPassword] = useState("");

	const submitLabel = mode === "login" ? "登录" : "创建账号";

	async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
		event.preventDefault();
		const payload = {
			user_id: userId,
			password,
		};

		if (mode === "login") {
			await onLogin(payload);
			return;
		}

		await onRegister(payload);
	}

	return (
		<div className="auth-shell">
			<div className="ambient ambient-left" />
			<div className="ambient ambient-right" />
			<section className="auth-card">
				<div className="auth-card__copy">
					<p className="eyebrow">SECURE ACCESS</p>
					<h1>登录资产空间</h1>
					<p className="hero-copy">同一浏览器会保留登录状态，无需重复输入。</p>
				</div>

				<div className="auth-segmented" role="tablist" aria-label="选择账号入口">
					<button
						type="button"
						className={mode === "login" ? "active" : ""}
						onClick={() => setMode("login")}
					>
						登录
					</button>
					<button
						type="button"
						className={mode === "register" ? "active" : ""}
						onClick={() => setMode("register")}
					>
						创建账号
					</button>
				</div>

				<form className="auth-form" onSubmit={(event) => void handleSubmit(event)}>
					<label className="field">
						<span>用户名</span>
						<input
							value={userId}
							onChange={(event) => setUserId(event.target.value)}
							autoComplete="username"
							spellCheck={false}
							required
						/>
					</label>
					<label className="field">
						<span>密码</span>
						<input
							type="password"
							value={password}
							onChange={(event) => setPassword(event.target.value)}
							autoComplete={mode === "login" ? "current-password" : "new-password"}
							required
						/>
					</label>

					{errorMessage ? <div className="banner error">{errorMessage}</div> : null}

					<button type="submit" className="btn primary" disabled={loading}>
						{loading ? "处理中..." : submitLabel}
					</button>
				</form>
			</section>
		</div>
	);
}
