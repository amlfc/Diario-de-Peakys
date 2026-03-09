import {
  FxCarryResponse,
  FxCorrelationMatrixResponse,
  FxDxyImpactResponse,
  FxExposureResponse,
  FxHedgeRatioResponse,
  FxOverviewResponse,
  FxStressResponse,
  PortfolioOwner,
  User,
} from '../types';

type ScopePayload = {
  user_id?: number;
  role?: string;
  username?: string;
  portfolio: PortfolioOwner | 'ALL';
};

class FxApiService {
  private sanitizeUrl(value: string | null): string | null {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      return trimmed.replace(/\/$/, '');
    } catch {
      return null;
    }
  }

  isConfigured() {
    return !!this.sanitizeUrl(localStorage.getItem('FX_API_URL'));
  }

  private getUrl() {
    return this.sanitizeUrl(localStorage.getItem('FX_API_URL'));
  }

  private buildScope(user: User | null | undefined, portfolio: PortfolioOwner | 'ALL'): ScopePayload {
    const parsedUserId =
      typeof user?.id === 'number'
        ? user.id
        : typeof (user as any)?.id === 'string' && Number.isFinite(Number((user as any).id))
          ? Number((user as any).id)
          : undefined;

    return {
      user_id: parsedUserId,
      role: user?.role || 'user',
      username: user?.username || '',
      portfolio,
    };
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const baseUrl = this.getUrl();
    if (!baseUrl) {
      throw new Error('FX API URL no configurada. Ve a Configuración y añade FX_API_URL.');
    }

    const response = await fetch(`${baseUrl}${path}`, {
      headers: {
        Accept: 'application/json',
        ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
        ...options?.headers,
      },
      ...options,
    });

    if (!response.ok) {
      throw new Error(`FX API ${response.status}: ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  private withQuery(path: string, params: Record<string, string | number | undefined>) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      query.set(key, String(value));
    });
    return query.toString() ? `${path}?${query.toString()}` : path;
  }

  getOverview() {
    return this.request<FxOverviewResponse>('/api/fx/overview');
  }

  getCarry() {
    return this.request<FxCarryResponse>('/api/fx/carry');
  }

  getCorrelationMatrix() {
    return this.request<FxCorrelationMatrixResponse>('/api/fx/correlation_matrix');
  }

  getExposure(user: User | null | undefined, portfolio: PortfolioOwner | 'ALL') {
    const scope = this.buildScope(user, portfolio);
    return this.request<FxExposureResponse>(this.withQuery('/api/fx/exposure', scope));
  }

  getDxyImpact(user: User | null | undefined, portfolio: PortfolioOwner | 'ALL') {
    const scope = this.buildScope(user, portfolio);
    return this.request<FxDxyImpactResponse>(this.withQuery('/api/fx/dxy_impact', scope));
  }

  getHedgeRatio(
    user: User | null | undefined,
    portfolio: PortfolioOwner | 'ALL',
    assetTicker: string,
    fxPair: string,
    window = 30
  ) {
    const scope = this.buildScope(user, portfolio);
    return this.request<FxHedgeRatioResponse>(
      this.withQuery('/api/fx/hedge_ratio', {
        ...scope,
        asset_ticker: assetTicker,
        fx_pair: fxPair,
        window,
      })
    );
  }

  stressTest(
    user: User | null | undefined,
    portfolio: PortfolioOwner | 'ALL',
    scenario: string,
    customShocks?: Record<string, number>
  ) {
    const payload = {
      ...this.buildScope(user, portfolio),
      scenario,
      custom_shocks: customShocks,
    };
    return this.request<FxStressResponse>('/api/fx/stress_test', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }
}

export const fxApiService = new FxApiService();
