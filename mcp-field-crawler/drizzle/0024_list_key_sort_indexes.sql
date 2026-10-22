-- 列表键表的排序索引：列方向与列表的 ORDER BY 一致（降序排的键建成降序列），按索引顺序取够一页就停，不用对整类排序。
-- MySQL 里 NULL 比任何值都小，降序时本来就排在最后，ORDER BY 不再需要 "x IS NULL" 前缀，才能用上索引。
-- 名称改存小写后的 sort_name，列的排序规则用 utf8mb4_general_ci：与直接查发布层时 LOWER(CAST(...)) 按连接排序规则比较的顺序一致。
ALTER TABLE `ingest_list_keys` ADD `sort_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;--> statement-breakpoint
UPDATE `ingest_list_keys` SET `sort_name` = LOWER(`name`);--> statement-breakpoint
ALTER TABLE `ingest_list_keys` DROP COLUMN `name`;--> statement-breakpoint
CREATE INDEX `ix_ingest_list_keys_popular` ON `ingest_list_keys` (`kind`,`popularity` DESC,`featured` DESC,`slug`);--> statement-breakpoint
CREATE INDEX `ix_ingest_list_keys_stars` ON `ingest_list_keys` (`kind`,`stars` DESC,`slug`);--> statement-breakpoint
CREATE INDEX `ix_ingest_list_keys_installs` ON `ingest_list_keys` (`kind`,`installs` DESC,`slug`);--> statement-breakpoint
CREATE INDEX `ix_ingest_list_keys_name` ON `ingest_list_keys` (`kind`,`sort_name`,`slug`);--> statement-breakpoint
CREATE INDEX `ix_ingest_list_keys_updated` ON `ingest_list_keys` (`kind`,`last_commit_at` DESC,`slug`);--> statement-breakpoint
CREATE INDEX `ix_ingest_list_keys_newest` ON `ingest_list_keys` (`kind`,`source_created_at` DESC,`slug`);
