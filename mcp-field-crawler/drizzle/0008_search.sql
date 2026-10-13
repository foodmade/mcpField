CREATE TABLE `ingest_search` (
	`kind` varchar(16) NOT NULL,
	`locale` varchar(8) NOT NULL,
	`pop_rank` bigint NOT NULL,
	`featured_rank` tinyint NOT NULL,
	`slug` varchar(191) NOT NULL,
	`body` mediumtext NOT NULL,
	`row_hash` char(64) NOT NULL,
	CONSTRAINT `ingest_search_kind_locale_pop_rank_featured_rank_slug_pk` PRIMARY KEY(`kind`,`locale`,`pop_rank`,`featured_rank`,`slug`),
	CONSTRAINT `uq_ingest_search_slug` UNIQUE(`kind`,`locale`,`slug`)
);
