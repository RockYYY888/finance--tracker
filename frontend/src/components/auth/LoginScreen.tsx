import { useState } from "react";

import type {
	AuthLoginCredentials,
	AuthRegisterCredentials,
	PasswordResetPayload,
} from "../../types/auth";

type AuthMode = "login" | "register" | "reset";

type LoginScreenProps = {
	loading?: boolean;
	checkingSession?: boolean;
	errorMessage?: string | null;
	noticeMessage?: string | null;
	onLogin: (payload: AuthLoginCredentials) => Promise<void>;
	onRegister: (payload: AuthRegisterCredentials) => Promise<void>;
	onResetPassword: (payload: PasswordResetPayload) => Promise<void>;
};

export function LoginScreen({
	loading = false,
	checkingSession = false,
	errorMessage,
	noticeMessage,
	onLogin,
	onRegister,
	onResetPassword,
}: LoginScreenProps) {
	const [mode, setMode] = useState<AuthMode>("login");
	const [userId, setUserId] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");

	const isLoginMode = mode === "login";
	const isRegisterMode = mode === "register";
	const isResetMode = mode === "reset";
	const submitLabel = isLoginMode ? "登录" : isRegisterMode ? "创建账号" : "重设密码";
	const panelTitle = isLoginMode ? "欢迎回来" : isRegisterMode ? "创建你的账号" : "找回密码";
	const panelCopy = isLoginMode
		? "登录后即可查看持仓、账户资产与最近记录。"
		: isRegisterMode
			? "创建一个新账号，用于保存你的资产数据与使用偏好。"
			: "输入注册时填写的邮箱，并设置一个新密码。";

	async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
		event.preventDefault();
		if (mode === "login") {
			await onLogin({
				user_id: userId,
				password,
			});
			return;
		}

		if (mode === "register") {
			await onRegister({
				user_id: userId,
				email,
				password,
			});
			return;
		}

		await onResetPassword({
			user_id: userId,
			email,
			new_password: password,
		});
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
						{checkingSession ? (
							<p className="auth-panel__status">正在检查登录状态，你也可以直接登录。</p>
						) : null}
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
						{!isLoginMode ? (
							<label className="field">
								<span>邮箱</span>
								<input
									type="email"
									value={email}
									onChange={(event) => setEmail(event.target.value)}
									autoComplete={isRegisterMode ? "email" : "username"}
									placeholder={isRegisterMode ? "输入注册邮箱" : "输入注册时填写的邮箱"}
									spellCheck={false}
									required
								/>
							</label>
						) : null}
						<label className="field">
							<span>{isResetMode ? "新密码" : "密码"}</span>
							<input
								type="password"
								value={password}
								onChange={(event) => setPassword(event.target.value)}
								autoComplete={isLoginMode ? "current-password" : "new-password"}
								placeholder={isLoginMode ? "输入密码" : isRegisterMode ? "设置密码" : "设置新密码"}
								required
							/>
						</label>

						{errorMessage ? <div className="banner error">{errorMessage}</div> : null}
						{noticeMessage ? <div className="banner info">{noticeMessage}</div> : null}

						<button type="submit" className="auth-submit" disabled={loading}>
							{loading ? "处理中..." : submitLabel}
						</button>
					</form>

					<div className="auth-switch">
						{isLoginMode ? (
							<>
								<span>还没有账号？</span>
								<button
									type="button"
									className="auth-switch__button"
									onClick={() => setMode("register")}
								>
									创建账号
								</button>
								<button
									type="button"
									className="auth-switch__button"
									onClick={() => setMode("reset")}
								>
									忘记密码
								</button>
							</>
						) : (
							<>
								<span>{isRegisterMode ? "已经有账号？" : "想起密码了？"}</span>
								<button
									type="button"
									className="auth-switch__button"
									onClick={() => setMode("login")}
								>
									返回登录
								</button>
							</>
						)}
					</div>
				</div>
			</section>
		</div>
	);
}
