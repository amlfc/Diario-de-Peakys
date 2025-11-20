-- sql/schema.sql

CREATE TABLE IF NOT EXISTS `pky_portfolios` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(150) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pky_portfolios_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `pky_asset_types` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(150) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pky_asset_types_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `pky_transactions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `date` DATE NOT NULL,
  `portfolio` VARCHAR(150) NOT NULL,
  `type` VARCHAR(50) NOT NULL,
  `ticker` VARCHAR(50) NOT NULL,
  `assetName` VARCHAR(255) NOT NULL,
  `assetType` VARCHAR(150) NOT NULL,
  `quantity` DECIMAL(24,10) NOT NULL,
  `price` DECIMAL(24,10) NOT NULL,
  `commission` DECIMAL(24,10) NOT NULL DEFAULT 0,
  `currencyPlatform` VARCHAR(10) NOT NULL,
  `fxRateToEur` DECIMAL(24,10) NOT NULL DEFAULT 1,
  `notes` TEXT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_pky_transactions_portfolio` (`portfolio`),
  KEY `idx_pky_transactions_ticker` (`ticker`),
  KEY `idx_pky_transactions_assetType` (`assetType`),
  KEY `idx_pky_transactions_date` (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `pky_liquidity` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `date` DATE NOT NULL,
  `portfolio` VARCHAR(150) NOT NULL,
  `amountEur` DECIMAL(24,10) NOT NULL,
  `type` VARCHAR(50) NOT NULL,
  `notes` TEXT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_pky_liquidity_portfolio` (`portfolio`),
  KEY `idx_pky_liquidity_date` (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `pky_allocation_targets` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `portfolio` VARCHAR(150) NOT NULL,
  `assetType` VARCHAR(150) NOT NULL,
  `targetPercentage` DECIMAL(5,2) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pky_allocation_targets_portfolio_assetType` (`portfolio`, `assetType`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
