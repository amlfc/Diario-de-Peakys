export interface RiskLevelsConfig {
  stopPercents: [number, number, number];
  trailingPercents: [number, number, number];
}

export const RISK_LEVELS_STORAGE_KEY = 'RISK_LEVELS_CONFIG';

export const DEFAULT_RISK_LEVELS: RiskLevelsConfig = {
  stopPercents: [2.5, 5, 20],
  trailingPercents: [5, 10, 15]
};

const parseLevel = (value: unknown, fallback: number): number => {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return Number(num.toFixed(2));
};

export const getRiskLevelsConfig = (): RiskLevelsConfig => {
  try {
    const raw = localStorage.getItem(RISK_LEVELS_STORAGE_KEY);
    if (!raw) return DEFAULT_RISK_LEVELS;

    const parsed = JSON.parse(raw);
    return {
      stopPercents: [
        parseLevel(parsed?.stopPercents?.[0], DEFAULT_RISK_LEVELS.stopPercents[0]),
        parseLevel(parsed?.stopPercents?.[1], DEFAULT_RISK_LEVELS.stopPercents[1]),
        parseLevel(parsed?.stopPercents?.[2], DEFAULT_RISK_LEVELS.stopPercents[2])
      ],
      trailingPercents: [
        parseLevel(parsed?.trailingPercents?.[0], DEFAULT_RISK_LEVELS.trailingPercents[0]),
        parseLevel(parsed?.trailingPercents?.[1], DEFAULT_RISK_LEVELS.trailingPercents[1]),
        parseLevel(parsed?.trailingPercents?.[2], DEFAULT_RISK_LEVELS.trailingPercents[2])
      ]
    };
  } catch {
    return DEFAULT_RISK_LEVELS;
  }
};

export const saveRiskLevelsConfig = (config: RiskLevelsConfig) => {
  localStorage.setItem(RISK_LEVELS_STORAGE_KEY, JSON.stringify(config));
};
