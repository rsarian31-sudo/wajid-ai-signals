export interface AuthSession { accessToken: string; userId: string; }
export interface AuthProvider { getSession(): Promise<AuthSession | null>; signOut(): Promise<void>; }
