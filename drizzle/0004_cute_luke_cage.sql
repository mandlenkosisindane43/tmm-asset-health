CREATE TABLE `data_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`name` text NOT NULL,
	`source_type` text NOT NULL,
	`provider` text,
	`status` text DEFAULT 'not_connected' NOT NULL,
	`last_sync_at` text,
	`configuration_json` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `import_batches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`source_file` text NOT NULL,
	`source_type` text NOT NULL,
	`status` text DEFAULT 'pending_review' NOT NULL,
	`total_rows` integer DEFAULT 0 NOT NULL,
	`imported_rows` integer DEFAULT 0 NOT NULL,
	`error_rows` integer DEFAULT 0 NOT NULL,
	`mapping_json` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
