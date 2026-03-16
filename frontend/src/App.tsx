import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { AdminFeedbackDialog } from "./components/feedback/AdminFeedbackDialog";
import { AdminReleaseNotesDialog } from "./components/feedback/AdminReleaseNotesDialog";
import { AgentExecutionAuditPanel } from "./components/assets/AgentExecutionAuditPanel";
import { AssetRecordsDialog } from "./components/assets/AssetRecordsDialog";
import { EmailDialog } from "./components/auth/EmailDialog";
import { LoginScreen } from "./components/auth/LoginScreen";
import { AssetManager } from "./components/assets";
import { FeedbackDialog } from "./components/feedback/FeedbackDialog";
import { UserFeedbackInboxDialog } from "./components/feedback/UserFeedbackInboxDialog";
import { createAssetManagerController, defaultAssetApiClient } from "./lib/assetApi";
import {
	getAuthSession,
	loginWithPassword,
	logoutCurrentUser,
	registerWithPassword,
	resetPasswordWithEmail,
	updateCurrentUserEmail,
} from "./lib/authApi";
import { getDashboard } from "./lib/dashboardApi";
import { useHasActiveAutoRefreshGuards } from "./lib/autoRefreshGuards";
import {
	createReleaseNoteForAdmin,
	closeFeedbackForAdmin,
	getFeedbackSummary,
	hideInboxMessageForCurrentUser,
	listFeedbackForCurrentUser,
	listReleaseNotesForAdmin,
	listReleaseNotesForCurrentUser,
	listSystemFeedbackForAdmin,
	listUserFeedbackForAdmin,
	markFeedbackSeenForCurrentUser,
	markReleaseNotesSeenForCurrentUser,
	publishReleaseNoteForAdmin,
	replyToFeedbackForAdmin,
	submitUserFeedback,
} from "./lib/feedbackApi";
import type {
	AuthLoginCredentials,
	AuthRegisterCredentials,
	PasswordResetPayload,
	UserEmailUpdate,
} from "./types/auth";
import type {
	AgentRegistrationRecord,
	AgentTaskRecord,
	AssetRecordRecord,
	CashAccountRecord,
	FixedAssetRecord,
	HoldingRecord,
	OtherAssetRecord,
	SupportedCurrency,
	LiabilityRecord,
} from "./types/assets";
import { EMPTY_DASHBOARD, type DashboardResponse } from "./types/dashboard";
import type {
	AdminFeedbackRecord,
	ReleaseNoteDeliveryRecord,
	ReleaseNoteInput,
	ReleaseNoteRecord,
	UserFeedbackRecord,
} from "./types/feedback";
import type {
	ValuedCashAccount,
	ValuedFixedAsset,
	ValuedHolding,
	ValuedLiability,
	ValuedOtherAsset,
} from "./types/portfolioAnalytics";
import { formatCny } from "./utils/portfolioAnalytics";

type AuthStatus = "checking" | "anonymous" | "authenticated";
type WorkspaceView = "manage" | "agent" | "insights";
const SESSION_CHECK_TIMEOUT_MS = 3000;
const AUTH_SUBMISSION_TIMEOUT_MS = 10000;
const REMEMBERED_SESSION_USER_KEY = "asset-tracker-last-session-user";
const DASHBOARD_CACHE_KEY_PREFIX = "asset-tracker-dashboard-cache:";
const EMPTY_AGENT_TASKS: AgentTaskRecord[] = [];
const EMPTY_AGENT_REGISTRATIONS: AgentRegistrationRecord[] = [];
const EMPTY_AGENT_RECORDS: AssetRecordRecord[] = [];
const DEFAULT_MOUNTED_WORKSPACES: Record<WorkspaceView, boolean> = {
	manage: true,
	insights: false,
	agent: false,
};
const PortfolioAnalytics = lazy(async () => {
	const module = await import("./components/analytics");
	return { default: module.PortfolioAnalytics };
});
const assetManagerController = createAssetManagerController(defaultAssetApiClient);

function readRememberedSessionUserId(): string | null {
	if (typeof window === "undefined") {
		return null;
	}

	try {
		const rememberedUserId =
			window.sessionStorage.getItem(REMEMBERED_SESSION_USER_KEY) ??
			window.localStorage.getItem(REMEMBERED_SESSION_USER_KEY);
		if (!rememberedUserId) {
			return null;
		}

		return rememberedUserId.trim() || null;
	} catch {
		return null;
	}
}

function rememberSessionUserId(userId: string): void {
	try {
		window.sessionStorage.setItem(REMEMBERED_SESSION_USER_KEY, userId);
		window.localStorage.setItem(REMEMBERED_SESSION_USER_KEY, userId);
	} catch {
		// Ignore storage access issues and fall back to the normal session check.
	}
}

function clearRememberedSessionUserId(): void {
	try {
		window.sessionStorage.removeItem(REMEMBERED_SESSION_USER_KEY);
		window.localStorage.removeItem(REMEMBERED_SESSION_USER_KEY);
	} catch {
		// Ignore storage access issues and fall back to the normal session check.
	}
}

type DashboardCacheSnapshot = {
	dashboard: DashboardResponse;
	lastUpdatedAt: string | null;
};

function toSupportedCurrency(value: string, fallback: SupportedCurrency = "CNY"): SupportedCurrency {
	return value === "USD" || value === "HKD" || value === "CNY" ? value : fallback;
}

function toCashAccountSeed(account: ValuedCashAccount): CashAccountRecord {
	return {
		id: account.id,
		name: account.name,
		platform: account.platform,
		currency: toSupportedCurrency(account.currency),
		balance: account.balance,
		account_type: account.account_type,
		started_on: account.started_on ?? undefined,
		note: account.note ?? undefined,
		fx_to_cny: account.fx_to_cny,
		value_cny: account.value_cny,
	};
}

function toHoldingSeed(holding: ValuedHolding): HoldingRecord {
	return {
		id: holding.id,
		side: "BUY",
		symbol: holding.symbol,
		name: holding.name,
		quantity: holding.quantity,
		fallback_currency: toSupportedCurrency(holding.fallback_currency),
		cost_basis_price: holding.cost_basis_price ?? undefined,
		market: holding.market,
		broker: holding.broker ?? undefined,
		started_on: holding.started_on ?? undefined,
		note: holding.note ?? undefined,
		price: holding.price,
		price_currency: holding.price_currency,
		value_cny: holding.value_cny,
		return_pct: holding.return_pct ?? undefined,
		last_updated: holding.last_updated,
	};
}

