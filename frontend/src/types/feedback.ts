export interface UserFeedbackInput {
	message: string;
}

export interface UserFeedbackRecord {
	id: number;
	message: string;
	created_at: string;
}
