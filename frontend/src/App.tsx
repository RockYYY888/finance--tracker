import { useEffect, useState } from "react";
import { AssetManager } from "./components/assets";
import { PortfolioAnalytics } from "./components/analytics";
import { defaultAssetApiClient } from "./lib/assetApi";
import { getDashboard } from "./lib/dashboardApi";
import type { AssetManagerController } from "./types/assets";
import { EMPTY_DASHBOARD, type DashboardResponse } from "./types/dashboard";
import { formatCny } from "./utils/portfolioAnalytics";

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

function App() {
	const [dashboard, setDashboard] = useState<DashboardResponse>(EMPTY_DASHBOARD);
	const [isLoadingDashboard, setIsLoadingDashboard] = useState(true);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
	const [assetRefreshToken, setAssetRefreshToken] = useState(0);

	useEffect(() => {
		void loadDashboard();
	}, []);

	useEffect(() => {
		const refreshTimer = window.setInterval(() => {
			void loadDashboard();
		}, 60 * 60 * 1000);

		return () => window.clearInterval(refreshTimer);
	}, []);

	async function loadDashboard(): Promise<void> {
		setErrorMessage(null);

		try {
			const nextDashboard = await getDashboard();
			setDashboard(nextDashboard);
			setLastUpdatedAt(new Date().toISOString());
			setAssetRefreshToken((currentValue) => currentValue + 1);
		} catch (error) {
			setErrorMessage(
				error instanceof Error
					? error.message
					: "无法加载资产总览，请确认后端服务是否启动。",
			);
		} finally {
			setIsLoadingDashboard(false);
		}
	}

	const hasAnyAsset =
		dashboard.cash_accounts.length > 0 || dashboard.holdings.length > 0;

	const assetManagerController: AssetManagerController = {
		cashAccounts: {
			onCreate: async (payload) => {
				const createdRecord = await defaultAssetApiClient.createCashAccount(payload);
				await loadDashboard();
				return createdRecord;
			},
			onEdit: async (recordId, payload) => {
				const updatedRecord = await defaultAssetApiClient.updateCashAccount(recordId, payload);
				await loadDashboard();
				return updatedRecord;
			},
			onDelete: async (recordId) => {
				await defaultAssetApiClient.deleteCashAccount(recordId);
				await loadDashboard();
			},
			onRefresh: () => defaultAssetApiClient.listCashAccounts(),
		},
		holdings: {
			onCreate: async (payload) => {
				const createdRecord = await defaultAssetApiClient.createHolding(payload);
				await loadDashboard();
				return createdRecord;
			},
			onEdit: async (recordId, payload) => {
				const updatedRecord = await defaultAssetApiClient.updateHolding(recordId, payload);
				await loadDashboard();
				return updatedRecord;
			},
			onDelete: async (recordId) => {
				await defaultAssetApiClient.deleteHolding(recordId);
				await loadDashboard();
			},
			onRefresh: () => defaultAssetApiClient.listHoldings(),
			onSearch: (query) => defaultAssetApiClient.searchSecurities(query),
		},
	};

	return (
		<div className="app-shell">
			<div className="ambient ambient-left" />
			<div className="ambient ambient-right" />

			<header className="hero-panel">
				<div className="hero-copy-block">
					<p className="eyebrow">ASSET DASHBOARD</p>
					<h1>个人资产</h1>
					<p className="hero-copy">统一查看现金与证券，所有估值按人民币汇总。</p>
					<p className="hero-note">最近更新：{formatLastUpdated(lastUpdatedAt)}</p>
				</div>

				<div className="summary-grid">
					<div className="stat-card coral">
						<span>总资产</span>
						<strong>{formatCny(dashboard.total_value_cny)}</strong>
					</div>
					<div className="stat-card blue">
						<span>现金资产</span>
						<strong>{formatCny(dashboard.cash_value_cny)}</strong>
					</div>
					<div className="stat-card green">
						<span>证券资产</span>
						<strong>{formatCny(dashboard.holdings_value_cny)}</strong>
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

			{!hasAnyAsset ? (
				<div className="banner info">先新增一笔资产，图表会自动形成。</div>
			) : null}

			<section className="panel section-shell">
				<div className="section-head">
					<div>
						<p className="eyebrow">ANALYTICS</p>
						<h2>变化与分布</h2>
						<p className="section-copy">查看走势、占比和集中度。</p>
					</div>
				</div>

				<PortfolioAnalytics
					total_value_cny={dashboard.total_value_cny}
					cash_accounts={dashboard.cash_accounts}
					holdings={dashboard.holdings}
					allocation={dashboard.allocation}
					hour_series={dashboard.hour_series}
					day_series={dashboard.day_series}
					month_series={dashboard.month_series}
					year_series={dashboard.year_series}
					loading={isLoadingDashboard}
				/>
			</section>

			<div className="integrated-stack">
				<AssetManager
					cashActions={assetManagerController.cashAccounts}
					holdingActions={assetManagerController.holdings}
					title="资产录入"
					description="操作后自动更新，每小时刷新一次。"
					defaultSection={hasAnyAsset && dashboard.holdings.length > 0 ? "holding" : "cash"}
					refreshToken={assetRefreshToken}
				/>
			</div>
		</div>
	);
}

export default App;
