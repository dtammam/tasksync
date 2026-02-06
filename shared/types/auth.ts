export interface AuthLoginRequest {
	email: string;
	password: string;
	space_id?: string;
}

export interface AuthUser {
	user_id: string;
	email: string;
	display: string;
	avatar_icon?: string;
	space_id: string;
	role: 'admin' | 'contributor';
}

export interface AuthLoginResponse extends AuthUser {
	token: string;
}

export interface SpaceMember extends AuthUser {}

export interface AuthUpdateProfileRequest {
	display?: string;
	avatar_icon?: string;
}

export interface AuthCreateMemberRequest {
	email: string;
	display: string;
	role: 'admin' | 'contributor';
	avatar_icon?: string;
}

export interface ListGrant {
	user_id: string;
	list_id: string;
}

export interface SetListGrantRequest {
	user_id: string;
	list_id: string;
	granted: boolean;
}
