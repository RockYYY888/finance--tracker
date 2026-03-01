import { useEffect, useRef, useState } from "react";

import { AdminFeedbackDialog } from "./components/feedback/AdminFeedbackDialog";
import { EmailDialog } from "./components/auth/EmailDialog";
import { LoginScreen } from "./components/auth/LoginScreen";
import { AssetManager } from "./components/assets";
import { PortfolioAnalytics } from "./components/analytics";
import { FeedbackDialog } from "./components/feedback/FeedbackDialog";
import { UserFeedbackInboxDialog } from "./components/feedback/UserFeedbackInboxDialog";
import { defaultAssetApiClient } from "./lib/assetApi";
import {
	getAuthSession,
	loginWithPassword,
	logoutCurrentUser,
	registerWithPassword,
	resetPasswordWithEmail,
	updateCurrentUserEmail,
} from "./lib/authApi";
import { getDashboard } from "./lib/dashboardApi";
import {
	closeFeedbackForAdmin,
	getFeedbackSummary,
	listFeedbackForCurrentUser,
	listFeedbackForAdmin,
	markFeedbackSeenForCurrentUser,
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
	AssetManagerController,
	CashAccountRecord,
	FixedAssetRecord,
	HoldingRecord,
	LiabilityCurrency,
	LiabilityRecord,
	OtherAssetRecord,
} from "./types/assets";
import { EMPTY_DASHBOARD, type DashboardResponse } from "./types/dashboard";
import type { UserFeedbackRecord } from "./types/feedback";
import { formatCny } from "./utils/portfolioAnalytics";

type AuthStatus = "checking" | "anonymous" | "authenticated";
type WorkspaceView = "records" | "insights";
const SESSION_CHECK_TIMEOUT_MS = 3000;
const AUTH_SUBMISSION_TIMEOUT_MS = 10000;
const REMEMBERED_SESSION_USER_KEY = "asset-tracker-last-session-user";

function readRememberedSessionUserId(): string | null {
	if (typeof window === "undefined") {
		return null;
	}

	try {
		const rememberedUserId = window.sessionStorage.getItem(REMEMBERED_SESSION_USER_KEY);
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
	} catch {
		// Ignore storage access issues and fall back to the normal session check.
	}
}

