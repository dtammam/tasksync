export interface AuthLoginRequest {
	email: string;
	password: string;
	space_id?: string;
}

export interface AuthUser {
	user_id: string;
	email: string;
	display: string;
	space_id: string;
	role: 'admin' | 'contributor';
}

export interface AuthLoginResponse extends AuthUser {
	token: string;
}
