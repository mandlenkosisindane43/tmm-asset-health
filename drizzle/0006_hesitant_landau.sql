CREATE TABLE `company_invitations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`email` text NOT NULL,
	`full_name` text NOT NULL,
	`role` text NOT NULL,
	`invite_code` text NOT NULL,
	`invited_by` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `company_invitations_invite_code_unique` ON `company_invitations` (`invite_code`);--> statement-breakpoint
CREATE TABLE `software_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`full_name` text NOT NULL,
	`business_name` text NOT NULL,
	`phone` text,
	`role` text DEFAULT 'software_owner' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `software_users_email_unique` ON `software_users` (`email`);