function clearRememberedSessionUserId(): void {
	try {
		window.sessionStorage.removeItem(REMEMBERED_SESSION_USER_KEY);
	} catch {
		// Ignore storage access issues and fall back to the normal session check.
	}
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

function roundCnyValue(value: number): number {
	return Number(value.toFixed(2));
}

function upsertRecordById<T extends { id: number }>(records: T[], nextRecord: T): T[] {
	const existingIndex = records.findIndex((record) => record.id === nextRecord.id);
	if (existingIndex === -1) {
		return [nextRecord, ...records];
	}

	return records.map((record) => (record.id === nextRecord.id ? nextRecord : record));
}

function removeRecordById<T extends { id: number }>(records: T[], recordId: number): T[] {
	return records.filter((record) => record.id !== recordId);
}

function sumValuedRecords<T extends { value_cny?: number | null }>(records: T[]): number {
	return roundCnyValue(
		records.reduce((total, record) => total + (record.value_cny ?? 0), 0),
	);
}

function rebuildAllocation(
	cashValueCny: number,
	holdingsValueCny: number,
	fixedAssetsValueCny: number,
	otherAssetsValueCny: number,
): DashboardResponse["allocation"] {
	const slices: DashboardResponse["allocation"] = [];

	if (cashValueCny > 0) {
		slices.push({ label: "现金", value: cashValueCny });
	}
	if (holdingsValueCny > 0) {
		slices.push({ label: "投资类", value: holdingsValueCny });
	}
	if (fixedAssetsValueCny > 0) {
		slices.push({ label: "固定资产", value: fixedAssetsValueCny });
	}
	if (otherAssetsValueCny > 0) {
		slices.push({ label: "其他", value: otherAssetsValueCny });
	}

	return slices;
}

function finalizeDashboardState(nextDashboard: DashboardResponse): DashboardResponse {
	const cashValueCny = sumValuedRecords(nextDashboard.cash_accounts);
	const holdingsValueCny = sumValuedRecords(nextDashboard.holdings);
	const fixedAssetsValueCny = sumValuedRecords(nextDashboard.fixed_assets);
	const liabilitiesValueCny = sumValuedRecords(nextDashboard.liabilities);
	const otherAssetsValueCny = sumValuedRecords(nextDashboard.other_assets);
	const totalValueCny = roundCnyValue(
		cashValueCny +
		holdingsValueCny +
		fixedAssetsValueCny +
		otherAssetsValueCny -
		liabilitiesValueCny,
	);

	return {
		...nextDashboard,
		total_value_cny: totalValueCny,
		cash_value_cny: cashValueCny,
		holdings_value_cny: holdingsValueCny,
		fixed_assets_value_cny: fixedAssetsValueCny,
		liabilities_value_cny: liabilitiesValueCny,
		other_assets_value_cny: otherAssetsValueCny,
		allocation: rebuildAllocation(
			cashValueCny,
			holdingsValueCny,
			fixedAssetsValueCny,
			otherAssetsValueCny,
		),
	};
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

function toDashboardCashAccount(
	record: CashAccountRecord,
): DashboardResponse["cash_accounts"][number] {
	return {
		...record,
		started_on: record.started_on ?? null,
		note: record.note ?? null,
		fx_to_cny: record.fx_to_cny ?? 0,
		value_cny: record.value_cny ?? 0,
	};
}

function toDashboardHolding(
	record: HoldingRecord,
): DashboardResponse["holdings"][number] {
	return {
		...record,
		cost_basis_price: record.cost_basis_price ?? null,
		broker: record.broker ?? null,
		started_on: record.started_on ?? null,
		note: record.note ?? null,
		price: record.price ?? 0,
		price_currency: record.price_currency ?? record.fallback_currency,
		fx_to_cny: 0,
		value_cny: record.value_cny ?? 0,
		return_pct: record.return_pct ?? null,
		last_updated: record.last_updated ?? null,
	};
}

function toDashboardFixedAsset(
	record: FixedAssetRecord,
): DashboardResponse["fixed_assets"][number] {
	return {
		...record,
		purchase_value_cny: record.purchase_value_cny ?? null,
		started_on: record.started_on ?? null,
		note: record.note ?? null,
		return_pct: record.return_pct ?? null,
	};
}

function toDashboardLiability(
	record: LiabilityRecord,
): DashboardResponse["liabilities"][number] {
	return {
		...record,
		started_on: record.started_on ?? null,
		note: record.note ?? null,
		fx_to_cny: record.fx_to_cny ?? 0,
		value_cny: record.value_cny ?? 0,
	};
}

function toDashboardOtherAsset(
	record: OtherAssetRecord,
): DashboardResponse["other_assets"][number] {
	return {
		...record,
		original_value_cny: record.original_value_cny ?? null,
		started_on: record.started_on ?? null,
		note: record.note ?? null,
		return_pct: record.return_pct ?? null,
	};
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
	const [dashboard, setDashboard] = useState<DashboardResponse>(EMPTY_DASHBOARD);
	const [isLoadingDashboard, setIsLoadingDashboard] = useState(false);
	const [isRefreshingDashboard, setIsRefreshingDashboard] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
	const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
	const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
	const [feedbackErrorMessage, setFeedbackErrorMessage] = useState<string | null>(null);
	const [feedbackNoticeMessage, setFeedbackNoticeMessage] = useState<string | null>(null);
	const [feedbackInboxCount, setFeedbackInboxCount] = useState(0);
	const [activeWorkspaceView, setActiveWorkspaceView] = useState<WorkspaceView>("records");
	const [isAdminInboxOpen, setIsAdminInboxOpen] = useState(false);
	const [isUserInboxOpen, setIsUserInboxOpen] = useState(false);
	const [isLoadingAdminInbox, setIsLoadingAdminInbox] = useState(false);
	const [adminInboxErrorMessage, setAdminInboxErrorMessage] = useState<string | null>(null);
	const [adminFeedbackItems, setAdminFeedbackItems] = useState<UserFeedbackRecord[]>([]);
	const [isLoadingUserInbox, setIsLoadingUserInbox] = useState(false);
	const [userInboxErrorMessage, setUserInboxErrorMessage] = useState<string | null>(null);
	const [userFeedbackItems, setUserFeedbackItems] = useState<UserFeedbackRecord[]>([]);
	const [isEmailDialogOpen, setIsEmailDialogOpen] = useState(false);
	const [isSubmittingEmail, setIsSubmittingEmail] = useState(false);
	const [emailDialogErrorMessage, setEmailDialogErrorMessage] = useState<string | null>(null);
	const [emailNoticeMessage, setEmailNoticeMessage] = useState<string | null>(null);
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

	function markSignedInWithProfile(userId: string, email: string | null): void {
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
		setActiveWorkspaceView("records");
		setAdminInboxErrorMessage(null);
		setIsAdminInboxOpen(false);
		setAdminFeedbackItems([]);
		setUserInboxErrorMessage(null);
		setIsUserInboxOpen(false);
		setUserFeedbackItems([]);
		setEmailNoticeMessage(null);
		setEmailDialogErrorMessage(null);
		setIsEmailDialogOpen(false);
		setDashboard(EMPTY_DASHBOARD);
		setIsLoadingDashboard(true);
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
		setActiveWorkspaceView("records");
		setAdminInboxErrorMessage(null);
		setIsAdminInboxOpen(false);
		setAdminFeedbackItems([]);
		setUserInboxErrorMessage(null);
		setIsUserInboxOpen(false);
		setUserFeedbackItems([]);
		setEmailNoticeMessage(null);
		setEmailDialogErrorMessage(null);
		setIsEmailDialogOpen(false);
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
		void refreshFeedbackSummary();
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
			const items = await listFeedbackForAdmin();
			setAdminFeedbackItems(items);
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

	async function openUserInbox(): Promise<void> {
		if (authStatus !== "authenticated") {
			return;
		}

		setUserInboxErrorMessage(null);
		setIsUserInboxOpen(true);
		setIsLoadingUserInbox(true);

		try {
			const items = await listFeedbackForCurrentUser();
			setUserFeedbackItems(items);
			await markFeedbackSeenForCurrentUser();
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
			setAdminFeedbackItems((currentItems) =>
				currentItems.map((item) => (item.id === updatedItem.id ? updatedItem : item)),
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
			setAdminFeedbackItems((currentItems) =>
				currentItems.map((item) => (item.id === updatedItem.id ? updatedItem : item)),
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

	function patchDashboard(
		mutator: (currentDashboard: DashboardResponse) => DashboardResponse,
	): void {
		setDashboard((currentDashboard) => finalizeDashboardState(mutator(currentDashboard)));
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
	const cashAccountRecords = dashboard.cash_accounts.map(toCashAccountRecord);
	const holdingRecords = dashboard.holdings.map(toHoldingRecord);
	const fixedAssetRecords = dashboard.fixed_assets.map(toFixedAssetRecord);
	const liabilityRecords = dashboard.liabilities.map(toLiabilityRecord);
	const otherAssetRecords = dashboard.other_assets.map(toOtherAssetRecord);

	const assetManagerController: AssetManagerController = {
		cashAccounts: {
			onCreate: async (payload) => {
				const createdRecord = await defaultAssetApiClient.createCashAccount(payload);
				patchDashboard((currentDashboard) => ({
					...currentDashboard,
					cash_accounts: upsertRecordById(
						currentDashboard.cash_accounts,
						toDashboardCashAccount(createdRecord),
					),
				}));
				void loadDashboard();
				return createdRecord;
			},
			onEdit: async (recordId, payload) => {
				const updatedRecord = await defaultAssetApiClient.updateCashAccount(recordId, payload);
				patchDashboard((currentDashboard) => ({
					...currentDashboard,
					cash_accounts: upsertRecordById(
						currentDashboard.cash_accounts,
						toDashboardCashAccount(updatedRecord),
					),
				}));
				void loadDashboard();
				return updatedRecord;
			},
			onDelete: async (recordId) => {
				await defaultAssetApiClient.deleteCashAccount(recordId);
				patchDashboard((currentDashboard) => ({
					...currentDashboard,
					cash_accounts: removeRecordById(currentDashboard.cash_accounts, recordId),
				}));
				void loadDashboard();
			},
		},
		holdings: {
			onCreate: async (payload) => {
				const createdRecord = await defaultAssetApiClient.createHolding(payload);
				patchDashboard((currentDashboard) => ({
					...currentDashboard,
					holdings: upsertRecordById(
						currentDashboard.holdings,
						toDashboardHolding(createdRecord),
					),
				}));
				void loadDashboard();
				return createdRecord;
			},
			onEdit: async (recordId, payload) => {
				const updatedRecord = await defaultAssetApiClient.updateHolding(recordId, payload);
				patchDashboard((currentDashboard) => ({
					...currentDashboard,
					holdings: upsertRecordById(
						currentDashboard.holdings,
						toDashboardHolding(updatedRecord),
					),
				}));
				void loadDashboard();
				return updatedRecord;
			},
			onDelete: async (recordId) => {
				await defaultAssetApiClient.deleteHolding(recordId);
				patchDashboard((currentDashboard) => ({
					...currentDashboard,
					holdings: removeRecordById(currentDashboard.holdings, recordId),
				}));
				void loadDashboard();
			},
			onMergeDuplicate: async ({ targetRecordId, sourceRecordId, mergedPayload }) => {
				const updatedRecord = await defaultAssetApiClient.updateHolding(
					targetRecordId,
					mergedPayload,
				);

				if (sourceRecordId != null && sourceRecordId !== targetRecordId) {
					await defaultAssetApiClient.deleteHolding(sourceRecordId);
				}

				patchDashboard((currentDashboard) => {
					let nextHoldings = currentDashboard.holdings;

					if (sourceRecordId != null && sourceRecordId !== targetRecordId) {
						nextHoldings = removeRecordById(nextHoldings, sourceRecordId);
					}

					nextHoldings = upsertRecordById(
						nextHoldings,
						toDashboardHolding(updatedRecord),
					);

					return {
						...currentDashboard,
						holdings: nextHoldings,
					};
				});
				void loadDashboard();
				return updatedRecord;
			},
			onSearch: (query) => defaultAssetApiClient.searchSecurities(query),
		},
		fixedAssets: {
			onCreate: async (payload) => {
				const createdRecord = await defaultAssetApiClient.createFixedAsset(payload);
				patchDashboard((currentDashboard) => ({
					...currentDashboard,
					fixed_assets: upsertRecordById(
						currentDashboard.fixed_assets,
						toDashboardFixedAsset(createdRecord),
					),
				}));
				void loadDashboard();
				return createdRecord;
			},
			onEdit: async (recordId, payload) => {
				const updatedRecord = await defaultAssetApiClient.updateFixedAsset(recordId, payload);
				patchDashboard((currentDashboard) => ({
					...currentDashboard,
					fixed_assets: upsertRecordById(
						currentDashboard.fixed_assets,
						toDashboardFixedAsset(updatedRecord),
					),
				}));
				void loadDashboard();
				return updatedRecord;
			},
			onDelete: async (recordId) => {
				await defaultAssetApiClient.deleteFixedAsset(recordId);
				patchDashboard((currentDashboard) => ({
					...currentDashboard,
					fixed_assets: removeRecordById(currentDashboard.fixed_assets, recordId),
				}));
				void loadDashboard();
			},
		},
		liabilities: {
			onCreate: async (payload) => {
				const createdRecord = await defaultAssetApiClient.createLiability(payload);
				patchDashboard((currentDashboard) => ({
					...currentDashboard,
					liabilities: upsertRecordById(
						currentDashboard.liabilities,
						toDashboardLiability(createdRecord),
					),
				}));
				void loadDashboard();
				return createdRecord;
			},
			onEdit: async (recordId, payload) => {
				const updatedRecord = await defaultAssetApiClient.updateLiability(recordId, payload);
				patchDashboard((currentDashboard) => ({
					...currentDashboard,
					liabilities: upsertRecordById(
						currentDashboard.liabilities,
						toDashboardLiability(updatedRecord),
					),
				}));
				void loadDashboard();
				return updatedRecord;
			},
			onDelete: async (recordId) => {
				await defaultAssetApiClient.deleteLiability(recordId);
				patchDashboard((currentDashboard) => ({
					...currentDashboard,
					liabilities: removeRecordById(currentDashboard.liabilities, recordId),
				}));
				void loadDashboard();
			},
		},
		otherAssets: {
			onCreate: async (payload) => {
				const createdRecord = await defaultAssetApiClient.createOtherAsset(payload);
				patchDashboard((currentDashboard) => ({
					...currentDashboard,
					other_assets: upsertRecordById(
						currentDashboard.other_assets,
						toDashboardOtherAsset(createdRecord),
					),
				}));
				void loadDashboard();
				return createdRecord;
			},
			onEdit: async (recordId, payload) => {
				const updatedRecord = await defaultAssetApiClient.updateOtherAsset(recordId, payload);
				patchDashboard((currentDashboard) => ({
					...currentDashboard,
					other_assets: upsertRecordById(
						currentDashboard.other_assets,
						toDashboardOtherAsset(updatedRecord),
					),
				}));
				void loadDashboard();
				return updatedRecord;
			},
			onDelete: async (recordId) => {
				await defaultAssetApiClient.deleteOtherAsset(recordId);
				patchDashboard((currentDashboard) => ({
					...currentDashboard,
					other_assets: removeRecordById(currentDashboard.other_assets, recordId),
				}));
				void loadDashboard();
			},
		},
	};

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
					<p className="eyebrow">CNY CONTROL PANEL</p>
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
						aria-selected={activeWorkspaceView === "records"}
						className={`workspace-switch__button ${
							activeWorkspaceView === "records" ? "is-active" : ""
						}`}
						onClick={() => setActiveWorkspaceView("records")}
					>
						记录
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
				</div>
			</section>

			{activeWorkspaceView === "insights" ? (
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
						loading={isLoadingDashboard || isRecoveringSession}
					/>
				</section>
			) : (
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
			)}

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
				items={adminFeedbackItems}
				errorMessage={adminInboxErrorMessage}
				onClose={closeAdminInbox}
				onCloseItem={handleCloseFeedbackItem}
				onReplyItem={handleReplyFeedbackItem}
			/>
			<UserFeedbackInboxDialog
				open={isUserInboxOpen}
				busy={isLoadingUserInbox}
				items={userFeedbackItems}
				errorMessage={userInboxErrorMessage}
				onClose={closeUserInbox}
			/>
			<EmailDialog
				open={isEmailDialogOpen}
				busy={isSubmittingEmail}
				initialEmail={currentUserEmail}
				errorMessage={emailDialogErrorMessage}
				onClose={closeEmailDialog}
				onSubmit={(email) => handleSubmitEmail({ email })}
			/>
		</div>
	);
}

export default App;
