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
	reply_seen_at: string | null;
	resolved_at: string | null;
	closed_by: string | null;
	created_at: string;
}

export interface AdminFeedbackReplyInput {
	reply_message: string;
	close: boolean;
}

export interface ReleaseNoteInput {
	version: string;
	title: string;
	content: string;
	source_feedback_ids: number[];
}

export interface ReleaseNoteRecord {
	id: number;
	version: string;
	title: string;
	content: string;
	source_feedback_ids: number[];
	created_by: string;
	created_at: string;
	published_at: string | null;
	delivery_count: number;
}

export interface ReleaseNoteDeliveryRecord {
	delivery_id: number;
	release_note_id: number;
	version: string;
	title: string;
	content: string;
	source_feedback_ids: number[];
	delivered_at: string;
	seen_at: string | null;
	published_at: string;
}

export interface FeedbackSummary {
	inbox_count: number;
	mode: string;
}
