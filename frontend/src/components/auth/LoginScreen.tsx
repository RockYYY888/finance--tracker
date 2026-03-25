import { useState } from "react";

import type { ApiKeyAuthCredentials } from "../../types/auth";

type LoginScreenProps = {
	loading?: boolean;
	checkingSession?: boolean;
	errorMessage?: string | null;
	noticeMessage?: string | null;
	onAuthenticate: (payload: ApiKeyAuthCredentials) => Promise<void>;
};

export function LoginScreen({
	loading = false,
	checkingSession = false,
	errorMessage,
	noticeMessage,
	onAuthenticate,
}: LoginScreenProps) {
	const [apiKey, setApiKey] = useState("");

	async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
		event.preventDefault();
		await onAuthenticate({
			api_key: apiKey,
		});
	}

	return (
		<div className="auth-shell">
			<section className="auth-card">
				<div className="auth-card__intro">
					<div className="auth-card__copy">
						<p className="eyebrow">PERSONAL ASSET TRACKER</p>
						<h1>衡仓</h1>
						<p className="hero-copy">使用账户 API Key 直接进入你的资产工作区。</p>
					</div>

					<div className="auth-highlights" aria-hidden="true">
						<div className="auth-highlight">
							<strong>统一鉴权</strong>
							<span>前端、智能体与外部自动化共用同一套账户级 API Key。</span>
						</div>
						<div className="auth-highlight">
							<strong>最小暴露</strong>
							<span>完整 Key 仅在创建时显示一次，平台后续只保留掩码提示。</span>
						</div>
					</div>
				</div>

				<div className="auth-panel">
					<div className="auth-panel__head">
						<p className="auth-kicker">API KEY ACCESS</p>
						<h2>输入 API Key</h2>
						<p className="auth-panel__copy">
							输入当前账号的 API Key。验证成功后，系统会直接解析对应的账户身份与权限。
						</p>
						{checkingSession ? (
							<p className="auth-panel__status">正在验证已保存的 API Key。</p>
						) : null}
					</div>

					<form className="auth-form" onSubmit={(event) => void handleSubmit(event)}>
						<label className="field">
							<span>API Key</span>
							<input
								type="password"
								value={apiKey}
								onChange={(event) => setApiKey(event.target.value)}
								autoComplete="off"
								placeholder="粘贴当前账号的 API Key"
								spellCheck={false}
								required
							/>
						</label>

						{errorMessage ? <div className="banner error">{errorMessage}</div> : null}
						{noticeMessage ? <div className="banner info">{noticeMessage}</div> : null}

						<button type="submit" className="auth-submit" disabled={loading}>
							{loading ? "验证中..." : "进入工作区"}
						</button>
					</form>

					<div className="auth-switch">
						<span>需要新的 API Key？</span>
						<span>请使用已存在的 Key 登录后，在“智能体”页创建新的 Key。</span>
					</div>
				</div>
			</section>
		</div>
	);
}
