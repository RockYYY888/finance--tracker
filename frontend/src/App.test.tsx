import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import {
	__resetAutoRefreshGuardsForTests,
	__setAutoRefreshGuardForTests,
} from "./lib/autoRefreshGuards";
import { EMPTY_DASHBOARD } from "./types/dashboard";

const STORAGE_KEY = "asset-tracker-last-session-user";
const DASHBOARD_CACHE_KEY_PREFIX = "asset-tracker-dashboard-cache:";

const authApiMocks = vi.hoisted(() => ({
	getAuthSession: vi.fn(),
	loginWithPassword: vi.fn(),
	logoutCurrentUser: vi.fn(),
	registerWithPassword: vi.fn(),
	resetPasswordWithEmail: vi.fn(),
	updateCurrentUserEmail: vi.fn(),
}));

const dashboardApiMocks = vi.hoisted(() => ({
	getDashboard: vi.fn(),
}));

const assetApiMocks = vi.hoisted(() => ({
	createAssetManagerController: vi.fn(() => ({})),
	listAgentRegistrations: vi.fn(),
	listAgentTasks: vi.fn(),
	listAssetRecords: vi.fn(),
}));

const feedbackApiMocks = vi.hoisted(() => ({
	submitUserFeedback: vi.fn(),
	getFeedbackSummary: vi.fn(),
	listFeedbackForCurrentUser: vi.fn(),
	markFeedbackSeenForCurrentUser: vi.fn(),
	listUserFeedbackForAdmin: vi.fn(),
	listSystemFeedbackForAdmin: vi.fn(),
	replyToFeedbackForAdmin: vi.fn(),
	closeFeedbackForAdmin: vi.fn(),
	hideInboxMessageForCurrentUser: vi.fn(),
	listReleaseNotesForCurrentUser: vi.fn(),
	markReleaseNotesSeenForCurrentUser: vi.fn(),
	listReleaseNotesForAdmin: vi.fn(),
	createReleaseNoteForAdmin: vi.fn(),
	publishReleaseNoteForAdmin: vi.fn(),
}));

const assetRecordsDialogMocks = vi.hoisted(() => ({
	lastOpenState: false,
}));

const assetManagerMocks = vi.hoisted(() => ({
	lastProps: null as Record<string, unknown> | null,
}));

vi.mock("./lib/authApi", () => ({
	getAuthSession: authApiMocks.getAuthSession,
	loginWithPassword: authApiMocks.loginWithPassword,
	logoutCurrentUser: authApiMocks.logoutCurrentUser,
	registerWithPassword: authApiMocks.registerWithPassword,
	resetPasswordWithEmail: authApiMocks.resetPasswordWithEmail,
	updateCurrentUserEmail: authApiMocks.updateCurrentUserEmail,
}));

vi.mock("./lib/dashboardApi", () => ({
	getDashboard: dashboardApiMocks.getDashboard,
}));

vi.mock("./lib/assetApi", () => ({
	createAssetManagerController: assetApiMocks.createAssetManagerController,
	defaultAssetApiClient: {
		listAgentRegistrations: assetApiMocks.listAgentRegistrations,
		listAgentTasks: assetApiMocks.listAgentTasks,
		listAssetRecords: assetApiMocks.listAssetRecords,
	},
}));

vi.mock("./components/auth/LoginScreen", () => ({
	LoginScreen: () => <div data-testid="login-screen">登录页</div>,
}));

vi.mock("./components/assets", () => ({
	AssetManager: (props: Record<string, unknown>) => {
		assetManagerMocks.lastProps = props;
		return <div data-testid="asset-manager">资产模块</div>;
	},
}));

vi.mock("./components/analytics", () => ({
	PortfolioAnalytics: () => <div data-testid="portfolio-analytics">分析模块</div>,
}));

vi.mock("./components/assets/AgentExecutionAuditPanel", () => ({
	AgentExecutionAuditPanel: ({ loading }: { loading?: boolean }) => (
		<div data-testid="agent-audit-panel">{loading ? "智能体加载中" : "智能体模块"}</div>
	),
}));

vi.mock("./components/assets/AssetRecordsDialog", () => ({
	AssetRecordsDialog: ({ open }: { open: boolean }) => {
		assetRecordsDialogMocks.lastOpenState = open;
		return open ? <div data-testid="asset-records-dialog">记录弹窗</div> : null;
	},
}));

vi.mock("./components/feedback/FeedbackDialog", () => ({
	FeedbackDialog: () => null,
}));

