export interface UserFeedbackInput {
	message: string;
}

export interface UserFeedbackRecord {
	id: number;
	user_id: string;
	message: string;
	resolved_at: string | null;
	closed_by: string | null;
	created_at: string;
}