function toFixedAssetSeed(asset: ValuedFixedAsset): FixedAssetRecord {
	return {
		id: asset.id,
		name: asset.name,
		category: asset.category,
		current_value_cny: asset.current_value_cny,
		purchase_value_cny: asset.purchase_value_cny ?? undefined,
		started_on: asset.started_on ?? undefined,
		note: asset.note ?? undefined,
		value_cny: asset.value_cny,
		return_pct: asset.return_pct ?? undefined,
	};
}

function toLiabilitySeed(entry: ValuedLiability): LiabilityRecord {
	return {
		id: entry.id,
		name: entry.name,
		category: entry.category,
		currency: toSupportedCurrency(entry.currency),
		balance: entry.balance,
		started_on: entry.started_on ?? undefined,
		note: entry.note ?? undefined,
		fx_to_cny: entry.fx_to_cny,
		value_cny: entry.value_cny,
	};
}

function toOtherAssetSeed(asset: ValuedOtherAsset): OtherAssetRecord {
	return {
		id: asset.id,
		name: asset.name,
		category: asset.category,
		current_value_cny: asset.current_value_cny,
		original_value_cny: asset.original_value_cny ?? undefined,
		started_on: asset.started_on ?? undefined,
		note: asset.note ?? undefined,
		value_cny: asset.value_cny,
		return_pct: asset.return_pct ?? undefined,
	};
}

function getDashboardCacheKey(userId: string): string {
	return `${DASHBOARD_CACHE_KEY_PREFIX}${userId}`;
}

function readCachedDashboardSnapshot(userId: string): DashboardCacheSnapshot | null {
	if (typeof window === "undefined") {
		return null;
	}

	try {
		const rawValue =
			window.sessionStorage.getItem(getDashboardCacheKey(userId)) ??
			window.localStorage.getItem(getDashboardCacheKey(userId));
		if (!rawValue) {
			return null;
		}

		const parsedValue = JSON.parse(rawValue) as Partial<DashboardCacheSnapshot> | null;
		if (
			!parsedValue ||
			typeof parsedValue !== "object" ||
			!parsedValue.dashboard ||
			typeof parsedValue.dashboard !== "object"
		) {
			return null;
		}

		return {
			dashboard: parsedValue.dashboard as DashboardResponse,
			lastUpdatedAt:
				typeof parsedValue.lastUpdatedAt === "string" ? parsedValue.lastUpdatedAt : null,
		};
	} catch {
		return null;
	}
}

function writeCachedDashboardSnapshot(
	userId: string,
	dashboard: DashboardResponse,
	lastUpdatedAt: string | null,
): void {
	if (typeof window === "undefined") {
		return;
	}

	try {
		const serializedSnapshot = JSON.stringify({
			dashboard,
			lastUpdatedAt,
		} satisfies DashboardCacheSnapshot);
		window.sessionStorage.setItem(
			getDashboardCacheKey(userId),
			serializedSnapshot,
		);
		window.localStorage.setItem(getDashboardCacheKey(userId), serializedSnapshot);
	} catch {
		// Ignore storage write failures and continue with in-memory state only.
	}
}

function isDashboardSnapshotEmpty(dashboard: DashboardResponse): boolean {
	return (
		dashboard.total_value_cny === 0 &&
		dashboard.cash_value_cny === 0 &&
		dashboard.holdings_value_cny === 0 &&
		dashboard.fixed_assets_value_cny === 0 &&
		dashboard.other_assets_value_cny === 0 &&
		dashboard.liabilities_value_cny === 0
	);
}

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

async function withTimeout<T>(
	task: Promise<T>,
	timeoutMs: number,
	timeoutMessage: string,
): Promise<T> {
	let timeoutId = 0;

	try {
		return await Promise.race([
			task,
			new Promise<T>((_, reject) => {
				timeoutId = window.setTimeout(() => {
					reject(new Error(timeoutMessage));
				}, timeoutMs);
			}),
		]);
	} finally {
		if (timeoutId) {
			window.clearTimeout(timeoutId);
		}
	}
}

function removeRecordById<T extends { id: number }>(records: T[], recordId: number): T[] {
	return records.filter((record) => record.id !== recordId);
}

function replaceRecordById<T extends { id: number }>(records: T[], nextRecord: T): T[] {
	let hasReplacement = false;
	const updatedRecords = records.map((record) => {
		if (record.id !== nextRecord.id) {
			return record;
		}

		hasReplacement = true;
		return nextRecord;
	});

	return hasReplacement ? updatedRecords : records;
}

