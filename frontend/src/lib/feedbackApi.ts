import { createApiClient } from "./apiClient";
import type { UserFeedbackInput, UserFeedbackRecord } from "../types/feedback";

const feedbackApiClient = createApiClient();

export async function submitUserFeedback(
	payload: UserFeedbackInput,
): Promise<UserFeedbackRecord> {
	return feedbackApiClient.request<UserFeedbackRecord>("/api/feedback", {
		method: "POST",
		body: JSON.stringify(payload),
	});
}

export async function listFeedbackForAdmin(): Promise<UserFeedbackRecord[]> {
	return feedbackApiClient.request<UserFeedbackRecord[]>("/api/admin/feedback");
}

export async function closeFeedbackForAdmin(feedbackId: number): Promise<UserFeedbackRecord> {
	return feedbackApiClient.request<UserFeedbackRecord>(`/api/admin/feedback/${feedbackId}/close`, {
		method: "POST",
	});
}
