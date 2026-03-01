import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
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
	listFeedbackForAdmin: vi.fn(),
	replyToFeedbackForAdmin: vi.fn(),
	closeFeedbackForAdmin: vi.fn(),
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

vi.mock("./components/feedback/FeedbackDialog", () => ({
	FeedbackDialog: () => null,
}));

vi.mock("./components/feedback/AdminFeedbackDialog", () => ({
	AdminFeedbackDialog: () => null,
}));

vi.mock("./components/feedback/UserFeedbackInboxDialog", () => ({
	UserFeedbackInboxDialog: () => null,
}));

vi.mock("./lib/feedbackApi", () => ({
	submitUserFeedback: feedbackApiMocks.submitUserFeedback,
	getFeedbackSummary: feedbackApiMocks.getFeedbackSummary,
	listFeedbackForCurrentUser: feedbackApiMocks.listFeedbackForCurrentUser,
	listFeedbackForAdmin: feedbackApiMocks.listFeedbackForAdmin,
	replyToFeedbackForAdmin: feedbackApiMocks.replyToFeedbackForAdmin,
	closeFeedbackForAdmin: feedbackApiMocks.closeFeedbackForAdmin,
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

describe("App session restore", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		window.sessionStorage.clear();
		authApiMocks.updateCurrentUserEmail.mockResolvedValue({ user_id: "alice", email: null });
		feedbackApiMocks.getFeedbackSummary.mockResolvedValue({
			inbox_count: 0,
			mode: "user-pending",
		});
		feedbackApiMocks.listFeedbackForCurrentUser.mockResolvedValue([]);
		feedbackApiMocks.listFeedbackForAdmin.mockResolvedValue([]);
		feedbackApiMocks.replyToFeedbackForAdmin.mockResolvedValue({
			id: 1,
			user_id: "alice",
			message: "msg",
			reply_message: "reply",
			replied_at: new Date().toISOString(),
			replied_by: "admin",
			resolved_at: null,
			closed_by: null,
			created_at: new Date().toISOString(),
		});
		feedbackApiMocks.closeFeedbackForAdmin.mockResolvedValue({
			id: 1,
			user_id: "alice",
			message: "msg",
			reply_message: null,
			replied_at: null,
			replied_by: null,
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
});
