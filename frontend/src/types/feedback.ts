export type FeedbackCategory =
	| "USER_REQUEST"
	| "SYSTEM_ALERT"
	| "SYSTEM_HEARTBEAT"
	| "SYSTEM_TASK";

export type FeedbackPriority = "LOW" | "MEDIUM" | "HIGH";

export type FeedbackSource = "USER" | "SYSTEM" | "API_MONITOR" | "TRADING_AGENT" | "ADMIN";

export type FeedbackStatus = "OPEN" | "ACKED" | "IN_PROGRESS" | "SILENCED" | "RESOLVED";

export interface UserFeedbackInput {
	message: string;
	category?: FeedbackCategory;
	priority?: FeedbackPriority;
	source?: FeedbackSource;
	fingerprint?: string;
	dedupe_window_minutes?: number;
}

export interface UserFeedbackRecord {
	id: number;
	user_id: string;
	message: string;
	category: FeedbackCategory;
	priority: FeedbackPriority;
	source: FeedbackSource;
	status: FeedbackStatus;
	is_system: boolean;
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

export interface AdminFeedbackClassifyInput {
	category?: FeedbackCategory;
	priority?: FeedbackPriority;
	source?: FeedbackSource;
	status?: FeedbackStatus;
	assignee?: string | null;
	ack_deadline?: string | null;
	internal_note?: string | null;
}

export interface AdminFeedbackAcknowledgeInput {
	assignee?: string | null;
	ack_deadline?: string | null;
	internal_note?: string | null;
}

export interface AdminFeedbackRecord extends UserFeedbackRecord {
	assignee: string | null;
	acknowledged_at: string | null;
	acknowledged_by: string | null;
	ack_deadline: string | null;
	internal_note: string | null;
	internal_note_updated_at: string | null;
	internal_note_updated_by: string | null;
	fingerprint: string | null;
	dedupe_window_minutes: number | null;
	occurrence_count: number;
	last_seen_at: string | null;
}

export interface AdminFeedbackListResponse {
	items: AdminFeedbackRecord[];
	total: number;
	page: number;
	page_size: number;
	has_more: boolean;
}

export type InboxMessageKind = "FEEDBACK" | "RELEASE_NOTE";

export interface InboxMessageHideInput {
	message_kind: InboxMessageKind;
	message_id: number;
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
