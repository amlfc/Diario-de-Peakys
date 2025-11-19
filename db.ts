
import Dexie, { Table } from 'dexie';
import { Transaction, LiquidityEvent, Portfolio, AssetTypeEntity, AssetAllocationTarget, DefaultPortfolios, DefaultAssetTypes, TransactionType, Currency } from './types';
import { autoSyncService } from './services/autoSyncService';

class PortfolioDatabase extends Dexie {
  transactions!: Table<Transaction>;
  liquidity!: Table<LiquidityEvent>;
  portfolios!: Table<Portfolio>;
  assetTypes!: Table<AssetTypeEntity>;
  allocationTargets!: Table<AssetAllocationTarget>;
  settings!: Table<any>; // Stores system settings like File Handles

  constructor() {
    super('PortfolioMasterDB');
    (this as any).version(4).stores({
      transactions: '++id, portfolio, ticker, date, type',
      liquidity: '++id, portfolio, date',
      portfolios: '++id, name',
      assetTypes: '++id, name',
      allocationTargets: '++id, [portfolio+assetType]',
      dividends: null,
      settings: 'key' // Simple Key-Value store
    });

    // --- HOOKS PARA AUTO-SYNC ---
    // Cada vez que se modifica cualquier tabla, avisamos al servicio
    // El servicio se encarga del "debounce" (esperar) para no saturar
    const tables = [this.transactions, this.liquidity, this.portfolios, this.assetTypes, this.allocationTargets];
    
    tables.forEach(table => {
      table.hook('creating', () => { autoSyncService.notifyChange(); });
      table.hook('updating', () => { autoSyncService.notifyChange(); });
      table.hook('deleting', () => { autoSyncService.notifyChange(); });
    });
  }
}

export const db = new PortfolioDatabase();

export const seedDatabase = async () => {
  const hasSeeded = localStorage.getItem('DATA_SEEDED');
  if (hasSeeded === 'true') return;

  const portfolioCount = await db.portfolios.count();
  if (portfolioCount === 0) {
    await db.portfolios.bulkAdd([
      { name: DefaultPortfolios.Alejandro },
      { name: DefaultPortfolios.Marta },
      { name: DefaultPortfolios.Sara },
      { name: DefaultPortfolios.Mama }
    ]);
  }

  const assetTypeCount = await db.assetTypes.count();
  if (assetTypeCount === 0) {
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

  localStorage.setItem('DATA_SEEDED', 'true');
};
