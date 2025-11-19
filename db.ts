import Dexie, { Table } from 'dexie';
import { Transaction, LiquidityEvent, Portfolio, AssetTypeEntity, AssetAllocationTarget, DefaultPortfolios, DefaultAssetTypes, TransactionType, Currency } from './types';

class PortfolioDatabase extends Dexie {
  transactions!: Table<Transaction>;
  liquidity!: Table<LiquidityEvent>;
  portfolios!: Table<Portfolio>;
  assetTypes!: Table<AssetTypeEntity>;
  allocationTargets!: Table<AssetAllocationTarget>;

  constructor() {
    super('PortfolioMasterDB');
    (this as any).version(4).stores({
      transactions: '++id, portfolio, ticker, date, type',
      liquidity: '++id, portfolio, date',
      portfolios: '++id, name',
      assetTypes: '++id, name',
      allocationTargets: '++id, [portfolio+assetType]',
      dividends: null // Deleting table in prev version
    }).upgrade((tx: any) => {
      // Migration logic if needed
    });
  }
}

export const db = new PortfolioDatabase();

// Seeder function to populate initial data if empty
export const seedDatabase = async () => {
  
  // Check if we have already seeded
  const hasSeeded = localStorage.getItem('DATA_SEEDED');
  if (hasSeeded === 'true') {
    return;
  }

  // 1. Seed Portfolios if empty (Required for dropdowns)
  const portfolioCount = await db.portfolios.count();
  if (portfolioCount === 0) {
    await db.portfolios.bulkAdd([
      { name: DefaultPortfolios.Alejandro },
      { name: DefaultPortfolios.Marta },
      { name: DefaultPortfolios.Sara },
      { name: DefaultPortfolios.Mama }
    ]);
  }

  // 2. Seed Asset Types if empty (Required for dropdowns)
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

  // NOTE: Removed sample transactions and liquidity. 
  // The app starts clean for the user.

  // Mark as seeded so we don't try again
  localStorage.setItem('DATA_SEEDED', 'true');
};