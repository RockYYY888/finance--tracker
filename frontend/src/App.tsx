import { useEffect, useRef, useState } from "react";
import { AssetManager } from "./components/assets";
import { PortfolioAnalytics } from "./components/analytics";
import { defaultAssetApiClient } from "./lib/assetApi";
import { getDashboard } from "./lib/dashboardApi";
import type {
	AssetManagerController,
	CashAccountRecord,
	HoldingRecord,
} from "./types/assets";
import { EMPTY_DASHBOARD, type DashboardResponse } from "./types/dashboard";
import { formatCny } from "./utils/portfolioAnalytics";

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

function toCashAccountRecord(record: DashboardResponse["cash_accounts"][number]): CashAccountRecord {
	return {
		...record,
		note: record.note ?? undefined,
	};
}

function toHoldingRecord(record: DashboardResponse["holdings"][number]): HoldingRecord {
	return {
		...record,
		cost_basis_price: record.cost_basis_price ?? undefined,
		broker: record.broker ?? undefined,
		note: record.note ?? undefined,
		last_updated: record.last_updated ?? undefined,
	};
}

function App() {
	const [dashboard, setDashboard] = useState<DashboardResponse>(EMPTY_DASHBOARD);
	const [isLoadingDashboard, setIsLoadingDashboard] = useState(true);
	const [isRefreshingDashboard, setIsRefreshingDashboard] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
	const dashboardRequestInFlightRef = useRef(false);

	useEffect(() => {
		void loadDashboard();
	}, []);

	useEffect(() => {
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
	}, []);

	useEffect(() => {
		function handleVisibilityChange(): void {
			if (document.visibilityState === "visible") {
				void loadDashboard();
			}
		}

		document.addEventListener("visibilitychange", handleVisibilityChange);
		return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
	}, []);

	async function loadDashboard(): Promise<void> {
		if (dashboardRequestInFlightRef.current) {
			return;
		}

		dashboardRequestInFlightRef.current = true;
		setIsRefreshingDashboard(true);
		setErrorMessage(null);

		try {
			const nextDashboard = await getDashboard();
			setDashboard(nextDashboard);
			setLastUpdatedAt(new Date().toISOString());
		} catch (error) {
			setErrorMessage(
				error instanceof Error
					? error.message
					: "无法加载资产总览，请确认后端服务是否启动。",
			);
		} finally {
			dashboardRequestInFlightRef.current = false;
			setIsRefreshingDashboard(false);
			setIsLoadingDashboard(false);
		}
	}

	const hasAnyAsset =
		dashboard.cash_accounts.length > 0 || dashboard.holdings.length > 0;
	const isDashboardBusy = isLoadingDashboard || isRefreshingDashboard;
	const cashAccountRecords = dashboard.cash_accounts.map(toCashAccountRecord);
	const holdingRecords = dashboard.holdings.map(toHoldingRecord);

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
			onSearch: (query) => defaultAssetApiClient.searchSecurities(query),
		},
	};

	return (
		<div className="app-shell">
			<div className="ambient ambient-left" />
			<div className="ambient ambient-right" />

			<header className="hero-panel">
				<div className="hero-copy-block">
					<p className="eyebrow">CNY CONTROL PANEL</p>
					<h1>资产控制台</h1>
					<p className="hero-copy">全部资产统一按人民币计价。</p>
					<button
						type="button"
						className="hero-note hero-note--action"
						onClick={() => void loadDashboard()}
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
						<span>证券资产</span>
						<strong title={formatCny(dashboard.holdings_value_cny)}>
							{formatSummaryCny(dashboard.holdings_value_cny)}
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

			{!hasAnyAsset ? (
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
					cashActions={assetManagerController.cashAccounts}
					holdingActions={assetManagerController.holdings}
					title="资产管理"
					description="自动同步。"
					defaultSection={hasAnyAsset && dashboard.holdings.length > 0 ? "holding" : "cash"}
				/>
			</div>
		</div>
	);
}

export default App;
