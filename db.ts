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

// Seeder function to populate initial data if empty (simulating the Excel starting point)
export const seedDatabase = async () => {
  
  // Seed Portfolios if empty
  const portfolioCount = await db.portfolios.count();
  if (portfolioCount === 0) {
    await db.portfolios.bulkAdd([
      { name: DefaultPortfolios.Alejandro },
      { name: DefaultPortfolios.Marta },
      { name: DefaultPortfolios.Sara },
      { name: DefaultPortfolios.Mama }
    ]);
  }

  // Seed Asset Types if empty
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

  // Seed Transactions if empty
  const count = await db.transactions.count();
  if (count === 0) {
    await db.transactions.bulkAdd([
      {
        date: '2023-01-15',
        portfolio: DefaultPortfolios.Alejandro,
        type: TransactionType.Buy,
        ticker: 'AAPL',
        assetName: 'Apple Inc.',
        assetType: DefaultAssetTypes.ActionLong,
        quantity: 10,
        price: 150,
        commission: 1,
        currencyPlatform: Currency.USD,
        fxRateToEur: 0.92,
      },
      {
        date: '2023-02-10',
        portfolio: DefaultPortfolios.Alejandro,
        type: TransactionType.Buy,
        ticker: 'MSFT',
        assetName: 'Microsoft Corp',
        assetType: DefaultAssetTypes.ActionLong,
        quantity: 5,
        price: 250,
        commission: 1,
        currencyPlatform: Currency.USD,
        fxRateToEur: 0.93,
      },
      {
        date: '2023-03-05',
        portfolio: DefaultPortfolios.Marta,
        type: TransactionType.Buy,
        ticker: 'VWRL',
        assetName: 'Vanguard FTSE All-World',
        assetType: DefaultAssetTypes.ETFLong,
        quantity: 50,
        price: 98,
        commission: 2,
        currencyPlatform: Currency.EUR,
        fxRateToEur: 1,
      },
       {
        date: '2023-06-20',
        portfolio: DefaultPortfolios.Alejandro,
        type: TransactionType.Sell,
        ticker: 'AAPL',
        assetName: 'Apple Inc.',
        assetType: DefaultAssetTypes.ActionLong,
        quantity: 2,
        price: 180, // Profit
        commission: 1,
        currencyPlatform: Currency.USD,
        fxRateToEur: 0.91,
      }
    ]);

    await db.liquidity.bulkAdd([
      {
        date: '2023-01-01',
        portfolio: DefaultPortfolios.Alejandro,
        amountEur: 10000,
        type: 'Ingreso Inicial'
      },
      {
        date: '2023-01-01',
        portfolio: DefaultPortfolios.Marta,
        amountEur: 5000,
        type: 'Ingreso Inicial'
      }
    ]);
  }
};