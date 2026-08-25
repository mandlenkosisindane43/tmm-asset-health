CREATE TABLE `companies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`licence_key` text NOT NULL,
	`licence_status` text DEFAULT 'trial' NOT NULL,
	`expires_at` text NOT NULL,
	`grace_days` integer DEFAULT 7 NOT NULL,
	`max_users` integer DEFAULT 10 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companies_licence_key_unique` ON `companies` (`licence_key`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`fleet_number` text NOT NULL,
	`event_type` text NOT NULL,
	`severity` text NOT NULL,
	`system_name` text NOT NULL,
	`component` text NOT NULL,
	`description` text NOT NULL,
	`opened_at` text NOT NULL,
	`closed_at` text,
	`downtime_hours` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`action` text,
	`spares_status` text,
	`expected_return` text,
	`oil_litres_lost` real DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `machines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`fleet_number` text NOT NULL,
	`category` text NOT NULL,
	`site` text NOT NULL,
	`status` text DEFAULT 'operating' NOT NULL,
	`operating_hours` real DEFAULT 0 NOT NULL,
	`availability_target` real DEFAULT 0.9 NOT NULL,
	`next_service_hours` real,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `work_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`fleet_number` text NOT NULL,
	`title` text NOT NULL,
	`priority` text NOT NULL,
	`assigned_to` text,
	`due_at` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text NOT NULL
);
