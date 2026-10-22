-- 数据由 src/list-keys/sync.ts 生成（publish / github / search-index 结束时整类重建）；某个类型还没有数据时，列表接口直接查发布层
CREATE TABLE `ingest_list_categories` (
	`kind` varchar(16) NOT NULL,
	`slug` varchar(191) NOT NULL,
	`position` smallint NOT NULL,
	`category` varchar(64) NOT NULL,
	`source_value` varchar(128) NOT NULL,
	`is_primary` boolean NOT NULL,
	CONSTRAINT `ingest_list_categories_kind_slug_position_pk` PRIMARY KEY(`kind`,`slug`,`position`)
);
--> statement-breakpoint
CREATE TABLE `ingest_list_keys` (
	`kind` varchar(16) NOT NULL,
	`slug` varchar(191) NOT NULL,
	`remote` tinyint,
	`featured` tinyint,
	`verified` tinyint,
	`official` tinyint,
	`subtype` varchar(64),
	`first_category` varchar(64),
	`category_count` smallint,
	`popularity` bigint,
	`stars` bigint,
	`installs` bigint,
	`name` varchar(255),
	`last_commit_at` varchar(40),
	`source_created_at` varchar(40),
	CONSTRAINT `ingest_list_keys_kind_slug_pk` PRIMARY KEY(`kind`,`slug`)
);
--> statement-breakpoint
CREATE INDEX `ix_ingest_list_categories_category` ON `ingest_list_categories` (`kind`,`category`);