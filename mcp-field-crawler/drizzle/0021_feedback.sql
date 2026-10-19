CREATE TABLE `feedback` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`kind` varchar(16) NOT NULL,
	`slug` varchar(191) NOT NULL,
	`type` varchar(16) NOT NULL,
	`body` text NOT NULL,
	`email` varchar(255),
	`user_id` varchar(36),
	`user_name` varchar(100),
	`ip_hash` char(64),
	`status` varchar(16) NOT NULL DEFAULT 'open',
	`handled_at` datetime(3),
	`handled_by` varchar(64),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `feedback_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `ix_feedback_status` ON `feedback` (`status`,`id`);--> statement-breakpoint
CREATE INDEX `ix_feedback_target` ON `feedback` (`kind`,`slug`);--> statement-breakpoint
CREATE INDEX `ix_feedback_ip_created` ON `feedback` (`ip_hash`,`created_at`);