vi.mock("./components/feedback/AdminFeedbackDialog", () => ({
	AdminFeedbackDialog: () => null,
}));
vi.mock("./components/feedback/AdminReleaseNotesDialog", () => ({
	AdminReleaseNotesDialog: () => null,
}));

vi.mock("./components/feedback/UserFeedbackInboxDialog", () => ({
	UserFeedbackInboxDialog: () => null,
}));

vi.mock("./lib/feedbackApi", () => ({
	submitUserFeedback: feedbackApiMocks.submitUserFeedback,
	getFeedbackSummary: feedbackApiMocks.getFeedbackSummary,
	listFeedbackForCurrentUser: feedbackApiMocks.listFeedbackForCurrentUser,
	markFeedbackSeenForCurrentUser: feedbackApiMocks.markFeedbackSeenForCurrentUser,
	listUserFeedbackForAdmin: feedbackApiMocks.listUserFeedbackForAdmin,
	listSystemFeedbackForAdmin: feedbackApiMocks.listSystemFeedbackForAdmin,
	replyToFeedbackForAdmin: feedbackApiMocks.replyToFeedbackForAdmin,
	closeFeedbackForAdmin: feedbackApiMocks.closeFeedbackForAdmin,
	hideInboxMessageForCurrentUser: feedbackApiMocks.hideInboxMessageForCurrentUser,
	listReleaseNotesForCurrentUser: feedbackApiMocks.listReleaseNotesForCurrentUser,
	markReleaseNotesSeenForCurrentUser: feedbackApiMocks.markReleaseNotesSeenForCurrentUser,
	listReleaseNotesForAdmin: feedbackApiMocks.listReleaseNotesForAdmin,
	createReleaseNoteForAdmin: feedbackApiMocks.createReleaseNoteForAdmin,
	publishReleaseNoteForAdmin: feedbackApiMocks.publishReleaseNoteForAdmin,
}));

function createDeferredPromise<T>() {
	let resolvePromise!: (value: T | PromiseLike<T>) => void;
	let rejectPromise!: (reason?: unknown) => void;

	const promise = new Promise<T>((resolve, reject) => {
		resolvePromise = resolve;
		rejectPromise = reject;
	});

	return {
		promise,
		resolve: resolvePromise,
		reject: rejectPromise,
	};
}

