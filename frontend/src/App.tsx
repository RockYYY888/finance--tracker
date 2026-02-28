import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
	CartesianGrid,
	Cell,
	Line,
	LineChart,
	Pie,
	PieChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

type ValuedCashAccount = {
	id: number;
	name: string;
	platform: string;
	balance: number;
	currency: string;
	fx_to_cny: number;
	value_cny: number;
};

type ValuedHolding = {
	id: number;
	symbol: string;
	name: string;
	quantity: number;
	price: number;
	price_currency: string;
	fx_to_cny: number;
	value_cny: number;
	last_updated: string | null;
};

type TimelinePoint = {
	label: string;
	value: number;
};

type AllocationSlice = {
	label: string;
	value: number;
};

type DashboardResponse = {
	total_value_cny: number;
	cash_value_cny: number;
	holdings_value_cny: number;
	cash_accounts: ValuedCashAccount[];
	holdings: ValuedHolding[];
	allocation: AllocationSlice[];
	day_series: TimelinePoint[];
	month_series: TimelinePoint[];
	year_series: TimelinePoint[];
	warnings: string[];
};

type CashAccountForm = {
	name: string;
	platform: string;
	currency: string;
	balance: string;
};

type HoldingForm = {
	symbol: string;
	name: string;
	quantity: string;
	fallback_currency: string;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";
const API_TOKEN = import.meta.env.VITE_API_TOKEN ?? "";
const CHART_COLORS = ["#ef476f", "#118ab2", "#ffd166", "#06d6a0"];

const emptyDashboard: DashboardResponse = {
	total_value_cny: 0,
	cash_value_cny: 0,
	holdings_value_cny: 0,
	cash_accounts: [],
	holdings: [],
	allocation: [],
	day_series: [],
	month_series: [],
	year_series: [],
	warnings: [],
};

function formatCny(value: number): string {
	return new Intl.NumberFormat("zh-CN", {
		style: "currency",
		currency: "CNY",
		maximumFractionDigits: 2,
	}).format(value);
}

function formatTooltipValue(value: number | string | undefined): string {
	const numericValue = typeof value === "number" ? value : Number(value ?? 0);
	return formatCny(Number.isFinite(numericValue) ? numericValue : 0);
}

/**
 * A small shared fetch wrapper that preserves backend error messages.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const requestHeaders = new Headers(init?.headers ?? undefined);
	if (!requestHeaders.has("Content-Type") && init?.body) {
		requestHeaders.set("Content-Type", "application/json");
	}
	if (API_TOKEN) {
		requestHeaders.set("X-API-Key", API_TOKEN);
	}

	const response = await fetch(`${API_BASE_URL}${path}`, {
		...init,
		headers: requestHeaders,
	});

	if (!response.ok) {
		const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
		throw new Error(payload?.detail ?? `Request failed with status ${response.status}`);
	}

	return (await response.json()) as T;
}

function App() {
	const [dashboard, setDashboard] = useState<DashboardResponse>(emptyDashboard);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [timeline, setTimeline] = useState<"day" | "month" | "year">("day");
	const [cashForm, setCashForm] = useState<CashAccountForm>({
		name: "",
		platform: "支付宝",
		currency: "CNY",
		balance: "",
	});
	const [holdingForm, setHoldingForm] = useState<HoldingForm>({
		symbol: "",
		name: "",
		quantity: "",
		fallback_currency: "HKD",
	});

	const lineData = (() => {
		if (timeline === "day") {
			return dashboard.day_series;
		}
		if (timeline === "month") {
			return dashboard.month_series;
		}
		return dashboard.year_series;
	})();

	useEffect(() => {
		void loadDashboard();
	}, []);

	async function loadDashboard(): Promise<void> {
		setLoading(true);
		setError(null);
		try {
			const nextDashboard = await request<DashboardResponse>("/api/dashboard");
			setDashboard(nextDashboard);
		} catch (requestError) {
			setError(
				requestError instanceof Error
					? requestError.message
					: "无法加载资产数据，请确认后端服务是否启动。",
			);
		} finally {
			setLoading(false);
		}
	}

	async function handleCreateCashAccount(event: FormEvent<HTMLFormElement>): Promise<void> {
		event.preventDefault();
		setSaving(true);
		setError(null);
		try {
			await request("/api/accounts", {
				method: "POST",
				body: JSON.stringify({
					...cashForm,
					balance: Number(cashForm.balance),
				}),
			});
			setCashForm({
				name: "",
				platform: "支付宝",
				currency: "CNY",
				balance: "",
			});
			await loadDashboard();
		} catch (requestError) {
			setError(
				requestError instanceof Error
					? requestError.message
					: "新增现金账户失败，请检查输入。",
			);
		} finally {
			setSaving(false);
		}
	}

	async function handleCreateHolding(event: FormEvent<HTMLFormElement>): Promise<void> {
		event.preventDefault();
		setSaving(true);
		setError(null);
		try {
			await request("/api/holdings", {
				method: "POST",
				body: JSON.stringify({
					...holdingForm,
					quantity: Number(holdingForm.quantity),
				}),
			});
			setHoldingForm({
				symbol: "",
				name: "",
				quantity: "",
				fallback_currency: "HKD",
			});
			await loadDashboard();
		} catch (requestError) {
			setError(
				requestError instanceof Error
					? requestError.message
					: "新增持仓失败，请检查输入。",
			);
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="app-shell">
			<div className="ambient ambient-left" />
			<div className="ambient ambient-right" />
			<header className="hero-panel">
				<div>
					<p className="eyebrow">PERSONAL ASSET TRACKER</p>
					<h1>个人资产总览</h1>
					<p className="hero-copy">
						统一以人民币展示现金、港股、美股等资产价值。默认使用免费的行情与汇率源，
						适合个人账本级的准实时跟踪，也支持手机浏览器安装为桌面应用。
					</p>
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

			{error ? <div className="banner error">{error}</div> : null}
			{dashboard.warnings.length > 0 ? (
				<div className="banner warning">
					{dashboard.warnings.map((warning) => (
						<p key={warning}>{warning}</p>
					))}
				</div>
			) : null}

			<section className="panel form-panel">
				<div className="form-block">
					<h2>新增现金账户</h2>
					<form onSubmit={(event) => void handleCreateCashAccount(event)}>
						<label>
							账户名称
							<input
								required
								value={cashForm.name}
								onChange={(event) =>
									setCashForm((current) => ({ ...current, name: event.target.value }))
								}
								placeholder="例如：日常备用金"
							/>
						</label>
						<label>
							平台
							<input
								required
								value={cashForm.platform}
								onChange={(event) =>
									setCashForm((current) => ({ ...current, platform: event.target.value }))
								}
								placeholder="支付宝 / 微信 / 银行卡"
							/>
						</label>
						<div className="split-fields">
							<label>
								币种
								<input
									required
									value={cashForm.currency}
									onChange={(event) =>
										setCashForm((current) => ({ ...current, currency: event.target.value }))
									}
									placeholder="CNY"
								/>
							</label>
							<label>
								余额
								<input
									required
									type="number"
									min="0"
									step="0.01"
									value={cashForm.balance}
									onChange={(event) =>
										setCashForm((current) => ({ ...current, balance: event.target.value }))
									}
									placeholder="10000"
								/>
							</label>
						</div>
						<button type="submit" disabled={saving}>
							保存现金账户
						</button>
					</form>
				</div>

				<div className="form-block">
					<h2>新增证券持仓</h2>
					<form onSubmit={(event) => void handleCreateHolding(event)}>
						<label>
							证券代码
							<input
								required
								value={holdingForm.symbol}
								onChange={(event) =>
									setHoldingForm((current) => ({ ...current, symbol: event.target.value }))
								}
								placeholder="0700.HK / AAPL / 600519.SS"
							/>
						</label>
						<label>
							名称
							<input
								required
								value={holdingForm.name}
								onChange={(event) =>
									setHoldingForm((current) => ({ ...current, name: event.target.value }))
								}
								placeholder="腾讯控股"
							/>
						</label>
						<div className="split-fields">
							<label>
								数量
								<input
									required
									type="number"
									min="0.0001"
									step="0.0001"
									value={holdingForm.quantity}
									onChange={(event) =>
										setHoldingForm((current) => ({ ...current, quantity: event.target.value }))
									}
									placeholder="100"
								/>
							</label>
							<label>
								备用币种
								<input
									required
									value={holdingForm.fallback_currency}
									onChange={(event) =>
										setHoldingForm((current) => ({
											...current,
											fallback_currency: event.target.value,
										}))
									}
									placeholder="HKD"
								/>
							</label>
						</div>
						<button type="submit" disabled={saving}>
							保存持仓
						</button>
					</form>
				</div>
			</section>

			<section className="panel chart-panel">
				<div className="panel-header">
					<div>
						<p className="eyebrow">TREND</p>
						<h2>资产变化趋势</h2>
					</div>
					<div className="segmented-control">
						{(["day", "month", "year"] as const).map((item) => (
							<button
								key={item}
								type="button"
								className={timeline === item ? "active" : ""}
								onClick={() => setTimeline(item)}
							>
								{item === "day" ? "天" : item === "month" ? "月" : "年"}
							</button>
						))}
					</div>
				</div>
				<div className="chart-layout">
					<div className="chart-card large">
						{loading ? (
							<div className="empty-state">正在加载资产趋势...</div>
						) : lineData.length === 0 ? (
							<div className="empty-state">
								还没有足够的快照数据。新增或刷新资产后，这里会逐步形成天/月/年曲线。
							</div>
						) : (
							<ResponsiveContainer width="100%" height={320}>
								<LineChart data={lineData}>
									<CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
									<XAxis dataKey="label" stroke="#d6d4cb" tickLine={false} />
									<YAxis
										stroke="#d6d4cb"
										tickLine={false}
										tickFormatter={(value) => `${Math.round(value / 1000)}k`}
									/>
									<Tooltip
										formatter={formatTooltipValue}
										contentStyle={{
											backgroundColor: "#161615",
											border: "1px solid rgba(255,255,255,0.08)",
											borderRadius: 16,
										}}
									/>
									<Line
										type="monotone"
										dataKey="value"
										stroke="#ef476f"
										strokeWidth={3}
										dot={{ r: 4, strokeWidth: 0, fill: "#ffd166" }}
										activeDot={{ r: 6 }}
									/>
								</LineChart>
							</ResponsiveContainer>
						)}
					</div>
					<div className="chart-card compact">
						<h3>资产分布</h3>
						{dashboard.allocation.every((item) => item.value === 0) ? (
							<div className="empty-state">录入资产后，这里会显示现金与证券占比。</div>
						) : (
							<ResponsiveContainer width="100%" height={280}>
								<PieChart>
									<Pie
										data={dashboard.allocation}
										dataKey="value"
										nameKey="label"
										innerRadius={60}
										outerRadius={92}
										paddingAngle={4}
									>
										{dashboard.allocation.map((entry, index) => (
											<Cell
												key={`${entry.label}-${entry.value}`}
												fill={CHART_COLORS[index % CHART_COLORS.length]}
											/>
										))}
									</Pie>
									<Tooltip
										formatter={formatTooltipValue}
										contentStyle={{
											backgroundColor: "#161615",
											border: "1px solid rgba(255,255,255,0.08)",
											borderRadius: 16,
										}}
									/>
								</PieChart>
							</ResponsiveContainer>
						)}
						<div className="legend-list">
							{dashboard.allocation.map((item, index) => (
								<div className="legend-item" key={item.label}>
									<span
										className="legend-swatch"
										style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
									/>
									<span>{item.label}</span>
									<strong>{formatCny(item.value)}</strong>
								</div>
							))}
						</div>
					</div>
				</div>
			</section>

			<section className="asset-grid">
				<div className="panel list-panel">
					<div className="panel-header">
						<div>
							<p className="eyebrow">CASH</p>
							<h2>现金账户</h2>
						</div>
						<button type="button" className="ghost-button" onClick={() => void loadDashboard()}>
							刷新
						</button>
					</div>
					<div className="table-scroll">
						<table>
							<thead>
								<tr>
									<th>平台</th>
									<th>账户</th>
									<th>余额</th>
									<th>折算人民币</th>
								</tr>
							</thead>
							<tbody>
								{dashboard.cash_accounts.length === 0 ? (
									<tr>
										<td colSpan={4} className="empty-cell">
											暂无现金账户
										</td>
									</tr>
								) : (
									dashboard.cash_accounts.map((account) => (
										<tr key={account.id}>
											<td>{account.platform}</td>
											<td>{account.name}</td>
											<td>
												{account.balance.toLocaleString("zh-CN")} {account.currency}
											</td>
											<td>{formatCny(account.value_cny)}</td>
										</tr>
									))
								)}
							</tbody>
						</table>
					</div>
				</div>

				<div className="panel list-panel">
					<div className="panel-header">
						<div>
							<p className="eyebrow">HOLDINGS</p>
							<h2>证券持仓</h2>
						</div>
						<button type="button" className="ghost-button" onClick={() => void loadDashboard()}>
							刷新
						</button>
					</div>
					<div className="table-scroll">
						<table>
							<thead>
								<tr>
									<th>代码</th>
									<th>名称</th>
									<th>数量</th>
									<th>现价</th>
									<th>折算人民币</th>
								</tr>
							</thead>
							<tbody>
								{dashboard.holdings.length === 0 ? (
									<tr>
										<td colSpan={5} className="empty-cell">
											暂无证券持仓
										</td>
									</tr>
								) : (
									dashboard.holdings.map((holding) => (
										<tr key={holding.id}>
											<td>{holding.symbol}</td>
											<td>{holding.name}</td>
											<td>{holding.quantity.toLocaleString("zh-CN")}</td>
											<td>
												{holding.price.toLocaleString("zh-CN")} {holding.price_currency}
											</td>
											<td>{formatCny(holding.value_cny)}</td>
										</tr>
									))
								)}
							</tbody>
						</table>
					</div>
				</div>
			</section>
		</div>
	);
}

export default App;
