CREATE TABLE `api_keys` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`name` varchar(100) NOT NULL,
	`key_hash` char(64) NOT NULL,
	`hint_prefix` varchar(8) NOT NULL,
	`hint_suffix` varchar(8) NOT NULL,
	`expires_at` datetime(3),
	`last_used_at` datetime(3),
	`last_used_client` varchar(64),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `api_keys_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_api_keys_hash` UNIQUE(`key_hash`)
);
--> statement-breakpoint
CREATE INDEX `ix_api_keys_user` ON `api_keys` (`user_id`,`id`);