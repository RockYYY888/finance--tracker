import { createApiClient } from "./apiClient";
import type {
	AdminFeedbackAcknowledgeInput,
	AdminFeedbackClassifyInput,
	AdminFeedbackListResponse,
	AdminFeedbackRecord,
	AdminFeedbackReplyInput,
	FeedbackSummary,
	InboxMessageHideInput,
	ReleaseNoteDeliveryRecord,
	ReleaseNoteInput,
	ReleaseNoteRecord,
	UserFeedbackInput,
	UserFeedbackRecord,
} from "../types/feedback";

const feedbackApiClient = createApiClient();

export async function submitUserFeedback(
	payload: UserFeedbackInput,
): Promise<UserFeedbackRecord> {
	return feedbackApiClient.request<UserFeedbackRecord>("/api/feedback", {
		method: "POST",
		body: JSON.stringify(payload),
	});
}

export async function listFeedbackForCurrentUser(): Promise<UserFeedbackRecord[]> {
	return feedbackApiClient.request<UserFeedbackRecord[]>("/api/feedback");
}

export async function getFeedbackSummary(): Promise<FeedbackSummary> {
	return feedbackApiClient.request<FeedbackSummary>("/api/feedback/summary");
}

export async function markFeedbackSeenForCurrentUser(): Promise<void> {
	return feedbackApiClient.request<void>("/api/feedback/mark-seen", {
		method: "POST",
	});
}

export async function listFeedbackForAdmin(): Promise<UserFeedbackRecord[]> {
	return feedbackApiClient.request<UserFeedbackRecord[]>("/api/admin/feedback");
}

function buildAdminFeedbackListPath(scope: "user" | "system"): string {
	return `/api/admin/feedback/${scope}?page=1&page_size=200`;
}

export async function listUserFeedbackForAdmin(): Promise<AdminFeedbackListResponse> {
	return feedbackApiClient.request<AdminFeedbackListResponse>(
		buildAdminFeedbackListPath("user"),
	);
}

export async function listSystemFeedbackForAdmin(): Promise<AdminFeedbackListResponse> {
	return feedbackApiClient.request<AdminFeedbackListResponse>(
		buildAdminFeedbackListPath("system"),
	);
}

export async function replyToFeedbackForAdmin(
	feedbackId: number,
	payload: AdminFeedbackReplyInput,
): Promise<AdminFeedbackRecord> {
	return feedbackApiClient.request<AdminFeedbackRecord>(`/api/admin/feedback/${feedbackId}/reply`, {
		method: "POST",
		body: JSON.stringify(payload),
	});
}

export async function closeFeedbackForAdmin(feedbackId: number): Promise<AdminFeedbackRecord> {
	return feedbackApiClient.request<AdminFeedbackRecord>(
		`/api/admin/feedback/${feedbackId}/close`,
		{
			method: "POST",
		},
	);
}

export async function acknowledgeFeedbackForAdmin(
	feedbackId: number,
	payload: AdminFeedbackAcknowledgeInput,
): Promise<AdminFeedbackRecord> {
	return feedbackApiClient.request<AdminFeedbackRecord>(
		`/api/admin/feedback/${feedbackId}/ack`,
		{
			method: "POST",
			body: JSON.stringify(payload),
		},
	);
}

export async function classifyFeedbackForAdmin(
	feedbackId: number,
	payload: AdminFeedbackClassifyInput,
): Promise<AdminFeedbackRecord> {
	return feedbackApiClient.request<AdminFeedbackRecord>(
		`/api/admin/feedback/${feedbackId}/classify`,
		{
			method: "POST",
			body: JSON.stringify(payload),
		},
	);
}

export async function hideInboxMessageForCurrentUser(
	payload: InboxMessageHideInput,
): Promise<void> {
	return feedbackApiClient.request<void>("/api/messages/hide", {
		method: "POST",
		body: JSON.stringify(payload),
	});
}

export async function listReleaseNotesForCurrentUser(): Promise<ReleaseNoteDeliveryRecord[]> {
	return feedbackApiClient.request<ReleaseNoteDeliveryRecord[]>("/api/release-notes");
}

export async function markReleaseNotesSeenForCurrentUser(): Promise<void> {
	return feedbackApiClient.request<void>("/api/release-notes/mark-seen", {
		method: "POST",
	});
}

export async function listReleaseNotesForAdmin(): Promise<ReleaseNoteRecord[]> {
	return feedbackApiClient.request<ReleaseNoteRecord[]>("/api/admin/release-notes");
}

export async function createReleaseNoteForAdmin(
	payload: ReleaseNoteInput,
): Promise<ReleaseNoteRecord> {
	return feedbackApiClient.request<ReleaseNoteRecord>("/api/admin/release-notes", {
		method: "POST",
		body: JSON.stringify(payload),
	});
}

export async function publishReleaseNoteForAdmin(
	releaseNoteId: number,
): Promise<ReleaseNoteRecord> {
	return feedbackApiClient.request<ReleaseNoteRecord>(
		`/api/admin/release-notes/${releaseNoteId}/publish`,
		{
			method: "POST",
		},
	);
}
