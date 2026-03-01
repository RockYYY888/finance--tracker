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

	const isLoginMode = mode === "login";
	const submitLabel = isLoginMode ? "登录" : "创建账号";
	const panelTitle = isLoginMode ? "欢迎回来" : "创建你的账号";
	const panelCopy = isLoginMode
		? "登录后即可查看持仓、账户资产与最近记录。"
		: "创建一个新账号，用于保存你的资产数据与使用偏好。";

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
				<div className="auth-card__intro">
					<div className="auth-card__copy">
						<p className="eyebrow">PERSONAL ASSET TRACKER</p>
						<h1>衡仓</h1>
						<p className="hero-copy">更清晰地管理你的账户、持仓与每日资产变化。</p>
					</div>

					<div className="auth-highlights" aria-hidden="true">
						<div className="auth-highlight">
							<strong>账户总览</strong>
							<span>统一查看现金、证券与基金仓位。</span>
						</div>
						<div className="auth-highlight">
							<strong>记录追踪</strong>
							<span>保留关键变动，方便回顾每次调整。</span>
						</div>
					</div>
				</div>

				<div className="auth-panel">
					<div className="auth-panel__head">
						<p className="auth-kicker">{isLoginMode ? "账号登录" : "新账号注册"}</p>
						<h2>{panelTitle}</h2>
						<p className="auth-panel__copy">{panelCopy}</p>
					</div>

					<form className="auth-form" onSubmit={(event) => void handleSubmit(event)}>
						<label className="field">
							<span>用户名</span>
							<input
								value={userId}
								onChange={(event) => setUserId(event.target.value)}
								autoComplete="username"
								placeholder={isLoginMode ? "输入用户名" : "设置用户名"}
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
								autoComplete={isLoginMode ? "current-password" : "new-password"}
								placeholder={isLoginMode ? "输入密码" : "设置密码"}
								required
							/>
						</label>

						{errorMessage ? <div className="banner error">{errorMessage}</div> : null}

						<button type="submit" className="auth-submit" disabled={loading}>
							{loading ? "处理中..." : submitLabel}
						</button>
					</form>

					<div className="auth-switch">
						<span>{isLoginMode ? "还没有账号？" : "已经有账号？"}</span>
						<button
							type="button"
							className="auth-switch__button"
							onClick={() => setMode(isLoginMode ? "register" : "login")}
						>
							{isLoginMode ? "创建账号" : "返回登录"}
						</button>
					</div>
				</div>
			</section>
		</div>
	);
}