function App() {
	const [authStatus, setAuthStatus] = useState<AuthStatus>("checking");
	const [currentUserId, setCurrentUserId] = useState<string | null>(() =>
		readRememberedSessionUserId()
	);
	const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
	const [authErrorMessage, setAuthErrorMessage] = useState<string | null>(null);
	const [authNoticeMessage, setAuthNoticeMessage] = useState<string | null>(null);
	const [isSubmittingAuth, setIsSubmittingAuth] = useState(false);
	const [dashboard, setDashboard] = useState<DashboardResponse>(() => {
		const rememberedUserId = readRememberedSessionUserId();
		return rememberedUserId
			? readCachedDashboardSnapshot(rememberedUserId)?.dashboard ?? EMPTY_DASHBOARD
			: EMPTY_DASHBOARD;
	});
	const [isLoadingDashboard, setIsLoadingDashboard] = useState(false);
	const [isRefreshingDashboard, setIsRefreshingDashboard] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(() => {
		const rememberedUserId = readRememberedSessionUserId();
		return rememberedUserId
			? readCachedDashboardSnapshot(rememberedUserId)?.lastUpdatedAt ?? null
			: null;
	});
	const [isAssetRecordsOpen, setIsAssetRecordsOpen] = useState(false);
	const [assetRecordsDialogVersion, setAssetRecordsDialogVersion] = useState(0);
	const [assetRecordRefreshToken, setAssetRecordRefreshToken] = useState(0);
	const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
	const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
	const [feedbackErrorMessage, setFeedbackErrorMessage] = useState<string | null>(null);
	const [feedbackNoticeMessage, setFeedbackNoticeMessage] = useState<string | null>(null);
	const [feedbackInboxCount, setFeedbackInboxCount] = useState(0);
	const [activeWorkspaceView, setActiveWorkspaceView] = useState<WorkspaceView>("manage");
	const [mountedWorkspaceViews, setMountedWorkspaceViews] = useState<Record<WorkspaceView, boolean>>(
		DEFAULT_MOUNTED_WORKSPACES,
	);
	const [agentRegistrations, setAgentRegistrations] = useState<AgentRegistrationRecord[]>(
		EMPTY_AGENT_REGISTRATIONS,
	);
	const [agentTasks, setAgentTasks] = useState<AgentTaskRecord[]>(EMPTY_AGENT_TASKS);
	const [agentRecords, setAgentRecords] = useState<AssetRecordRecord[]>(EMPTY_AGENT_RECORDS);
	const [isLoadingAgentAudit, setIsLoadingAgentAudit] = useState(false);
	const [agentAuditErrorMessage, setAgentAuditErrorMessage] = useState<string | null>(null);
	const [isAdminInboxOpen, setIsAdminInboxOpen] = useState(false);
	const [isAdminReleaseNotesOpen, setIsAdminReleaseNotesOpen] = useState(false);
	const [isUserInboxOpen, setIsUserInboxOpen] = useState(false);
	const [isLoadingAdminInbox, setIsLoadingAdminInbox] = useState(false);
	const [isLoadingAdminReleaseNotes, setIsLoadingAdminReleaseNotes] = useState(false);
	const [adminInboxErrorMessage, setAdminInboxErrorMessage] = useState<string | null>(null);
	const [adminReleaseNotesErrorMessage, setAdminReleaseNotesErrorMessage] = useState<string | null>(
		null,
	);
	const [adminUserFeedbackItems, setAdminUserFeedbackItems] = useState<AdminFeedbackRecord[]>([]);
	const [adminSystemFeedbackItems, setAdminSystemFeedbackItems] = useState<AdminFeedbackRecord[]>(
		[],
	);
	const [adminReleaseNotes, setAdminReleaseNotes] = useState<ReleaseNoteRecord[]>([]);
	const [isLoadingUserInbox, setIsLoadingUserInbox] = useState(false);
	const [userInboxErrorMessage, setUserInboxErrorMessage] = useState<string | null>(null);
	const [userFeedbackItems, setUserFeedbackItems] = useState<UserFeedbackRecord[]>([]);
	const [userReleaseNotes, setUserReleaseNotes] = useState<ReleaseNoteDeliveryRecord[]>([]);
	const [isEmailDialogOpen, setIsEmailDialogOpen] = useState(false);
	const [isSubmittingEmail, setIsSubmittingEmail] = useState(false);
	const [emailDialogErrorMessage, setEmailDialogErrorMessage] = useState<string | null>(null);
	const [emailNoticeMessage, setEmailNoticeMessage] = useState<string | null>(null);
	const dashboardRequestInFlightRef = useRef(false);
	const pendingDashboardRefreshRef = useRef(false);
	const pendingForceRefreshRef = useRef(false);
	const autoRefreshResumeRef = useRef(false);
	const hasLoadedAgentAuditRef = useRef(false);
	const agentAuditRequestInFlightRef = useRef<Promise<void> | null>(null);
	const latestAgentAuditRequestIdRef = useRef(0);
	const isAutoRefreshBlocked = useHasActiveAutoRefreshGuards();

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

	function markSignedInWithProfile(userId: string, email: string | null): void {
		const cachedDashboardSnapshot = readCachedDashboardSnapshot(userId);
		rememberSessionUserId(userId);
		setCurrentUserId(userId);
		setCurrentUserEmail(email);
		setAuthStatus("authenticated");
		setAuthErrorMessage(null);
		setAuthNoticeMessage(null);
		setFeedbackNoticeMessage(null);
		setFeedbackInboxCount(0);
		setFeedbackErrorMessage(null);
		setIsFeedbackOpen(false);
		setIsAssetRecordsOpen(false);
		setAssetRecordsDialogVersion(0);
		setAssetRecordRefreshToken(0);
		setActiveWorkspaceView("manage");
		setMountedWorkspaceViews(DEFAULT_MOUNTED_WORKSPACES);
		setAgentRegistrations(EMPTY_AGENT_REGISTRATIONS);
		setAgentTasks(EMPTY_AGENT_TASKS);
		setAgentRecords(EMPTY_AGENT_RECORDS);
		setIsLoadingAgentAudit(false);
		setAgentAuditErrorMessage(null);
		hasLoadedAgentAuditRef.current = false;
		agentAuditRequestInFlightRef.current = null;
		latestAgentAuditRequestIdRef.current += 1;
		setIsLoadingAdminInbox(false);
		setAdminInboxErrorMessage(null);
		setIsAdminInboxOpen(false);
		setIsLoadingAdminReleaseNotes(false);
		setAdminReleaseNotesErrorMessage(null);
		setIsAdminReleaseNotesOpen(false);
		setAdminUserFeedbackItems([]);
		setAdminSystemFeedbackItems([]);
		setAdminReleaseNotes([]);
		setUserInboxErrorMessage(null);
		setIsUserInboxOpen(false);
		setUserFeedbackItems([]);
		setUserReleaseNotes([]);
		setEmailNoticeMessage(null);
		setEmailDialogErrorMessage(null);
		setIsEmailDialogOpen(false);
		setDashboard(cachedDashboardSnapshot?.dashboard ?? EMPTY_DASHBOARD);
		setLastUpdatedAt(cachedDashboardSnapshot?.lastUpdatedAt ?? null);
		setIsLoadingDashboard(cachedDashboardSnapshot === null);
	}

	function markSignedOut(): void {
		clearRememberedSessionUserId();
		setCurrentUserId(null);
		setCurrentUserEmail(null);
		setAuthStatus("anonymous");
		setAuthNoticeMessage(null);
		setFeedbackNoticeMessage(null);
		setFeedbackInboxCount(0);
		setFeedbackErrorMessage(null);
		setIsFeedbackOpen(false);
		setIsAssetRecordsOpen(false);
		setAssetRecordsDialogVersion(0);
		setAssetRecordRefreshToken(0);
		setActiveWorkspaceView("manage");
		setMountedWorkspaceViews(DEFAULT_MOUNTED_WORKSPACES);
		setAgentRegistrations(EMPTY_AGENT_REGISTRATIONS);
		setAgentTasks(EMPTY_AGENT_TASKS);
		setAgentRecords(EMPTY_AGENT_RECORDS);
		setIsLoadingAgentAudit(false);
		setAgentAuditErrorMessage(null);
		hasLoadedAgentAuditRef.current = false;
		agentAuditRequestInFlightRef.current = null;
		latestAgentAuditRequestIdRef.current += 1;
		setIsLoadingAdminInbox(false);
		setAdminInboxErrorMessage(null);
		setIsAdminInboxOpen(false);
		setIsLoadingAdminReleaseNotes(false);
		setAdminReleaseNotesErrorMessage(null);
		setIsAdminReleaseNotesOpen(false);
		setAdminUserFeedbackItems([]);
		setAdminSystemFeedbackItems([]);
		setAdminReleaseNotes([]);
		setUserInboxErrorMessage(null);
		setIsUserInboxOpen(false);
		setUserFeedbackItems([]);
		setUserReleaseNotes([]);
		setEmailNoticeMessage(null);
		setEmailDialogErrorMessage(null);
		setIsEmailDialogOpen(false);
		resetDashboardState();
	}

	useEffect(() => {
		void hydrateSession();
	}, []);

	useEffect(() => {
		if (mountedWorkspaceViews[activeWorkspaceView]) {
			return;
		}

		setMountedWorkspaceViews((currentViews) => ({
			...currentViews,
			[activeWorkspaceView]: true,
		}));
	}, [activeWorkspaceView, mountedWorkspaceViews]);

	useEffect(() => {
		if (authStatus !== "authenticated" || !currentUserId) {
			return;
		}

		void loadDashboard({ initial: true });
		void refreshFeedbackSummary();
	}, [authStatus, currentUserId]);

	useEffect(() => {
		if (authStatus !== "authenticated") {
			return;
		}
		if (isAutoRefreshBlocked) {
			autoRefreshResumeRef.current = true;
			return;
		}

		let refreshTimer = 0;
		const initialDelay = window.setTimeout(() => {
			void loadDashboard();
			refreshTimer = window.setInterval(() => {
				if (document.visibilityState !== "visible") {
					return;
				}
				void loadDashboard();
			}, 60 * 1000);
		}, getMillisecondsUntilNextMinute());

		return () => {
			window.clearTimeout(initialDelay);
			if (refreshTimer) {
				window.clearInterval(refreshTimer);
			}
		};
	}, [authStatus, isAutoRefreshBlocked]);

	useEffect(() => {
		if (
			authStatus !== "authenticated" ||
			isAutoRefreshBlocked ||
			!autoRefreshResumeRef.current
		) {
			return;
		}

		autoRefreshResumeRef.current = false;
		void loadDashboard();
	}, [authStatus, isAutoRefreshBlocked]);

	useEffect(() => {
		if (authStatus !== "authenticated" || isAutoRefreshBlocked) {
			return;
		}

		function handleVisibilityChange(): void {
			if (document.visibilityState === "visible") {
				void loadDashboard();
			}
		}

		document.addEventListener("visibilitychange", handleVisibilityChange);
		return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
	}, [authStatus, isAutoRefreshBlocked]);

	async function hydrateSession(): Promise<void> {
		setAuthStatus("checking");
		setAuthErrorMessage(null);
		setAuthNoticeMessage(null);

		try {
			const session = await withTimeout(
				getAuthSession(),
				SESSION_CHECK_TIMEOUT_MS,
				"会话检查超时",
			);
			markSignedInWithProfile(session.user_id, session.email ?? null);
		} catch {
			markSignedOut();
		}
	}

	async function submitAuth(
		mode: "login" | "register",
		payload: AuthLoginCredentials | AuthRegisterCredentials,
	): Promise<void> {
		setIsSubmittingAuth(true);
		setAuthErrorMessage(null);
		setAuthNoticeMessage(null);
		setAuthStatus("anonymous");

		try {
			const session = await withTimeout(
				mode === "login"
					? loginWithPassword(payload as AuthLoginCredentials)
					: registerWithPassword(payload as AuthRegisterCredentials),
				AUTH_SUBMISSION_TIMEOUT_MS,
				"请求超时，请检查后端服务或网络后重试。",
			);
			markSignedInWithProfile(session.user_id, session.email ?? null);
		} catch (error) {
			setAuthErrorMessage(
				error instanceof Error ? error.message : "登录失败，请稍后再试。",
			);
			setAuthStatus("anonymous");
		} finally {
			setIsSubmittingAuth(false);
		}
	}

	async function submitPasswordReset(payload: PasswordResetPayload): Promise<void> {
		setIsSubmittingAuth(true);
		setAuthErrorMessage(null);
		setAuthNoticeMessage(null);
		setAuthStatus("anonymous");

		try {
			const result = await withTimeout(
				resetPasswordWithEmail(payload),
				AUTH_SUBMISSION_TIMEOUT_MS,
				"请求超时，请检查后端服务或网络后重试。",
			);
			setAuthNoticeMessage(result.message);
		} catch (error) {
			setAuthErrorMessage(
				error instanceof Error ? error.message : "密码重置失败，请稍后再试。",
			);
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

	function openFeedbackDialog(): void {
		if (authStatus !== "authenticated") {
			return;
		}

		setFeedbackErrorMessage(null);
		setFeedbackNoticeMessage(null);
		setIsFeedbackOpen(true);
	}

	function openAssetRecordsDialog(): void {
		if (authStatus !== "authenticated") {
			return;
		}

		setAssetRecordsDialogVersion((currentValue) => currentValue + 1);
		setIsAssetRecordsOpen(true);
	}

	function closeAssetRecordsDialog(): void {
		setIsAssetRecordsOpen(false);
	}

	function openEmailDialog(): void {
		if (authStatus !== "authenticated") {
			return;
		}

		setEmailDialogErrorMessage(null);
		setEmailNoticeMessage(null);
		setIsEmailDialogOpen(true);
	}

	function closeEmailDialog(): void {
		if (isSubmittingEmail) {
			return;
		}

		setEmailDialogErrorMessage(null);
		setIsEmailDialogOpen(false);
	}

	function closeFeedbackDialog(): void {
		if (isSubmittingFeedback) {
			return;
		}

		setFeedbackErrorMessage(null);
		setIsFeedbackOpen(false);
	}

	async function refreshFeedbackSummary(): Promise<void> {
		if (authStatus !== "authenticated") {
			setFeedbackInboxCount(0);
			return;
		}

		try {
			const summary = await getFeedbackSummary();
			setFeedbackInboxCount(summary.inbox_count);
		} catch {
			// Keep current badge value when summary refresh fails.
		}
	}

	async function openAdminInbox(): Promise<void> {
		if (authStatus !== "authenticated" || currentUserId !== "admin") {
			return;
		}

		setAdminInboxErrorMessage(null);
		setIsAdminInboxOpen(true);
		setIsLoadingAdminInbox(true);

		try {
			const userFeedbackItems = await listUserFeedbackForAdmin();
			const systemFeedbackItems = await listSystemFeedbackForAdmin();
			setAdminUserFeedbackItems(userFeedbackItems.items);
			setAdminSystemFeedbackItems(systemFeedbackItems.items);
			await refreshFeedbackSummary();
		} catch (error) {
			setAdminInboxErrorMessage(
				error instanceof Error ? error.message : "消息加载失败，请稍后再试。",
			);
		} finally {
			setIsLoadingAdminInbox(false);
		}
	}

	function closeAdminInbox(): void {
		if (isLoadingAdminInbox) {
			return;
		}

		setAdminInboxErrorMessage(null);
		setIsAdminInboxOpen(false);
	}

	async function openAdminReleaseNotes(): Promise<void> {
		if (authStatus !== "authenticated" || currentUserId !== "admin") {
			return;
		}

		setAdminReleaseNotesErrorMessage(null);
		setIsAdminReleaseNotesOpen(true);
		setIsLoadingAdminReleaseNotes(true);

		try {
			const releaseNotes = await listReleaseNotesForAdmin();
			setAdminReleaseNotes(releaseNotes);
		} catch (error) {
			setAdminReleaseNotesErrorMessage(
				error instanceof Error ? error.message : "更新日志加载失败，请稍后再试。",
			);
		} finally {
			setIsLoadingAdminReleaseNotes(false);
		}
	}

	function closeAdminReleaseNotes(): void {
		if (isLoadingAdminReleaseNotes) {
			return;
		}

		setAdminReleaseNotesErrorMessage(null);
		setIsAdminReleaseNotesOpen(false);
	}

	async function openUserInbox(): Promise<void> {
		if (authStatus !== "authenticated") {
			return;
		}

		setUserInboxErrorMessage(null);
		setIsUserInboxOpen(true);
		setIsLoadingUserInbox(true);

		try {
			const feedbackItems = await listFeedbackForCurrentUser();
			const releaseNotes = await listReleaseNotesForCurrentUser();
			setUserFeedbackItems(feedbackItems);
			setUserReleaseNotes(releaseNotes);
			await markFeedbackSeenForCurrentUser();
			await markReleaseNotesSeenForCurrentUser();
			await refreshFeedbackSummary();
		} catch (error) {
			setUserInboxErrorMessage(
				error instanceof Error ? error.message : "消息加载失败，请稍后再试。",
			);
		} finally {
			setIsLoadingUserInbox(false);
		}
	}

	function closeUserInbox(): void {
		if (isLoadingUserInbox) {
			return;
		}

		setUserInboxErrorMessage(null);
		setIsUserInboxOpen(false);
	}

	async function handleSubmitFeedback(message: string): Promise<void> {
		setIsSubmittingFeedback(true);
		setFeedbackErrorMessage(null);

		try {
			await submitUserFeedback({ message });
			setFeedbackNoticeMessage("问题反馈已记录。");
			setIsFeedbackOpen(false);
			await refreshFeedbackSummary();
		} catch (error) {
			setFeedbackErrorMessage(
				error instanceof Error ? error.message : "反馈提交失败，请稍后再试。",
			);
		} finally {
			setIsSubmittingFeedback(false);
		}
	}

	async function handleCloseFeedbackItem(feedbackId: number): Promise<void> {
		setIsLoadingAdminInbox(true);
		setAdminInboxErrorMessage(null);

		try {
			const updatedItem = await closeFeedbackForAdmin(feedbackId);
			setAdminUserFeedbackItems((currentItems) =>
				replaceRecordById(currentItems, updatedItem),
			);
			setAdminSystemFeedbackItems((currentItems) =>
				replaceRecordById(currentItems, updatedItem),
			);
			await refreshFeedbackSummary();
		} catch (error) {
			setAdminInboxErrorMessage(
				error instanceof Error ? error.message : "关闭反馈失败，请稍后再试。",
			);
		} finally {
			setIsLoadingAdminInbox(false);
		}
	}

	async function handleReplyFeedbackItem(
		feedbackId: number,
		replyMessage: string,
		close: boolean,
	): Promise<void> {
		setIsLoadingAdminInbox(true);
		setAdminInboxErrorMessage(null);

		try {
			const updatedItem = await replyToFeedbackForAdmin(feedbackId, {
				reply_message: replyMessage,
				close,
			});
			setAdminUserFeedbackItems((currentItems) =>
				replaceRecordById(currentItems, updatedItem),
			);
			setAdminSystemFeedbackItems((currentItems) =>
				replaceRecordById(currentItems, updatedItem),
			);
			await refreshFeedbackSummary();
		} catch (error) {
			setAdminInboxErrorMessage(
				error instanceof Error ? error.message : "回复失败，请稍后再试。",
			);
		} finally {
			setIsLoadingAdminInbox(false);
		}
	}

	async function handleHideAdminFeedbackItem(feedbackId: number): Promise<void> {
		setIsLoadingAdminInbox(true);
		setAdminInboxErrorMessage(null);

		try {
			await hideInboxMessageForCurrentUser({
				message_kind: "FEEDBACK",
				message_id: feedbackId,
			});
			setAdminUserFeedbackItems((currentItems) =>
				removeRecordById(currentItems, feedbackId),
			);
			setAdminSystemFeedbackItems((currentItems) =>
				removeRecordById(currentItems, feedbackId),
			);
			await refreshFeedbackSummary();
		} catch (error) {
			setAdminInboxErrorMessage(
				error instanceof Error ? error.message : "移除消息失败，请稍后再试。",
			);
		} finally {
			setIsLoadingAdminInbox(false);
		}
	}

	async function handleCreateReleaseNote(payload: ReleaseNoteInput): Promise<void> {
		setIsLoadingAdminReleaseNotes(true);
		setAdminReleaseNotesErrorMessage(null);

		try {
			const createdReleaseNote = await createReleaseNoteForAdmin(payload);
			setAdminReleaseNotes((currentItems) => [createdReleaseNote, ...currentItems]);
			await refreshFeedbackSummary();
		} catch (error) {
			setAdminReleaseNotesErrorMessage(
				error instanceof Error ? error.message : "创建更新日志失败，请稍后再试。",
			);
		} finally {
			setIsLoadingAdminReleaseNotes(false);
		}
	}

	async function handlePublishReleaseNote(releaseNoteId: number): Promise<void> {
		setIsLoadingAdminReleaseNotes(true);
		setAdminReleaseNotesErrorMessage(null);

		try {
			const publishedReleaseNote = await publishReleaseNoteForAdmin(releaseNoteId);
			setAdminReleaseNotes((currentItems) =>
				currentItems.map((item) =>
					item.id === publishedReleaseNote.id ? publishedReleaseNote : item
				),
			);
			await refreshFeedbackSummary();
		} catch (error) {
			setAdminReleaseNotesErrorMessage(
				error instanceof Error ? error.message : "发布更新日志失败，请稍后再试。",
			);
		} finally {
			setIsLoadingAdminReleaseNotes(false);
		}
	}

	async function handleSubmitEmail(payload: UserEmailUpdate): Promise<void> {
		setIsSubmittingEmail(true);
		setEmailDialogErrorMessage(null);
		setEmailNoticeMessage(null);

		try {
			const session = await updateCurrentUserEmail(payload);
			setCurrentUserEmail(session.email ?? null);
			setEmailNoticeMessage("邮箱已更新。");
			setIsEmailDialogOpen(false);
		} catch (error) {
			setEmailDialogErrorMessage(
				error instanceof Error ? error.message : "邮箱保存失败，请稍后再试。",
			);
		} finally {
			setIsSubmittingEmail(false);
		}
	}

	async function handleHideUserFeedbackItem(feedbackId: number): Promise<void> {
		setIsLoadingUserInbox(true);
		setUserInboxErrorMessage(null);

		try {
			await hideInboxMessageForCurrentUser({
				message_kind: "FEEDBACK",
				message_id: feedbackId,
			});
			setUserFeedbackItems((currentItems) => removeRecordById(currentItems, feedbackId));
			await refreshFeedbackSummary();
		} catch (error) {
			setUserInboxErrorMessage(
				error instanceof Error ? error.message : "移除消息失败，请稍后再试。",
			);
		} finally {
			setIsLoadingUserInbox(false);
		}
	}

	async function handleHideUserReleaseNote(deliveryId: number): Promise<void> {
		setIsLoadingUserInbox(true);
		setUserInboxErrorMessage(null);

		try {
			await hideInboxMessageForCurrentUser({
				message_kind: "RELEASE_NOTE",
				message_id: deliveryId,
			});
			setUserReleaseNotes((currentItems) =>
				currentItems.filter((item) => item.delivery_id !== deliveryId),
			);
			await refreshFeedbackSummary();
		} catch (error) {
			setUserInboxErrorMessage(
				error instanceof Error ? error.message : "移除消息失败，请稍后再试。",
			);
		} finally {
			setIsLoadingUserInbox(false);
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
			const nextLastUpdatedAt = new Date().toISOString();
			setDashboard(nextDashboard);
			setLastUpdatedAt(nextLastUpdatedAt);
			if (currentUserId) {
				writeCachedDashboardSnapshot(currentUserId, nextDashboard, nextLastUpdatedAt);
			}
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

	useEffect(() => {
		if (authStatus !== "authenticated" || !currentUserId || activeWorkspaceView !== "agent") {
			return;
		}
		if (hasLoadedAgentAuditRef.current && !agentAuditErrorMessage) {
			return;
		}

		void loadAgentAudit({ force: Boolean(agentAuditErrorMessage) });
	}, [activeWorkspaceView, agentAuditErrorMessage, authStatus, currentUserId]);

	async function loadAgentAudit(options: { force?: boolean } = {}): Promise<void> {
		if (!currentUserId) {
			return;
		}
		if (hasLoadedAgentAuditRef.current && !options.force) {
			return;
		}
		if (agentAuditRequestInFlightRef.current && !options.force) {
			await agentAuditRequestInFlightRef.current;
			return;
		}

		const requestId = latestAgentAuditRequestIdRef.current + 1;
		latestAgentAuditRequestIdRef.current = requestId;
		setIsLoadingAgentAudit(true);
		setAgentAuditErrorMessage(null);

		let requestPromise: Promise<void> | null = null;
		requestPromise = Promise.all([
			defaultAssetApiClient.listAgentRegistrations({
				includeAllUsers: currentUserId === "admin",
			}),
			defaultAssetApiClient.listAgentTasks(),
			defaultAssetApiClient.listAssetRecords({
				source: "AGENT",
				limit: 120,
			}),
		])
			.then(([registrations, tasks, records]) => {
				if (latestAgentAuditRequestIdRef.current !== requestId) {
					return;
				}
				setAgentRegistrations(registrations);
				setAgentTasks(tasks);
				setAgentRecords(records);
				hasLoadedAgentAuditRef.current = true;
			})
			.catch((error) => {
				if (latestAgentAuditRequestIdRef.current !== requestId) {
					return;
				}
				hasLoadedAgentAuditRef.current = false;
				setAgentAuditErrorMessage(
					error instanceof Error ? error.message : "加载智能体审计失败。",
				);
			})
			.finally(() => {
				if (agentAuditRequestInFlightRef.current === requestPromise) {
					agentAuditRequestInFlightRef.current = null;
				}
				if (latestAgentAuditRequestIdRef.current === requestId) {
					setIsLoadingAgentAudit(false);
				}
			});
		agentAuditRequestInFlightRef.current = requestPromise;
		await requestPromise;
	}

	const isRecoveringSession = authStatus === "checking" && currentUserId !== null;

	if (!currentUserId || authStatus === "anonymous") {
		return (
			<LoginScreen
				loading={isSubmittingAuth}
				checkingSession={authStatus === "checking"}
				errorMessage={authErrorMessage}
				noticeMessage={authNoticeMessage}
				onLogin={(payload) => submitAuth("login", payload)}
				onRegister={(payload) => submitAuth("register", payload)}
				onResetPassword={submitPasswordReset}
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
	const showDashboardValuePlaceholder =
		(isRecoveringSession || isLoadingDashboard) &&
		lastUpdatedAt === null &&
		isDashboardSnapshotEmpty(dashboard);

	function formatDashboardSummaryValue(value: number): string {
		return showDashboardValuePlaceholder ? "—" : formatSummaryCny(value);
	}

	function getDashboardSummaryTitle(value: number): string {
		return showDashboardValuePlaceholder ? "正在恢复数据" : formatCny(value);
	}

	function requestDashboardRefresh(): void {
		void loadDashboard();
	}

	const hasDashboardSeedData = lastUpdatedAt !== null;
	const assetManagerSeeds = hasDashboardSeedData
		? {
			cashAccounts: dashboard.cash_accounts.map(toCashAccountSeed),
			holdings: dashboard.holdings.map(toHoldingSeed),
			fixedAssets: dashboard.fixed_assets.map(toFixedAssetSeed),
			liabilities: dashboard.liabilities.map(toLiabilitySeed),
			otherAssets: dashboard.other_assets.map(toOtherAssetSeed),
		}
		: null;

	return (
		<div className="app-shell">
			<div className="ambient ambient-left" />
			<div className="ambient ambient-right" />
			{isRecoveringSession ? (
				<div className="session-recovery-mask" role="status" aria-live="polite">
					<div className="session-recovery-mask__panel panel">
						<p className="eyebrow">SESSION RESTORE</p>
						<h2>正在恢复登录状态</h2>
						<p>验证通过后会继续停留在当前页面。</p>
					</div>
				</div>
			) : null}

			<header className="hero-panel">
				<div className="hero-copy-block">
					<p className="eyebrow">HENG CANG</p>
					<h1>你好，{currentUserId}</h1>
					<p className="hero-copy">你的资产与会话已隔离保存，并按分钟自动刷新。</p>
					<p className="hero-subtle">
						{currentUserEmail ? currentUserEmail : "未绑定邮箱，可用于找回密码。"}
					</p>
					<div className="hero-actions">
						<button
							type="button"
							className="hero-note hero-note--action"
							onClick={() => void loadDashboard({ forceRefresh: true })}
							disabled={isDashboardBusy || isRecoveringSession}
						>
							<span
								className={`hero-note__status ${isDashboardBusy ? "is-active" : ""}`}
								aria-hidden="true"
							/>
							<span>
								{isRecoveringSession
									? "正在恢复会话..."
									: isDashboardBusy
									? "同步中..."
									: `最近更新：${formatLastUpdated(lastUpdatedAt)}`}
							</span>
						</button>
						<button
							type="button"
							className="hero-note hero-note--action"
							onClick={openEmailDialog}
							disabled={isRecoveringSession || isSubmittingEmail}
						>
							{currentUserEmail ? "修改邮箱" : "绑定邮箱"}
						</button>
						<button
							type="button"
							className="hero-note hero-note--action"
							onClick={() =>
								currentUserId === "admin" ? void openAdminInbox() : void openUserInbox()
							}
							disabled={isRecoveringSession || isLoadingAdminInbox || isLoadingUserInbox}
						>
							{feedbackInboxCount > 0 ? `消息 (${feedbackInboxCount})` : "消息"}
						</button>
						{currentUserId === "admin" ? (
							<button
								type="button"
								className="hero-note hero-note--action"
								onClick={() => void openAdminReleaseNotes()}
								disabled={isRecoveringSession || isLoadingAdminReleaseNotes}
							>
								更新日志
							</button>
						) : null}
						<button
							type="button"
							className="hero-note hero-note--action"
							onClick={openAssetRecordsDialog}
							disabled={isRecoveringSession}
						>
							记录
						</button>
						<button
							type="button"
							className="hero-note hero-note--action"
							onClick={openFeedbackDialog}
							disabled={isRecoveringSession}
						>
							反馈问题
						</button>
						<button
							type="button"
							className="hero-note hero-note--action"
							onClick={() => void handleLogout()}
							disabled={isRecoveringSession}
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
						<strong title={getDashboardSummaryTitle(dashboard.total_value_cny)}>
							{formatDashboardSummaryValue(dashboard.total_value_cny)}
						</strong>
					</div>
					<div className="stat-card blue">
						<span>现金资产</span>
						<strong title={getDashboardSummaryTitle(dashboard.cash_value_cny)}>
							{formatDashboardSummaryValue(dashboard.cash_value_cny)}
						</strong>
					</div>
					<div className="stat-card green">
						<span>投资类</span>
						<strong title={getDashboardSummaryTitle(dashboard.holdings_value_cny)}>
							{formatDashboardSummaryValue(dashboard.holdings_value_cny)}
						</strong>
					</div>
					<div className="stat-card violet">
						<span>固定资产</span>
						<strong title={getDashboardSummaryTitle(dashboard.fixed_assets_value_cny)}>
							{formatDashboardSummaryValue(dashboard.fixed_assets_value_cny)}
						</strong>
					</div>
					<div className="stat-card amber">
						<span>其他</span>
						<strong title={getDashboardSummaryTitle(dashboard.other_assets_value_cny)}>
							{formatDashboardSummaryValue(dashboard.other_assets_value_cny)}
						</strong>
					</div>
					<div className="stat-card danger">
						<span>负债</span>
						<strong title={getDashboardSummaryTitle(-dashboard.liabilities_value_cny)}>
							{formatDashboardSummaryValue(-dashboard.liabilities_value_cny)}
						</strong>
					</div>
				</div>
			</header>

			{feedbackNoticeMessage ? (
				<div className="banner info">
					<p>{feedbackNoticeMessage}</p>
				</div>
			) : null}

			{emailNoticeMessage ? (
				<div className="banner info">
					<p>{emailNoticeMessage}</p>
				</div>
			) : null}

			{errorMessage ? <div className="banner error">{errorMessage}</div> : null}

			{dashboard.warnings.length > 0 ? (
				<div className="banner warning">
					{dashboard.warnings.map((warning) => (
						<p key={warning}>{warning}</p>
					))}
				</div>
			) : null}

			{!hasAnyAsset && !isDashboardBusy && !errorMessage && !isRecoveringSession ? (
				<div className="banner info">暂无资产数据。</div>
			) : null}

			<section className="panel workspace-shell" aria-label="页面视图切换">
				<div className="workspace-switch" role="tablist" aria-label="页面视图">
					<button
						type="button"
						role="tab"
						aria-selected={activeWorkspaceView === "manage"}
						className={`workspace-switch__button ${
							activeWorkspaceView === "manage" ? "is-active" : ""
						}`}
						onClick={() => setActiveWorkspaceView("manage")}
					>
						管理
					</button>
					<button
						type="button"
						role="tab"
						aria-selected={activeWorkspaceView === "insights"}
						className={`workspace-switch__button ${
							activeWorkspaceView === "insights" ? "is-active" : ""
						}`}
						onClick={() => setActiveWorkspaceView("insights")}
					>
						洞察
					</button>
					<button
						type="button"
						role="tab"
						aria-selected={activeWorkspaceView === "agent"}
						className={`workspace-switch__button ${
							activeWorkspaceView === "agent" ? "is-active" : ""
						}`}
						onClick={() => setActiveWorkspaceView("agent")}
					>
						智能体
					</button>
				</div>
			</section>

			{mountedWorkspaceViews.insights ? (
				<section
					className="panel section-shell"
					hidden={activeWorkspaceView !== "insights"}
					aria-hidden={activeWorkspaceView !== "insights"}
				>
					<div className="section-head">
						<div>
							<p className="eyebrow">ANALYTICS</p>
							<h2>变化与分布</h2>
							<p className="section-copy">走势与结构。</p>
						</div>
					</div>

					<Suspense fallback={<div className="banner info">正在加载洞察模块...</div>}>
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
							loading={isLoadingDashboard || isRecoveringSession}
						/>
					</Suspense>
				</section>
			) : null}
			{mountedWorkspaceViews.agent ? (
				<section
					className="panel section-shell"
					hidden={activeWorkspaceView !== "agent"}
					aria-hidden={activeWorkspaceView !== "agent"}
				>
					<div className="section-head">
						<div>
							<p className="eyebrow">AGENT</p>
							<h2>任务与审计</h2>
							<p className="section-copy">查看智能体执行结果与真实落库变更。</p>
						</div>
					</div>

					<AgentExecutionAuditPanel
						registrations={agentRegistrations}
						tasks={agentTasks}
						records={agentRecords}
						apiDocUrl="https://github.com/RockYYY888/finance--tracker/blob/main/docs/agent-api.md"
						loading={isLoadingAgentAudit}
						errorMessage={agentAuditErrorMessage}
					/>
				</section>
			) : null}
			<div
				className="integrated-stack"
				hidden={activeWorkspaceView !== "manage"}
				aria-hidden={activeWorkspaceView !== "manage"}
			>
				<AssetManager
					initialCashAccounts={
						assetManagerSeeds?.cashAccounts
					}
					initialHoldings={
						assetManagerSeeds?.holdings
					}
					initialFixedAssets={
						assetManagerSeeds?.fixedAssets
					}
					initialLiabilities={
						assetManagerSeeds?.liabilities
					}
					initialOtherAssets={
						assetManagerSeeds?.otherAssets
					}
					cashActions={assetManagerController.cashAccounts}
					cashTransferActions={assetManagerController.cashTransfers}
					holdingActions={assetManagerController.holdings}
					holdingTransactionActions={assetManagerController.holdingTransactions}
					fixedAssetActions={assetManagerController.fixedAssets}
					liabilityActions={assetManagerController.liabilities}
					otherAssetActions={assetManagerController.otherAssets}
					title="资产管理"
					description="自动同步。"
					loadOnMount
					displayFxRates={{
						CNY: 1,
						USD: dashboard.usd_cny_rate,
						HKD: dashboard.hkd_cny_rate,
					}}
					onRecordsCommitted={() => {
						requestDashboardRefresh();
						setAssetRecordRefreshToken((currentValue) => currentValue + 1);
					}}
				/>
			</div>

			<FeedbackDialog
				open={isFeedbackOpen}
				busy={isSubmittingFeedback}
				errorMessage={feedbackErrorMessage}
				onClose={closeFeedbackDialog}
				onSubmit={handleSubmitFeedback}
			/>
			<AdminFeedbackDialog
				open={isAdminInboxOpen}
				busy={isLoadingAdminInbox}
				viewerUserId={currentUserId ?? "anonymous"}
				userItems={adminUserFeedbackItems}
				systemItems={adminSystemFeedbackItems}
				errorMessage={adminInboxErrorMessage}
				onClose={closeAdminInbox}
				onHideItem={handleHideAdminFeedbackItem}
				onCloseItem={handleCloseFeedbackItem}
				onReplyItem={handleReplyFeedbackItem}
			/>
			<AdminReleaseNotesDialog
				open={isAdminReleaseNotesOpen}
				busy={isLoadingAdminReleaseNotes}
				releaseNotes={adminReleaseNotes}
				errorMessage={adminReleaseNotesErrorMessage}
				onClose={closeAdminReleaseNotes}
				onCreateReleaseNote={handleCreateReleaseNote}
				onPublishReleaseNote={handlePublishReleaseNote}
			/>
			<UserFeedbackInboxDialog
				open={isUserInboxOpen}
				busy={isLoadingUserInbox}
				viewerUserId={currentUserId ?? "anonymous"}
				items={userFeedbackItems}
				releaseNotes={userReleaseNotes}
				errorMessage={userInboxErrorMessage}
				onClose={closeUserInbox}
				onHideFeedbackItem={handleHideUserFeedbackItem}
				onHideReleaseNote={handleHideUserReleaseNote}
			/>
			<EmailDialog
				open={isEmailDialogOpen}
				busy={isSubmittingEmail}
				initialEmail={currentUserEmail}
				errorMessage={emailDialogErrorMessage}
				onClose={closeEmailDialog}
				onSubmit={(email) => handleSubmitEmail({ email })}
			/>
			<AssetRecordsDialog
				key={assetRecordsDialogVersion}
				open={isAssetRecordsOpen}
				onClose={closeAssetRecordsDialog}
				onLoadRecords={defaultAssetApiClient.listAssetRecords}
				refreshToken={assetRecordRefreshToken}
			/>
		</div>
	);
}

export default App;
