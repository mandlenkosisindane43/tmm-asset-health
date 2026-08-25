CREATE TABLE `quotations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer,
	`quote_number` text NOT NULL,
	`quote_date` text NOT NULL,
	`valid_until` text NOT NULL,
	`customer_name` text NOT NULL,
	`contact_name` text,
	`contact_email` text,
	`package_name` text NOT NULL,
	`billing_cycle` text NOT NULL,
	`licence_amount` real NOT NULL,
	`implementation_fee` real DEFAULT 0 NOT NULL,
	`bank_name` text,
	`account_holder` text,
	`account_number_encrypted` text,
	`branch_code` text,
	`payment_reference` text,
	`notes` text,
	`visibility` text DEFAULT 'selected_company' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`published_at` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quotations_quote_number_unique` ON `quotations` (`quote_number`);