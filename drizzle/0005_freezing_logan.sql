CREATE TABLE `order_updates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`purchase_order_id` integer NOT NULL,
	`previous_status` text,
	`new_status` text NOT NULL,
	`note` text,
	`updated_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`order_number` text NOT NULL,
	`document_type` text DEFAULT 'purchase_order' NOT NULL,
	`supplier` text NOT NULL,
	`store_contact` text,
	`fleet_number` text,
	`description` text NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	`order_date` text NOT NULL,
	`expected_delivery` text,
	`actual_delivery` text,
	`payment_status` text DEFAULT 'not_paid' NOT NULL,
	`order_status` text DEFAULT 'quotation_requested' NOT NULL,
	`attachment_key` text,
	`attachment_name` text,
	`responsible_person` text,
	`reminder_email` integer DEFAULT true NOT NULL,
	`reminder_sms` integer DEFAULT false NOT NULL,
	`next_reminder_at` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
