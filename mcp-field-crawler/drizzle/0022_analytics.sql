CREATE TABLE `analytics_daily` (
	`day` date NOT NULL,
	`dim` varchar(16) NOT NULL,
	`value` varchar(512) NOT NULL,
	`pv` int unsigned NOT NULL,
	`uv` int unsigned NOT NULL,
	`visits` int unsigned NOT NULL,
	CONSTRAINT `analytics_daily_day_dim_value_pk` PRIMARY KEY(`day`,`dim`,`value`)
);
--> statement-breakpoint
CREATE TABLE `analytics_events` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`day` date NOT NULL,
	`at` datetime(3) NOT NULL,
	`visitor` char(32) NOT NULL,
	`entry` boolean NOT NULL,
	`path` varchar(512) NOT NULL,
	`page` varchar(32) NOT NULL,
	`locale` varchar(8) NOT NULL,
	`source` varchar(255) NOT NULL DEFAULT '',
	`country` char(2) NOT NULL DEFAULT 'XX',
	`device` varchar(8) NOT NULL,
	`browser` varchar(16) NOT NULL,
	`os` varchar(16) NOT NULL,
	CONSTRAINT `analytics_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `analytics_salts` (
	`day` date NOT NULL,
	`salt` char(64) NOT NULL,
	CONSTRAINT `analytics_salts_day` PRIMARY KEY(`day`)
);
--> statement-breakpoint
CREATE TABLE `crawler_daily` (
	`day` date NOT NULL,
	`bot` varchar(32) NOT NULL,
	`status` smallint unsigned NOT NULL,
	`hits` bigint unsigned NOT NULL,
	CONSTRAINT `crawler_daily_day_bot_status_pk` PRIMARY KEY(`day`,`bot`,`status`)
);
--> statement-breakpoint
CREATE INDEX `ix_analytics_events_day_visitor` ON `analytics_events` (`day`,`visitor`);