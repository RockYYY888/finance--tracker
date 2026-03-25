export type AuthSession = {
	user_id: string;
	email: string | null;
};

export type ApiKeyAuthCredentials = {
	api_key: string;
};

export type ActionMessage = {
	message: string;
};

export type UserEmailUpdate = {
	email: string;
};
