import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ApiError,
  api,
  loadStoredSession,
  onUnauthorized,
  setActiveOrganization,
  setSession,
} from '@/lib/api';
import type {
  OrganizationOut,
  Role,
  SessionContext,
  TokenResponse,
  UserOut,
} from '@/types/api';

/**
 * Client-side session state.
 *
 * The permissions in this context exist so the UI can *hide* actions a user
 * cannot perform. They are not a security boundary: every endpoint re-checks the
 * caller's role and organization membership on the server, so a hand-crafted
 * request that skips a hidden button still fails.
 */

const ROLE_RANK: Record<Role, number> = {
  admin: 4,
  risk_manager: 3,
  analyst: 2,
  viewer: 1,
};

export interface AuthState {
  status: 'loading' | 'authenticated' | 'anonymous';
  user: UserOut | null;
  organizations: OrganizationOut[];
  activeOrganization: OrganizationOut | null;
  role: Role | null;
  permissions: string[];
}

interface AuthContextValue extends AuthState {
  isAuthenticated: boolean;
  can: (permission: string) => boolean;
  hasRole: (minimum: Role) => boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  switchOrganization: (organizationId: number) => Promise<void>;
  refreshSession: () => Promise<void>;
  /** Merge a fresh session payload without a round trip (used after role edits). */
  applySession: (payload: SessionContext) => void;
}

export interface RegisterInput {
  email: string;
  password: string;
  full_name: string;
  organization_name: string;
  organization_slug?: string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const ANONYMOUS: AuthState = {
  status: 'anonymous',
  user: null,
  organizations: [],
  activeOrganization: null,
  role: null,
  permissions: [],
};

function stateFromSession(payload: SessionContext): AuthState {
  const activeId = payload.active_organization_id ?? null;
  const activeOrganization =
    payload.organizations.find((org) => org.id === activeId) ?? payload.organizations[0] ?? null;

  return {
    status: 'authenticated',
    user: payload.user,
    organizations: payload.organizations,
    activeOrganization,
    role: (payload.role as Role | null) ?? (activeOrganization?.role as Role | null) ?? null,
    permissions: payload.permissions ?? [],
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => ({
    ...ANONYMOUS,
    status: loadStoredSession() ? 'loading' : 'anonymous',
  }));
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const clear = useCallback(() => {
    setSession(null);
    if (mounted.current) setState(ANONYMOUS);
  }, []);

  // A 401 from any request means the token is gone; drop it once, centrally.
  useEffect(() => {
    onUnauthorized(() => {
      if (mounted.current) setState(ANONYMOUS);
    });
    return () => onUnauthorized(null);
  }, []);

  const hydrate = useCallback(async () => {
    const stored = loadStoredSession();
    if (!stored) {
      if (mounted.current) setState(ANONYMOUS);
      return;
    }
    setSession(stored);
    try {
      const payload = await api.get<SessionContext>('/api/auth/me');
      if (!mounted.current) return;
      const next = stateFromSession(payload);
      setState(next);
      // Keep the stored organization in step with what the server resolved.
      if (next.activeOrganization) {
        setSession({
          token: stored.token,
          organizationId: next.activeOrganization.id,
          expiresAt: stored.expiresAt,
        });
      } else {
        setActiveOrganization(null);
      }
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        clear();
        return;
      }
      // Network or server failure: keep the token and show the app as anonymous
      // rather than pretending the user signed out.
      if (mounted.current) setState(ANONYMOUS);
    }
  }, [clear]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const adoptToken = useCallback((payload: TokenResponse) => {
    setSession({
      token: payload.access_token,
      organizationId: payload.active_organization_id ?? null,
      expiresAt: payload.expires_at,
    });
    const next = stateFromSession(payload);
    setState(next);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const payload = await api.post<TokenResponse>('/api/auth/login', { email, password });
      adoptToken(payload);
    },
    [adoptToken],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      const payload = await api.post<TokenResponse>('/api/auth/register', input);
      adoptToken(payload);
    },
    [adoptToken],
  );

  const logout = useCallback(async () => {
    try {
      await api.post<void>('/api/auth/logout');
    } catch {
      // The server-side logout is best-effort: the local token is dropped either
      // way, and a failure here must never trap the user in a signed-in shell.
    }
    clear();
  }, [clear]);

  const refreshSession = useCallback(async () => {
    const payload = await api.get<SessionContext>('/api/auth/me');
    setState(stateFromSession(payload));
  }, []);

  const switchOrganization = useCallback(
    async (organizationId: number) => {
      const payload = await api.post<TokenResponse>(
        `/api/auth/switch-organization/${organizationId}`,
      );
      adoptToken(payload);
    },
    [adoptToken],
  );

  const applySession = useCallback((payload: SessionContext) => {
    setState(stateFromSession(payload));
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const permissions = new Set(state.permissions);
    const rank = state.role ? ROLE_RANK[state.role] : 0;

    return {
      ...state,
      isAuthenticated: state.status === 'authenticated',
      can: (permission: string) => permissions.has(permission),
      hasRole: (minimum: Role) => rank >= ROLE_RANK[minimum],
      login,
      register,
      logout,
      switchOrganization,
      refreshSession,
      applySession,
    };
  }, [state, login, register, logout, switchOrganization, refreshSession, applySession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider.');
  return context;
}
