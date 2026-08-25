CREATE TABLE `alert_contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`full_name` text NOT NULL,
	`role` text NOT NULL,
	`email` text,
	`phone` text,
	`email_enabled` integer DEFAULT true NOT NULL,
	`sms_enabled` integer DEFAULT true NOT NULL,
	`escalation_order` integer DEFAULT 1 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notification_audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`event_id` integer,
	`contact_id` integer,
	`channel` text NOT NULL,
	`destination_masked` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`provider_reference` text,
	`sent_at` text,
	`acknowledged_at` text,
	`created_at` text NOT NULL
);
