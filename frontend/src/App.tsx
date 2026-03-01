import { useEffect, useRef, useState } from "react";

import { LoginScreen } from "./components/auth/LoginScreen";
import { AssetManager } from "./components/assets";
import { PortfolioAnalytics } from "./components/analytics";
import { defaultAssetApiClient } from "./lib/assetApi";
import {
	getAuthSession,
	loginWithPassword,
	logoutCurrentUser,
	registerWithPassword,
} from "./lib/authApi";
import { getDashboard } from "./lib/dashboardApi";
import type { AuthCredentials } from "./types/auth";
import type {
	AssetManagerController,
	CashAccountRecord,
	FixedAssetRecord,
	HoldingRecord,
	LiabilityCurrency,
	LiabilityRecord,
	OtherAssetRecord,
} from "./types/assets";
import { EMPTY_DASHBOARD, type DashboardResponse } from "./types/dashboard";
import { formatCny } from "./utils/portfolioAnalytics";

type AuthStatus = "checking" | "anonymous" | "authenticated";

function getMillisecondsUntilNextMinute(): number {
	const now = new Date();
	return ((60 - now.getSeconds()) * 1000) - now.getMilliseconds();
}

function formatLastUpdated(timestamp: string | null): string {
	if (!timestamp) {
		return "等待首次载入";
	}

	const parsedTimestamp = new Date(timestamp);
	if (Number.isNaN(parsedTimestamp.getTime())) {
		return "等待首次载入";
	}

	return new Intl.DateTimeFormat("zh-CN", {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	}).format(parsedTimestamp);
}

function formatSummaryCny(value: number): string {
	const absoluteValue = Math.abs(value);
	const sign = value < 0 ? "-" : "";

	if (absoluteValue < 10_000) {
		return formatCny(value);
	}

	if (absoluteValue < 100_000_000) {
		return `${sign}¥${(absoluteValue / 10_000).toFixed(2)}万`;
	}

	return `${sign}¥${(absoluteValue / 100_000_000).toFixed(2)}亿`;
}

function formatFxRate(rate: number | null | undefined): string {
	if (rate === null || rate === undefined || !Number.isFinite(rate) || rate <= 0) {
		return "--";
	}

	return rate.toFixed(4);
}

function toCashAccountRecord(record: DashboardResponse["cash_accounts"][number]): CashAccountRecord {
	return {
		...record,
		started_on: record.started_on ?? undefined,
		note: record.note ?? undefined,
	};
}

function toHoldingRecord(record: DashboardResponse["holdings"][number]): HoldingRecord {
	return {
		...record,
		cost_basis_price: record.cost_basis_price ?? undefined,
		broker: record.broker ?? undefined,
		started_on: record.started_on ?? undefined,
		note: record.note ?? undefined,
		last_updated: record.last_updated ?? undefined,
	};
}

function toFixedAssetRecord(
	record: DashboardResponse["fixed_assets"][number],
): FixedAssetRecord {
	return {
		...record,
		purchase_value_cny: record.purchase_value_cny ?? undefined,
		started_on: record.started_on ?? undefined,
		note: record.note ?? undefined,
		return_pct: record.return_pct ?? undefined,
	};
}

function toLiabilityRecord(
	record: DashboardResponse["liabilities"][number],
): LiabilityRecord {
	const normalizedCurrency: LiabilityCurrency = record.currency === "USD" ? "USD" : "CNY";

	return {
		...record,
		currency: normalizedCurrency,
		started_on: record.started_on ?? undefined,
		note: record.note ?? undefined,
	};
}

function toOtherAssetRecord(
	record: DashboardResponse["other_assets"][number],
): OtherAssetRecord {
	return {
		...record,
		original_value_cny: record.original_value_cny ?? undefined,
		started_on: record.started_on ?? undefined,
		note: record.note ?? undefined,
		return_pct: record.return_pct ?? undefined,
	};
}

