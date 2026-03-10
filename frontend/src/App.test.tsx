import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import {
	__resetAutoRefreshGuardsForTests,
	__setAutoRefreshGuardForTests,
} from "./lib/autoRefreshGuards";
import { EMPTY_DASHBOARD } from "./types/dashboard";

const STORAGE_KEY = "asset-tracker-last-session-user";

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

vi.mock("./components/auth/LoginScreen", () => ({
	LoginScreen: () => <div data-testid="login-screen">登录页</div>,
}));

vi.mock("./components/assets", () => ({
	AssetManager: () => <div data-testid="asset-manager">资产模块</div>,
}));

vi.mock("./components/analytics", () => ({
	PortfolioAnalytics: () => <div data-testid="portfolio-analytics">分析模块</div>,
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
		__resetAutoRefreshGuardsForTests();
		window.sessionStorage.clear();
		authApiMocks.updateCurrentUserEmail.mockResolvedValue({ user_id: "alice", email: null });
		feedbackApiMocks.getFeedbackSummary.mockResolvedValue({
			inbox_count: 0,
			mode: "user-pending",
		});
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
