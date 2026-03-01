export type AuthSession = {
	user_id: string;
};

export type AuthLoginCredentials = {
	user_id: string;
	password: string;
};

export type AuthRegisterCredentials = {
	user_id: string;
	email: string;
	password: string;
};

export type PasswordResetPayload = {
	user_id: string;
	email: string;
	new_password: string;
};

export type ActionMessage = {
	message: string;
};