function App() {
	const [authStatus, setAuthStatus] = useState<AuthStatus>("checking");
	const [currentUserId, setCurrentUserId] = useState<string | null>(null);
	const [authErrorMessage, setAuthErrorMessage] = useState<string | null>(null);
	const [isSubmittingAuth, setIsSubmittingAuth] = useState(false);
	const [dashboard, setDashboard] = useState<DashboardResponse>(EMPTY_DASHBOARD);
	const [isLoadingDashboard, setIsLoadingDashboard] = useState(false);
	const [isRefreshingDashboard, setIsRefreshingDashboard] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
	const dashboardRequestInFlightRef = useRef(false);
	const pendingDashboardRefreshRef = useRef(false);
	const pendingForceRefreshRef = useRef(false);

	function resetDashboardState(): void {
		setDashboard(EMPTY_DASHBOARD);
		setIsLoadingDashboard(false);
		setIsRefreshingDashboard(false);
		setErrorMessage(null);
		setLastUpdatedAt(null);
		dashboardRequestInFlightRef.current = false;
		pendingDashboardRefreshRef.current = false;
		pendingForceRefreshRef.current = false;
	}

	function markSignedIn(userId: string): void {
		setCurrentUserId(userId);
		setAuthStatus("authenticated");
		setAuthErrorMessage(null);
		setDashboard(EMPTY_DASHBOARD);
		setIsLoadingDashboard(true);
	}

	function markSignedOut(): void {
		setCurrentUserId(null);
		setAuthStatus("anonymous");
		resetDashboardState();
	}

	useEffect(() => {
		void hydrateSession();
	}, []);

	useEffect(() => {
		if (authStatus !== "authenticated" || !currentUserId) {
			return;
		}

		void loadDashboard({ initial: true });
	}, [authStatus, currentUserId]);

	useEffect(() => {
		if (authStatus !== "authenticated") {
			return;
		}

		let refreshTimer = 0;
		const initialDelay = window.setTimeout(() => {
			void loadDashboard();
			refreshTimer = window.setInterval(() => {
				void loadDashboard();
			}, 60 * 1000);
		}, getMillisecondsUntilNextMinute());

		return () => {
			window.clearTimeout(initialDelay);
			if (refreshTimer) {
				window.clearInterval(refreshTimer);
			}
		};
	}, [authStatus]);

	useEffect(() => {
		if (authStatus !== "authenticated") {
			return;
		}

		function handleVisibilityChange(): void {
			if (document.visibilityState === "visible") {
				void loadDashboard();
			}
		}

		document.addEventListener("visibilitychange", handleVisibilityChange);
		return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
	}, [authStatus]);

	async function hydrateSession(): Promise<void> {
		setAuthStatus("checking");
		setAuthErrorMessage(null);

		try {
			const session = await getAuthSession();
			markSignedIn(session.user_id);
		} catch {
			markSignedOut();
		}
	}

	async function submitAuth(
		mode: "login" | "register",
		payload: AuthCredentials,
	): Promise<void> {
		setIsSubmittingAuth(true);
		setAuthErrorMessage(null);

		try {
			const session = mode === "login"
				? await loginWithPassword(payload)
				: await registerWithPassword(payload);
			markSignedIn(session.user_id);
		} catch (error) {
			setAuthErrorMessage(
				error instanceof Error ? error.message : "登录失败，请稍后再试。",
			);
			setAuthStatus("anonymous");
		} finally {
			setIsSubmittingAuth(false);
		}
	}

	async function handleLogout(): Promise<void> {
		try {
			await logoutCurrentUser();
		} finally {
			markSignedOut();
		}
	}

	async function loadDashboard(
		options: { initial?: boolean; forceRefresh?: boolean } = {},
	): Promise<void> {
		if (authStatus !== "authenticated") {
			return;
		}

		if (dashboardRequestInFlightRef.current) {
			pendingDashboardRefreshRef.current = true;
			pendingForceRefreshRef.current =
				pendingForceRefreshRef.current || Boolean(options.forceRefresh);
			return;
		}

		if (options.initial) {
			setIsLoadingDashboard(true);
		}

		dashboardRequestInFlightRef.current = true;
		setIsRefreshingDashboard(true);
		setErrorMessage(null);

		try {
			const nextDashboard = await getDashboard(Boolean(options.forceRefresh));
			setDashboard(nextDashboard);
			setLastUpdatedAt(new Date().toISOString());
		} catch (error) {
			const nextErrorMessage = error instanceof Error
				? error.message
				: "无法加载资产总览，请确认后端服务是否启动。";
			if (nextErrorMessage.includes("请先登录") || nextErrorMessage.includes("请重新登录")) {
				markSignedOut();
				return;
			}

			setErrorMessage(nextErrorMessage);
		} finally {
			dashboardRequestInFlightRef.current = false;
			setIsRefreshingDashboard(false);
			setIsLoadingDashboard(false);
			if (pendingDashboardRefreshRef.current) {
				const shouldForceRefresh = pendingForceRefreshRef.current;
				pendingDashboardRefreshRef.current = false;
				pendingForceRefreshRef.current = false;
				void loadDashboard({ forceRefresh: shouldForceRefresh });
			}
		}
	}

	if (authStatus !== "authenticated" || !currentUserId) {
		return (
			<LoginScreen
				loading={authStatus === "checking" || isSubmittingAuth}
				errorMessage={authErrorMessage}
				onLogin={(payload) => submitAuth("login", payload)}
				onRegister={(payload) => submitAuth("register", payload)}
			/>
		);
	}

	const hasAnyAsset =
		dashboard.cash_accounts.length > 0 ||
		dashboard.holdings.length > 0 ||
		dashboard.fixed_assets.length > 0 ||
		dashboard.liabilities.length > 0 ||
		dashboard.other_assets.length > 0;
	const isDashboardBusy = isLoadingDashboard || isRefreshingDashboard;
	const cashAccountRecords = dashboard.cash_accounts.map(toCashAccountRecord);
	const holdingRecords = dashboard.holdings.map(toHoldingRecord);
	const fixedAssetRecords = dashboard.fixed_assets.map(toFixedAssetRecord);
	const liabilityRecords = dashboard.liabilities.map(toLiabilityRecord);
	const otherAssetRecords = dashboard.other_assets.map(toOtherAssetRecord);

	const assetManagerController: AssetManagerController = {
		cashAccounts: {
			onCreate: async (payload) => {
				const createdRecord = await defaultAssetApiClient.createCashAccount(payload);
				void loadDashboard();
				return createdRecord;
			},
			onEdit: async (recordId, payload) => {
				const updatedRecord = await defaultAssetApiClient.updateCashAccount(recordId, payload);
				void loadDashboard();
				return updatedRecord;
			},
			onDelete: async (recordId) => {
				await defaultAssetApiClient.deleteCashAccount(recordId);
				void loadDashboard();
			},
		},
		holdings: {
			onCreate: async (payload) => {
				const createdRecord = await defaultAssetApiClient.createHolding(payload);
				void loadDashboard();
				return createdRecord;
			},
			onEdit: async (recordId, payload) => {
				const updatedRecord = await defaultAssetApiClient.updateHolding(recordId, payload);
				void loadDashboard();
				return updatedRecord;
			},
			onDelete: async (recordId) => {
				await defaultAssetApiClient.deleteHolding(recordId);
				void loadDashboard();
			},
			onSearch: (query) => defaultAssetApiClient.searchSecurities(query),
		},
		fixedAssets: {
			onCreate: async (payload) => {
				const createdRecord = await defaultAssetApiClient.createFixedAsset(payload);
				void loadDashboard();
				return createdRecord;
			},
			onEdit: async (recordId, payload) => {
				const updatedRecord = await defaultAssetApiClient.updateFixedAsset(recordId, payload);
				void loadDashboard();
				return updatedRecord;
			},
			onDelete: async (recordId) => {
				await defaultAssetApiClient.deleteFixedAsset(recordId);
				void loadDashboard();
			},
		},
		liabilities: {
			onCreate: async (payload) => {
				const createdRecord = await defaultAssetApiClient.createLiability(payload);
				void loadDashboard();
				return createdRecord;
			},
			onEdit: async (recordId, payload) => {
				const updatedRecord = await defaultAssetApiClient.updateLiability(recordId, payload);
				void loadDashboard();
				return updatedRecord;
			},
			onDelete: async (recordId) => {
				await defaultAssetApiClient.deleteLiability(recordId);
				void loadDashboard();
			},
		},
		otherAssets: {
			onCreate: async (payload) => {
				const createdRecord = await defaultAssetApiClient.createOtherAsset(payload);
				void loadDashboard();
				return createdRecord;
			},
			onEdit: async (recordId, payload) => {
				const updatedRecord = await defaultAssetApiClient.updateOtherAsset(recordId, payload);
				void loadDashboard();
				return updatedRecord;
			},
			onDelete: async (recordId) => {
				await defaultAssetApiClient.deleteOtherAsset(recordId);
				void loadDashboard();
			},
		},
	};

	return (
		<div className="app-shell">
			<div className="ambient ambient-left" />
			<div className="ambient ambient-right" />

			<header className="hero-panel">
				<div className="hero-copy-block">
					<p className="eyebrow">CNY CONTROL PANEL</p>
					<h1>你好，{currentUserId}</h1>
					<p className="hero-copy">你的资产与会话已隔离保存。</p>
					<div className="hero-actions">
						<button
							type="button"
							className="hero-note hero-note--action"
							onClick={() => void loadDashboard({ forceRefresh: true })}
							disabled={isDashboardBusy}
						>
							<span
								className={`hero-note__status ${isDashboardBusy ? "is-active" : ""}`}
								aria-hidden="true"
							/>
							<span>
								{isDashboardBusy
									? "同步中..."
									: `最近更新：${formatLastUpdated(lastUpdatedAt)}`}
							</span>
						</button>
						<button
							type="button"
							className="hero-note hero-note--action"
							onClick={() => void handleLogout()}
						>
							退出登录
						</button>
					</div>
					<div className="hero-rates" aria-label="实时汇率">
						<div className="rate-card">
							<span>USD/CNY</span>
							<strong>{formatFxRate(dashboard.usd_cny_rate)}</strong>
						</div>
						<div className="rate-card">
							<span>HKD/CNY</span>
							<strong>{formatFxRate(dashboard.hkd_cny_rate)}</strong>
						</div>
					</div>
				</div>

				<div className="summary-grid">
					<div className="stat-card coral">
						<span>总资产</span>
						<strong title={formatCny(dashboard.total_value_cny)}>
							{formatSummaryCny(dashboard.total_value_cny)}
						</strong>
					</div>
					<div className="stat-card blue">
						<span>现金资产</span>
						<strong title={formatCny(dashboard.cash_value_cny)}>
							{formatSummaryCny(dashboard.cash_value_cny)}
						</strong>
					</div>
					<div className="stat-card green">
						<span>投资类</span>
						<strong title={formatCny(dashboard.holdings_value_cny)}>
							{formatSummaryCny(dashboard.holdings_value_cny)}
						</strong>
					</div>
					<div className="stat-card violet">
						<span>固定资产</span>
						<strong title={formatCny(dashboard.fixed_assets_value_cny)}>
							{formatSummaryCny(dashboard.fixed_assets_value_cny)}
						</strong>
					</div>
					<div className="stat-card amber">
						<span>其他</span>
						<strong title={formatCny(dashboard.other_assets_value_cny)}>
							{formatSummaryCny(dashboard.other_assets_value_cny)}
						</strong>
					</div>
					<div className="stat-card danger">
						<span>负债</span>
						<strong title={formatCny(-dashboard.liabilities_value_cny)}>
							{formatSummaryCny(-dashboard.liabilities_value_cny)}
						</strong>
					</div>
				</div>
			</header>

			{errorMessage ? <div className="banner error">{errorMessage}</div> : null}

			{dashboard.warnings.length > 0 ? (
				<div className="banner warning">
					{dashboard.warnings.map((warning) => (
						<p key={warning}>{warning}</p>
					))}
				</div>
			) : null}

			{!hasAnyAsset && !isDashboardBusy && !errorMessage ? (
				<div className="banner info">暂无资产数据。</div>
			) : null}

			<section className="panel section-shell">
				<div className="section-head">
					<div>
						<p className="eyebrow">ANALYTICS</p>
						<h2>变化与分布</h2>
						<p className="section-copy">走势与结构。</p>
					</div>
				</div>

				<PortfolioAnalytics
					total_value_cny={dashboard.total_value_cny}
					cash_accounts={dashboard.cash_accounts}
					holdings={dashboard.holdings}
					fixed_assets={dashboard.fixed_assets}
					liabilities={dashboard.liabilities}
					other_assets={dashboard.other_assets}
					allocation={dashboard.allocation}
					hour_series={dashboard.hour_series}
					day_series={dashboard.day_series}
					month_series={dashboard.month_series}
					year_series={dashboard.year_series}
					holdings_return_hour_series={dashboard.holdings_return_hour_series}
					holdings_return_day_series={dashboard.holdings_return_day_series}
					holdings_return_month_series={dashboard.holdings_return_month_series}
					holdings_return_year_series={dashboard.holdings_return_year_series}
					holding_return_series={dashboard.holding_return_series}
					loading={isLoadingDashboard}
				/>
			</section>

			<div className="integrated-stack">
				<AssetManager
					initialCashAccounts={cashAccountRecords}
					initialHoldings={holdingRecords}
					initialFixedAssets={fixedAssetRecords}
					initialLiabilities={liabilityRecords}
					initialOtherAssets={otherAssetRecords}
					cashActions={assetManagerController.cashAccounts}
					holdingActions={assetManagerController.holdings}
					fixedAssetActions={assetManagerController.fixedAssets}
					liabilityActions={assetManagerController.liabilities}
					otherAssetActions={assetManagerController.otherAssets}
					title="资产管理"
					description="自动同步。"
					defaultSection={
						dashboard.holdings.length > 0
							? "investment"
							: dashboard.fixed_assets.length > 0
								? "fixed"
								: dashboard.liabilities.length > 0
									? "liability"
									: dashboard.other_assets.length > 0
										? "other"
										: "cash"
					}
				/>
			</div>
		</div>
	);
}

export default App;
