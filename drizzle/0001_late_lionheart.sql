CREATE TABLE `company_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`email` text NOT NULL,
	`full_name` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `licence_audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`action` text NOT NULL,
	`previous_status` text,
	`new_status` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `production_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`report_date` text NOT NULL,
	`fleet_number` text NOT NULL,
	`shift_hours` real DEFAULT 24 NOT NULL,
	`planned_downtime` real DEFAULT 0 NOT NULL,
	`unplanned_downtime` real DEFAULT 0 NOT NULL,
	`operating_hours` real DEFAULT 0 NOT NULL,
	`productive_hours` real DEFAULT 0 NOT NULL,
	`tonnes` real DEFAULT 0 NOT NULL,
	`source_file` text,
	`created_at` text NOT NULL
);
