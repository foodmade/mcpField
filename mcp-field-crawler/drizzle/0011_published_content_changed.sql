ALTER TABLE `ingest_published` ADD `content_hash` char(64);--> statement-breakpoint
ALTER TABLE `ingest_published` ADD `content_changed_at` datetime(3);--> statement-breakpoint
-- 已发布条目的初始值：源站收录时间和最近提交时间里较晚的一个（都没有时为空，sitemap 不输出 lastmod）；不用源站更新时间，它会被批量刷新
UPDATE `ingest_published` SET `content_changed_at` = STR_TO_DATE(LEFT(JSON_UNQUOTE(JSON_EXTRACT(`draft`, '$.sourceCreatedAt')), 19), '%Y-%m-%dT%H:%i:%s') WHERE JSON_UNQUOTE(JSON_EXTRACT(`draft`, '$.sourceCreatedAt')) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}';--> statement-breakpoint
UPDATE `ingest_published` SET `content_changed_at` = STR_TO_DATE(LEFT(JSON_UNQUOTE(JSON_EXTRACT(`draft`, '$.lastCommitAt')), 19), '%Y-%m-%dT%H:%i:%s')
WHERE JSON_UNQUOTE(JSON_EXTRACT(`draft`, '$.lastCommitAt')) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}' AND (`content_changed_at` IS NULL OR STR_TO_DATE(LEFT(JSON_UNQUOTE(JSON_EXTRACT(`draft`, '$.lastCommitAt')), 19), '%Y-%m-%dT%H:%i:%s') > `content_changed_at`);
