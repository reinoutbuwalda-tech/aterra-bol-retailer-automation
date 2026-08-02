CREATE TABLE `accounting_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`version` integer NOT NULL,
	`definition` text NOT NULL,
	`effective_from` text NOT NULL,
	`status` text NOT NULL,
	`approved_by` text,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `app_users` (
	`email` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`decision` text NOT NULL,
	`rationale` text,
	`actor_email` text NOT NULL,
	`decided_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_email` text NOT NULL,
	`action` text NOT NULL,
	`object_type` text NOT NULL,
	`object_id` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`occurred_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bank_statements` (
	`id` text PRIMARY KEY NOT NULL,
	`source_file_id` text NOT NULL,
	`account_ref` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`opening_balance` real NOT NULL,
	`credits` real NOT NULL,
	`debits` real NOT NULL,
	`closing_balance` real NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bank_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`statement_id` text NOT NULL,
	`booked_at` text NOT NULL,
	`amount` real NOT NULL,
	`description` text NOT NULL,
	`counterparty` text,
	`transaction_ref` text,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `exceptions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`severity` text NOT NULL,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`detail` text NOT NULL,
	`owner` text NOT NULL,
	`resolution` text,
	`resolved_by` text,
	`resolved_at` text,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ingestion_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`source_file_id` text NOT NULL,
	`adapter` text NOT NULL,
	`adapter_version` text NOT NULL,
	`rows_read` integer DEFAULT 0 NOT NULL,
	`rows_accepted` integer DEFAULT 0 NOT NULL,
	`rows_rejected` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE TABLE `legal_entities` (
	`id` text PRIMARY KEY NOT NULL,
	`legal_name` text NOT NULL,
	`trading_name` text,
	`legal_form` text NOT NULL,
	`kvk` text NOT NULL,
	`rsin` text,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `marketplace_daily` (
	`id` text PRIMARY KEY NOT NULL,
	`source_file_id` text NOT NULL,
	`sales_date` text NOT NULL,
	`ean` text NOT NULL,
	`revenue` real NOT NULL,
	`sales` integer NOT NULL,
	`orders` integer NOT NULL,
	`visits` integer NOT NULL,
	`row_hash` text NOT NULL,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reconciliation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`period` text NOT NULL,
	`rule_version` text NOT NULL,
	`matched_count` integer NOT NULL,
	`unmatched_count` integer NOT NULL,
	`difference` real NOT NULL,
	`status` text NOT NULL,
	`approved_by` text,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`source_file_id` text NOT NULL,
	`provider` text NOT NULL,
	`gross_amount` real NOT NULL,
	`adjustment_amount` real NOT NULL,
	`net_amount` real NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`paid_at` text,
	`matched_transaction_id` text,
	`match_status` text NOT NULL,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_files` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text,
	`file_name` text NOT NULL,
	`drive_path` text NOT NULL,
	`drive_file_id` text,
	`object_key` text,
	`sha256` text NOT NULL,
	`mime_type` text,
	`period_start` text,
	`period_end` text,
	`received_at` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`active_from` text,
	`active_to` text,
	`status` text NOT NULL,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);
