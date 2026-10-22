-- 列表键表加「是否允许搜索引擎收录」：值由 list-keys/sync.ts 的 INDEXABLE 在重建时算出；迁移后到下次重建（publish / github / search-index）之前都是 NULL，按收录处理。
ALTER TABLE `ingest_list_keys` ADD `indexable` tinyint;
