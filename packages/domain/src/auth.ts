export interface AuthSessionDto {
  readonly authenticationRequired: boolean;
  readonly authenticated: boolean;
  readonly username: string | null;
  readonly expiresAt: string | null;
}

export interface LoginRequest {
  readonly username: string;
  readonly password: string;
}

export interface LoginResponse {
  readonly session: AuthSessionDto;
}
