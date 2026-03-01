import { createApiClient } from "./apiClient";
import type {
	AdminFeedbackReplyInput,
	FeedbackSummary,
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

export async function listFeedbackForAdmin(): Promise<UserFeedbackRecord[]> {
	return feedbackApiClient.request<UserFeedbackRecord[]>("/api/admin/feedback");
}

export async function replyToFeedbackForAdmin(
	feedbackId: number,
	payload: AdminFeedbackReplyInput,
): Promise<UserFeedbackRecord> {
	return feedbackApiClient.request<UserFeedbackRecord>(`/api/admin/feedback/${feedbackId}/reply`, {
		method: "POST",
		body: JSON.stringify(payload),
	});
}

export async function closeFeedbackForAdmin(feedbackId: number): Promise<UserFeedbackRecord> {
	return feedbackApiClient.request<UserFeedbackRecord>(
		`/api/admin/feedback/${feedbackId}/close`,
		{
			method: "POST",
		},
	);
}
