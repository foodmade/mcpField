CREATE TABLE `ingest_tags` (
	`kind` varchar(16) NOT NULL,
	`tag` varchar(255) NOT NULL,
	`slug` varchar(191) NOT NULL,
	CONSTRAINT `ingest_tags_kind_tag_slug_pk` PRIMARY KEY(`kind`,`tag`,`slug`)
);
--> statement-breakpoint
CREATE INDEX `ix_ingest_tags_slug` ON `ingest_tags` (`kind`,`slug`);--> statement-breakpoint
-- 已发布条目的初始数据（之后由 publish / search-index 结束时重建，见 src/tags/sync.ts）
INSERT IGNORE INTO `ingest_tags` (`kind`, `tag`, `slug`)
SELECT p.`kind`, j.`tag`, p.`slug` FROM `ingest_published` p, JSON_TABLE(p.`draft`, '$.tags[*]' COLUMNS (`tag` varchar(255) PATH '$' NULL ON ERROR)) j
WHERE j.`tag` IS NOT NULL AND j.`tag` <> '';
