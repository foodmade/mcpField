CREATE TABLE `entity_claims` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`kind` varchar(16) NOT NULL,
	`slug` varchar(191) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`user_name` varchar(100) NOT NULL,
	`github_id` bigint unsigned NOT NULL,
	`github_login` varchar(100) NOT NULL,
	`github_avatar` varchar(512),
	`repo_full_name` varchar(255) NOT NULL,
	`method` varchar(16) NOT NULL,
	`claimed_at` datetime(3) NOT NULL,
	`revoked_at` datetime(3),
	`revoked_by` varchar(64),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `entity_claims_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_entity_claims_target` UNIQUE(`kind`,`slug`)
);
--> statement-breakpoint
CREATE INDEX `ix_entity_claims_claimed` ON `entity_claims` (`claimed_at`);