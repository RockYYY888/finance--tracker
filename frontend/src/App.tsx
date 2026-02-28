import { useEffect, useState } from "react";
import { AssetManager } from "./components/assets";
import { PortfolioAnalytics } from "./components/analytics";
import { defaultAssetApiClient } from "./lib/assetApi";
import { getDashboard } from "./lib/dashboardApi";
import type { AssetManagerController } from "./types/assets";
import { EMPTY_DASHBOARD, type DashboardResponse } from "./types/dashboard";
import { formatCny } from "./utils/portfolioAnalytics";

function formatLastSynced(timestamp: string | null): string {
	if (!timestamp) {
		return "等待首次同步";
	}

	const parsedTimestamp = new Date(timestamp);
	if (Number.isNaN(parsedTimestamp.getTime())) {
		return "等待首次同步";
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
	const [isRefreshingOverview, setIsRefreshingOverview] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

	useEffect(() => {
		void loadDashboard("initial");
	}, []);

	async function loadDashboard(mode: "initial" | "background" = "background"): Promise<void> {
		if (mode === "initial") {
			setIsLoadingDashboard(true);
		} else {
			setIsRefreshingOverview(true);
		}

		setErrorMessage(null);

		try {
			const nextDashboard = await getDashboard();
			setDashboard(nextDashboard);
			setLastSyncedAt(new Date().toISOString());
		} catch (error) {
			setErrorMessage(
				error instanceof Error
					? error.message
					: "无法加载资产总览，请确认后端服务是否启动。",
			);
		} finally {
			if (mode === "initial") {
				setIsLoadingDashboard(false);
			} else {
				setIsRefreshingOverview(false);
			}
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
		},
	};

	return (
		<div className="app-shell">
			<div className="ambient ambient-left" />
			<div className="ambient ambient-right" />

			<header className="hero-panel">
				<div className="hero-copy-block">
					<p className="eyebrow">ASSET DASHBOARD</p>
					<h1>个人资产总览</h1>
					<p className="hero-copy">
						录入现金账户与证券持仓后，系统会统一按人民币估值，并在下方同步更新趋势与结构图。
					</p>

					<div className="hero-actions">
						<button
							type="button"
							className="ghost-button"
							onClick={() => void loadDashboard()}
							disabled={isRefreshingOverview}
						>
							{isRefreshingOverview ? "刷新中..." : "刷新总览"}
						</button>
						<div className="hero-sync-chip">最近同步：{formatLastSynced(lastSyncedAt)}</div>
					</div>

					<div className="quick-guide">
						<div className="quick-guide__item">
							<span>1</span>
							<p>先新增现金账户或持仓</p>
						</div>
						<div className="quick-guide__item">
							<span>2</span>
							<p>在下方直接编辑、删除或刷新</p>
						</div>
						<div className="quick-guide__item">
							<span>3</span>
							<p>查看总资产、分布和时间趋势</p>
						</div>
					</div>
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
				<div className="banner info">
					先录入至少一笔现金账户或证券持仓。录入完成后，总览、趋势图和分布图会自动形成。
				</div>
			) : null}

			<section className="panel section-shell">
				<div className="section-head">
					<div>
						<p className="eyebrow">ANALYTICS</p>
						<h2>趋势与结构分析</h2>
						<p className="section-copy">
							按天、月、年查看资产变化，并快速判断现金占比、平台分布和持仓集中度。
						</p>
					</div>
				</div>

				<PortfolioAnalytics
					total_value_cny={dashboard.total_value_cny}
					cash_accounts={dashboard.cash_accounts}
					holdings={dashboard.holdings}
					allocation={dashboard.allocation}
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
					title="资产录入与维护"
					description="在这里新增、编辑、删除现金账户和证券持仓。保存后总览会自动刷新。"
					defaultSection={hasAnyAsset && dashboard.holdings.length > 0 ? "holding" : "cash"}
					autoRefreshOnMount
				/>
			</div>
		</div>
	);
}

export default App;
