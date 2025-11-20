
import { api } from './services/apiService';
import { Transaction, LiquidityEvent, Portfolio, AssetTypeEntity, AssetAllocationTarget, DefaultPortfolios, DefaultAssetTypes } from './types';

// Sistema simple de Pub/Sub para notificar cambios a los componentes React
type Listener = () => void;

class VirtualTable<T> {
  name: string; // Nombre real de la tabla en SQL (ej: pky_transactions)
  db: VirtualDatabase;

  constructor(name: string, db: VirtualDatabase) {
    this.name = name;
    this.db = db;
  }

  async toArray(): Promise<T[]> {
    return await api.get(this.name);
  }

  where(field: string) {
    return {
      equals: (value: any) => ({
        toArray: async () => {
          const all = await this.toArray();
          return (all as any[]).filter((item: any) => item[field] === value);
        },
        filter: (predicate: (x: T) => boolean) => ({
             modify: async (changes: any) => {
                 const all = await this.toArray();
                 const filtered = (all as any[]).filter((item: any) => item[field] === value).filter(predicate);
                 for (const item of filtered) {
                     if (item.id !== undefined) {
                        await api.update(this.name, item.id, changes);
                     }
                 }
                 this.db.notify();
             }
        })
      })
    };
  }

  async add(item: T) {
    await api.add(this.name, item);
    this.db.notify();
  }

  async bulkAdd(items: T[]) {
    if (items.length === 0) return;
    await api.add(this.name, items);
    this.db.notify();
  }

  async update(id: number, changes: Partial<T>) {
    await api.update(this.name, id, changes);
    this.db.notify();
  }

  async delete(id: number) {
    await api.delete(this.name, id);
    this.db.notify();
  }

  async clear() {
    await api.clear(this.name);
    this.db.notify();
  }
  
  async count() {
      const data = await this.toArray();
      return data.length;
  }
}

class VirtualDatabase {
  transactions: VirtualTable<Transaction>;
  liquidity: VirtualTable<LiquidityEvent>;
  portfolios: VirtualTable<Portfolio>;
  assetTypes: VirtualTable<AssetTypeEntity>;
  allocationTargets: VirtualTable<AssetAllocationTarget>;
  settings: any;

  private listeners: Listener[] = [];

  constructor() {
    // AQUI SE DEFINEN LOS NOMBRES REALES DE LAS TABLAS EN MYSQL (con prefijo pky_)
    this.transactions = new VirtualTable('pky_transactions', this);
    this.liquidity = new VirtualTable('pky_liquidity', this);
    this.portfolios = new VirtualTable('pky_portfolios', this);
    this.assetTypes = new VirtualTable('pky_asset_types', this);
    this.allocationTargets = new VirtualTable('pky_allocation_targets', this);
    
    // Settings uses a specialized approach or reuses a table logic
    this.settings = {
        get: async (key: string) => {
            const all = await api.get('pky_settings');
            return all.find((s: any) => s.setting_key === key);
        },
        put: async (obj: { key: string, value?: any, handle?: any }) => {
             // NOTE: Storing complex objects or handles in MySQL text fields is limited.
             // For file handles (AutoSync), we should keep using IndexedDB locally or skip for remote.
             if (obj.key === 'autoSyncHandle') {
                 // Skip cloud sync for file handles, they are browser-specific
                 return;
             }
             // For simple settings (like URLs)
             const val = typeof obj.value === 'string' ? obj.value : JSON.stringify(obj.value || obj);
             await api.add('pky_settings', { setting_key: obj.key, setting_value: val });
        },
        delete: async (key: string) => {
            // Not fully implemented for settings via ID lookup, simplified
        }
    };
  }

  subscribe(listener: Listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  notify() {
    this.listeners.forEach(l => l());
  }
}

export const db = new VirtualDatabase();

export const seedDatabase = async () => {
  // 1. Check Configuration
  if (!api.isConfigured()) {
      console.log("Skipping database seed: API URL not configured.");
      return;
  }

  try {
    // 2. Try to fetch portfolios to check connection
    const portfolios = await db.portfolios.toArray();

    // 3. CRITICAL: If API reported connection errors during fetch, DO NOT try to write.
    // This prevents the infinite loop of (Read Fail -> Return [] -> Seed thinks Empty -> Write Fail -> Error).
    if (api.hasError) {
        console.warn("Skipping database seed: API connection is unstable or offline.");
        return;
    }

    // 4. Only seed if connection is healthy and tables are genuinely empty
    if (portfolios.length === 0) {
        console.log("Seeding Portfolios...");
        await db.portfolios.bulkAdd([
            { name: DefaultPortfolios.Alejandro },
            { name: DefaultPortfolios.Marta },
            { name: DefaultPortfolios.Sara },
            { name: DefaultPortfolios.Mama }
        ]);
    }

    const assetTypes = await db.assetTypes.toArray();
    if (assetTypes.length === 0) {
        console.log("Seeding Asset Types...");
        await db.assetTypes.bulkAdd([
            { name: DefaultAssetTypes.ETFLong },
            { name: DefaultAssetTypes.ActionSwing },
            { name: DefaultAssetTypes.ActionLong },
            { name: DefaultAssetTypes.ActionPenny },
            { name: DefaultAssetTypes.Commodity },
            { name: DefaultAssetTypes.Crypto },
            { name: DefaultAssetTypes.FixedIncome },
            { name: DefaultAssetTypes.Unclassified },
        ]);
    }
  } catch (error) {
      console.warn("Database seed stopped:", error);
  }
};
