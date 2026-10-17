CREATE TABLE `admin_coverage` (
	`kind` varchar(16) NOT NULL,
	`stage` varchar(24) NOT NULL,
	`na` int unsigned NOT NULL DEFAULT 0,
	`pending` int unsigned NOT NULL DEFAULT 0,
	`ok` int unsigned NOT NULL DEFAULT 0,
	`warn` int unsigned NOT NULL DEFAULT 0,
	`failed` int unsigned NOT NULL DEFAULT 0,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `admin_coverage_kind_stage_pk` PRIMARY KEY(`kind`,`stage`)
);
--> statement-breakpoint
CREATE TABLE `admin_item_status` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`kind` varchar(16) NOT NULL,
	`source_id` varchar(32) NOT NULL,
	`external_id` varchar(255) NOT NULL,
	`slug` varchar(191) NOT NULL,
	`name` varchar(255) NOT NULL,
	`icon_url` varchar(1024),
	`category` varchar(64),
	`sources` varchar(255) NOT NULL,
	`popularity` int unsigned,
	`first_seen_at` datetime(3) NOT NULL,
	`first_seen_date` date NOT NULL,
	`published_at` datetime(3) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`st_classify` tinyint NOT NULL DEFAULT 1,
	`st_icon` tinyint NOT NULL DEFAULT 1,
	`st_github` tinyint NOT NULL DEFAULT 1,
	`st_readme` tinyint NOT NULL DEFAULT 1,
	`st_translate` tinyint NOT NULL DEFAULT 1,
	`st_tools` tinyint NOT NULL DEFAULT 1,
	`st_tools_translate` tinyint NOT NULL DEFAULT 1,
	`st_intro` tinyint NOT NULL DEFAULT 1,
	`st_readme_translate` tinyint NOT NULL DEFAULT 1,
	`notes` json,
	`fail_count` tinyint NOT NULL DEFAULT 0,
	`warn_count` tinyint NOT NULL DEFAULT 0,
	`pending_count` tinyint NOT NULL DEFAULT 0,
	`has_fail` boolean NOT NULL DEFAULT false,
	`readme_content_hash` char(64),
	`readme_hash` char(64),
	`readme_lang` varchar(8),
	`readme_chars` int unsigned,
	`readme_format` varchar(16),
	`seen_at` datetime(3) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `admin_item_status_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_admin_item_status_entity` UNIQUE(`kind`,`source_id`,`external_id`)
);
--> statement-breakpoint
CREATE TABLE `admin_job_batches` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`trigger` varchar(16) NOT NULL,
	`run_date` date NOT NULL,
	`steps` json NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'running',
	`host` varchar(128),
	`pid` int unsigned,
	`started_at` datetime(3) NOT NULL,
	`finished_at` datetime(3),
	CONSTRAINT `admin_job_batches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `admin_job_runs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`batch_id` bigint unsigned,
	`step` varchar(32) NOT NULL,
	`args` varchar(255) NOT NULL DEFAULT '',
	`status` varchar(16) NOT NULL DEFAULT 'running',
	`progress_done` int unsigned,
	`progress_total` int unsigned,
	`ok_count` int unsigned,
	`review_count` int unsigned,
	`failed_count` int unsigned,
	`summary` json,
	`error` text,
	`log_tail` json,
	`host` varchar(128),
	`pid` int unsigned,
	`started_at` datetime(3) NOT NULL,
	`heartbeat_at` datetime(3) NOT NULL,
	`finished_at` datetime(3),
	CONSTRAINT `admin_job_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `admin_sessions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`token_hash` char(64) NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`ip` varchar(64),
	`user_agent` varchar(255),
	`created_at` datetime(3) NOT NULL,
	`last_seen_at` datetime(3) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	CONSTRAINT `admin_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_admin_sessions_token` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `admin_users` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`username` varchar(64) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`failed_attempts` smallint unsigned NOT NULL DEFAULT 0,
	`locked_until` datetime(3),
	`last_login_at` datetime(3),
	`password_changed_at` datetime(3),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `admin_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_admin_users_username` UNIQUE(`username`)
);
--> statement-breakpoint
CREATE INDEX `ix_admin_item_status_list` ON `admin_item_status` (`kind`,`active`,`first_seen_at`);--> statement-breakpoint
CREATE INDEX `ix_admin_item_status_fail` ON `admin_item_status` (`kind`,`active`,`has_fail`,`first_seen_at`);--> statement-breakpoint
CREATE INDEX `ix_admin_item_status_category` ON `admin_item_status` (`kind`,`active`,`category`,`first_seen_at`);--> statement-breakpoint
CREATE INDEX `ix_admin_item_status_popular` ON `admin_item_status` (`kind`,`active`,`popularity`);--> statement-breakpoint
CREATE INDEX `ix_admin_item_status_date` ON `admin_item_status` (`first_seen_date`,`kind`);--> statement-breakpoint
CREATE INDEX `ix_admin_item_status_slug` ON `admin_item_status` (`kind`,`slug`);--> statement-breakpoint
CREATE INDEX `ix_admin_job_batches_date` ON `admin_job_batches` (`run_date`,`started_at`);--> statement-breakpoint
CREATE INDEX `ix_admin_job_runs_batch` ON `admin_job_runs` (`batch_id`);--> statement-breakpoint
CREATE INDEX `ix_admin_job_runs_step` ON `admin_job_runs` (`step`,`started_at`);--> statement-breakpoint
CREATE INDEX `ix_admin_job_runs_started` ON `admin_job_runs` (`started_at`);--> statement-breakpoint
CREATE INDEX `ix_admin_sessions_user` ON `admin_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `ix_admin_sessions_expires` ON `admin_sessions` (`expires_at`);