async function flushMicrotasks(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

describe("App session restore", () => {
	afterEach(() => {
		cleanup();
	});

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useRealTimers();
		assetRecordsDialogMocks.lastOpenState = false;
		assetManagerMocks.lastProps = null;
		__resetAutoRefreshGuardsForTests();
		window.sessionStorage.clear();
		window.localStorage.clear();
		authApiMocks.updateCurrentUserEmail.mockResolvedValue({ user_id: "alice", email: null });
		feedbackApiMocks.getFeedbackSummary.mockResolvedValue({
			inbox_count: 0,
			mode: "user-pending",
		});
		assetApiMocks.listAgentRegistrations.mockResolvedValue([]);
		assetApiMocks.listAgentTasks.mockResolvedValue([]);
		assetApiMocks.listAssetRecords.mockResolvedValue([]);
		feedbackApiMocks.listFeedbackForCurrentUser.mockResolvedValue([]);
		feedbackApiMocks.markFeedbackSeenForCurrentUser.mockResolvedValue(undefined);
		feedbackApiMocks.listUserFeedbackForAdmin.mockResolvedValue({
			items: [],
			total: 0,
			page: 1,
			page_size: 200,
			has_more: false,
		});
		feedbackApiMocks.listSystemFeedbackForAdmin.mockResolvedValue({
			items: [],
			total: 0,
			page: 1,
			page_size: 200,
			has_more: false,
		});
		feedbackApiMocks.hideInboxMessageForCurrentUser.mockResolvedValue(undefined);
		feedbackApiMocks.listReleaseNotesForCurrentUser.mockResolvedValue([]);
		feedbackApiMocks.markReleaseNotesSeenForCurrentUser.mockResolvedValue(undefined);
		feedbackApiMocks.listReleaseNotesForAdmin.mockResolvedValue([]);
		feedbackApiMocks.createReleaseNoteForAdmin.mockResolvedValue({
			id: 1,
			version: "0.2.0",
			title: "更新日志",
			content: "内容",
			source_feedback_ids: [],
			created_by: "admin",
			created_at: new Date().toISOString(),
			published_at: null,
			delivery_count: 0,
		});
		feedbackApiMocks.publishReleaseNoteForAdmin.mockResolvedValue({
			id: 1,
			version: "0.2.0",
			title: "更新日志",
			content: "内容",
			source_feedback_ids: [],
			created_by: "admin",
			created_at: new Date().toISOString(),
			published_at: new Date().toISOString(),
			delivery_count: 1,
		});
		feedbackApiMocks.replyToFeedbackForAdmin.mockResolvedValue({
			id: 1,
			user_id: "alice",
			message: "msg",
			category: "USER_REQUEST",
			priority: "MEDIUM",
			source: "USER",
			status: "IN_PROGRESS",
			is_system: false,
			reply_message: "reply",
			replied_at: new Date().toISOString(),
			replied_by: "admin",
			reply_seen_at: null,
			resolved_at: null,
			closed_by: null,
			created_at: new Date().toISOString(),
		});
		feedbackApiMocks.closeFeedbackForAdmin.mockResolvedValue({
			id: 1,
			user_id: "alice",
			message: "msg",
			category: "USER_REQUEST",
			priority: "MEDIUM",
			source: "USER",
			status: "RESOLVED",
			is_system: false,
			reply_message: null,
			replied_at: null,
			replied_by: null,
			reply_seen_at: null,
			resolved_at: null,
			closed_by: null,
			created_at: new Date().toISOString(),
		});
		dashboardApiMocks.getDashboard.mockResolvedValue({ ...EMPTY_DASHBOARD });
	});

	it("keeps the app shell visible while restoring a remembered session", async () => {
		const pendingSession = createDeferredPromise<{ user_id: string; email: string | null }>();
		authApiMocks.getAuthSession.mockReturnValue(pendingSession.promise);
		window.sessionStorage.setItem(STORAGE_KEY, "alice");

		render(<App />);

		expect(screen.queryByTestId("login-screen")).toBeNull();
		expect(screen.getByText("你好，alice")).not.toBeNull();
		expect(screen.getByText("正在恢复登录状态")).not.toBeNull();

		pendingSession.resolve({ user_id: "alice", email: null });

		await waitFor(() => {
			expect(dashboardApiMocks.getDashboard).toHaveBeenCalledWith(false);
		});
	});

	it("restores cached dashboard totals while remembered session recovery is in progress", () => {
		const pendingSession = createDeferredPromise<{ user_id: string; email: string | null }>();
		authApiMocks.getAuthSession.mockReturnValue(pendingSession.promise);
		window.sessionStorage.setItem(STORAGE_KEY, "alice");
		window.sessionStorage.setItem(
			`${DASHBOARD_CACHE_KEY_PREFIX}alice`,
			JSON.stringify({
				dashboard: {
					...EMPTY_DASHBOARD,
					total_value_cny: 250_763.82,
					cash_value_cny: 14_255.51,
					holdings_value_cny: 236_508.31,
				},
				lastUpdatedAt: "2026-03-14T13:20:09.000Z",
			}),
		);

		render(<App />);

		expect(screen.getByText("正在恢复登录状态")).not.toBeNull();
		expect(screen.getByText("¥25.08万")).not.toBeNull();
		expect(screen.getByText("¥1.43万")).not.toBeNull();
		expect(screen.getByText("¥23.65万")).not.toBeNull();
	});

	it("falls back to persistent dashboard cache when the tab cache is empty", () => {
		const pendingSession = createDeferredPromise<{ user_id: string; email: string | null }>();
		authApiMocks.getAuthSession.mockReturnValue(pendingSession.promise);
		window.localStorage.setItem(STORAGE_KEY, "alice");
		window.localStorage.setItem(
			`${DASHBOARD_CACHE_KEY_PREFIX}alice`,
			JSON.stringify({
				dashboard: {
					...EMPTY_DASHBOARD,
					total_value_cny: 198_880.12,
					holdings_value_cny: 168_200.45,
					cash_value_cny: 30_679.67,
				},
				lastUpdatedAt: "2026-03-14T13:45:00.000Z",
			}),
		);

		render(<App />);

		expect(screen.getByText("¥19.89万")).not.toBeNull();
		expect(screen.getByText("¥16.82万")).not.toBeNull();
		expect(screen.getByText("¥3.07万")).not.toBeNull();
	});

	it("shows placeholders instead of zero totals while remembered data is still loading", () => {
		const pendingSession = createDeferredPromise<{ user_id: string; email: string | null }>();
		authApiMocks.getAuthSession.mockReturnValue(pendingSession.promise);
		window.sessionStorage.setItem(STORAGE_KEY, "alice");

		render(<App />);

		expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(6);
		expect(screen.queryByText("¥0.00")).toBeNull();
	});

	it("writes the latest dashboard snapshot back to session storage after refresh", async () => {
		authApiMocks.getAuthSession.mockResolvedValue({ user_id: "alice", email: null });
		dashboardApiMocks.getDashboard.mockResolvedValue({
			...EMPTY_DASHBOARD,
			total_value_cny: 180_000,
			holdings_value_cny: 120_000,
			cash_value_cny: 60_000,
		});

		render(<App />);

		await waitFor(() => {
			expect(dashboardApiMocks.getDashboard).toHaveBeenCalledWith(false);
		});

		const cachedValue = window.sessionStorage.getItem(
			`${DASHBOARD_CACHE_KEY_PREFIX}alice`,
		);
		expect(cachedValue).not.toBeNull();
		expect(cachedValue).toContain("\"holdings_value_cny\":120000");
		expect(
			window.localStorage.getItem(`${DASHBOARD_CACHE_KEY_PREFIX}alice`),
		).toContain("\"holdings_value_cny\":120000");
	});

	it("passes hydrated dashboard collections into the asset manager", async () => {
		authApiMocks.getAuthSession.mockResolvedValue({ user_id: "alice", email: null });
		dashboardApiMocks.getDashboard.mockResolvedValue({
			...EMPTY_DASHBOARD,
			cash_accounts: [
				{
					id: 1,
					name: "主账户",
					platform: "Bank",
					currency: "CNY",
					balance: 100,
					account_type: "BANK",
					value_cny: 100,
				},
			],
			holdings: [
				{
					id: 1,
					side: "BUY",
					symbol: "AAPL",
					name: "Apple",
					quantity: 2,
					fallback_currency: "USD",
					cost_basis_price: 180,
					market: "US",
					broker: "Futu",
					started_on: "2026-03-08",
					note: "长期",
					price: 188,
					price_currency: "USD",
					value_cny: 2710,
					return_pct: 4.44,
					last_updated: "2026-03-10T12:00:00Z",
				},
			],
			fixed_assets: [],
			liabilities: [],
			other_assets: [],
		});

		render(<App />);

		await waitFor(() => {
			expect(dashboardApiMocks.getDashboard).toHaveBeenCalledWith(false);
		});
		await waitFor(() => {
			expect(assetManagerMocks.lastProps).not.toBeNull();
		});

		expect(assetManagerMocks.lastProps).toMatchObject({
			initialCashAccounts: [
				expect.objectContaining({ id: 1, name: "主账户" }),
			],
			initialHoldings: [
				expect.objectContaining({ id: 1, symbol: "AAPL" }),
			],
		});
	});

	it("falls back to the login screen when session restore fails", async () => {
		authApiMocks.getAuthSession.mockRejectedValue(new Error("请先登录。"));
		window.sessionStorage.setItem(STORAGE_KEY, "alice");

		render(<App />);

		expect(screen.queryByTestId("login-screen")).toBeNull();

		await waitFor(() => {
			expect(screen.getByTestId("login-screen")).not.toBeNull();
		});

		expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
	});

	it("pauses timed dashboard refresh while user input is protected by a refresh guard", async () => {
		vi.useFakeTimers();
		authApiMocks.getAuthSession.mockResolvedValue({ user_id: "alice", email: null });

		render(<App />);

		await act(async () => {
			await flushMicrotasks();
		});
		expect(dashboardApiMocks.getDashboard).toHaveBeenCalledTimes(1);

		act(() => {
			__setAutoRefreshGuardForTests("test-editing", true);
		});

		await act(async () => {
			await vi.advanceTimersByTimeAsync(130000);
		});
		expect(dashboardApiMocks.getDashboard).toHaveBeenCalledTimes(1);
		const callCountBeforeResume = dashboardApiMocks.getDashboard.mock.calls.length;

		act(() => {
			__setAutoRefreshGuardForTests("test-editing", false);
		});

		await act(async () => {
			await flushMicrotasks();
		});
		expect(dashboardApiMocks.getDashboard.mock.calls.length).toBeGreaterThan(callCountBeforeResume);
	});

	it("renders workspace tabs in manage insights agent order", async () => {
		authApiMocks.getAuthSession.mockResolvedValue({ user_id: "alice", email: null });

		render(<App />);

		await waitFor(() => {
			expect(dashboardApiMocks.getDashboard).toHaveBeenCalledWith(false);
		});

		const workspaceTabLists = screen.getAllByRole("tablist", { name: "页面视图" });
		const activeWorkspaceTabList = workspaceTabLists[workspaceTabLists.length - 1];

		expect(
			within(activeWorkspaceTabList)
				.getAllByRole("tab")
				.map((tab) => tab.textContent?.trim()),
		).toEqual(["管理", "洞察", "智能体"]);
	});

	it("keeps the manage workspace mounted while switching to other tabs", async () => {
		authApiMocks.getAuthSession.mockResolvedValue({ user_id: "alice", email: null });

		render(<App />);

		await waitFor(() => {
			expect(dashboardApiMocks.getDashboard).toHaveBeenCalledWith(false);
		});

		expect(screen.getByTestId("asset-manager")).not.toBeNull();

		await act(async () => {
			screen.getByRole("tab", { name: "洞察" }).click();
		});

		expect(screen.getByTestId("asset-manager")).not.toBeNull();
		await waitFor(() => {
			expect(screen.getByTestId("portfolio-analytics")).not.toBeNull();
		});

		await act(async () => {
			screen.getByRole("tab", { name: "管理" }).click();
		});

		expect(screen.getByTestId("asset-manager")).not.toBeNull();
	});

	it("keeps inactive workspaces mounted but hidden while switching tabs", async () => {
		authApiMocks.getAuthSession.mockResolvedValue({ user_id: "alice", email: null });

		render(<App />);

		await waitFor(() => {
			expect(dashboardApiMocks.getDashboard).toHaveBeenCalledWith(false);
		});

		const managePanel = screen.getByTestId("asset-manager").closest(".integrated-stack");
		expect(managePanel?.hasAttribute("hidden")).toBe(false);

		await act(async () => {
			screen.getByRole("tab", { name: "智能体" }).click();
		});

		await waitFor(() => {
			expect(screen.getByTestId("agent-audit-panel")).not.toBeNull();
		});

		const agentPanel = screen.getByTestId("agent-audit-panel").closest(".section-shell");
		expect(agentPanel?.hasAttribute("hidden")).toBe(false);
		expect(managePanel?.hasAttribute("hidden")).toBe(true);

		await act(async () => {
			screen.getByRole("tab", { name: "洞察" }).click();
		});

		await waitFor(() => {
			expect(screen.getByTestId("portfolio-analytics")).not.toBeNull();
		});

		const insightsPanel = screen.getByTestId("portfolio-analytics").closest(".section-shell");
		expect(insightsPanel?.hasAttribute("hidden")).toBe(false);
		expect(agentPanel?.hasAttribute("hidden")).toBe(true);
		expect(managePanel?.hasAttribute("hidden")).toBe(true);
	});

	it("loads the agent workspace only after the user opens that tab and then reuses it", async () => {
		authApiMocks.getAuthSession.mockResolvedValue({ user_id: "alice", email: null });

		render(<App />);

		await waitFor(() => {
			expect(dashboardApiMocks.getDashboard).toHaveBeenCalledWith(false);
		});
		expect(assetApiMocks.listAgentRegistrations).not.toHaveBeenCalled();
		expect(assetApiMocks.listAgentTasks).not.toHaveBeenCalled();
		expect(assetApiMocks.listAssetRecords).not.toHaveBeenCalled();

		await act(async () => {
			screen.getByRole("tab", { name: "智能体" }).click();
		});

		await waitFor(() => {
			expect(assetApiMocks.listAgentRegistrations).toHaveBeenCalledWith({
				includeAllUsers: false,
			});
		});
		expect(assetApiMocks.listAgentTasks).toHaveBeenCalledTimes(1);
		expect(assetApiMocks.listAssetRecords).toHaveBeenCalledWith({
			source: "AGENT",
			limit: 120,
		});
		expect(screen.getByTestId("agent-audit-panel")).not.toBeNull();

		await act(async () => {
			screen.getByRole("tab", { name: "管理" }).click();
		});

		expect(screen.getByTestId("agent-audit-panel")).not.toBeNull();

		await act(async () => {
			screen.getByRole("tab", { name: "智能体" }).click();
		});

		expect(assetApiMocks.listAgentRegistrations).toHaveBeenCalledTimes(1);
		expect(assetApiMocks.listAgentTasks).toHaveBeenCalledTimes(1);
		expect(assetApiMocks.listAssetRecords).toHaveBeenCalledTimes(1);
	});

	it("opens the asset records dialog from the hero actions", async () => {
		authApiMocks.getAuthSession.mockResolvedValue({ user_id: "alice", email: null });

		render(<App />);

		await waitFor(() => {
			expect(dashboardApiMocks.getDashboard).toHaveBeenCalledWith(false);
		});

		expect(screen.queryByTestId("asset-records-dialog")).toBeNull();

		await act(async () => {
			screen.getByRole("button", { name: "记录" }).click();
		});

		expect(screen.getByTestId("asset-records-dialog")).not.toBeNull();
		expect(assetRecordsDialogMocks.lastOpenState).toBe(true);
	});
});
