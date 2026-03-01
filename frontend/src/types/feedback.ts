export interface UserFeedbackInput {
	message: string;
}

export interface UserFeedbackRecord {
	id: number;
	user_id: string;
	message: string;
	reply_message: string | null;
	replied_at: string | null;
	replied_by: string | null;
	resolved_at: string | null;
	closed_by: string | null;
	created_at: string;
}

export interface AdminFeedbackReplyInput {
	reply_message: string;
	close: boolean;
}

export interface FeedbackSummary {
	inbox_count: number;
	mode: string;
}
