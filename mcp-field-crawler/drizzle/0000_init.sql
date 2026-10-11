CREATE TABLE `agent_details` (
	`entity_id` bigint unsigned NOT NULL,
	`agent_type` varchar(16),
	`is_open_source` boolean,
	`pricing` varchar(16),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `agent_details_entity_id` PRIMARY KEY(`entity_id`)
);
--> statement-breakpoint
CREATE TABLE `authors` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`platform` varchar(16) NOT NULL,
	`login` varchar(128) NOT NULL,
	`display_name` varchar(255),
	`type` varchar(16) NOT NULL DEFAULT 'unknown',
	`url` varchar(1024),
	`avatar_url` varchar(1024),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `authors_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_authors_platform_login` UNIQUE(`platform`,`login`)
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`kind` varchar(16) NOT NULL,
	`slug` varchar(64) NOT NULL,
	`parent_id` bigint unsigned,
	`name_zh` varchar(128) NOT NULL,
	`name_en` varchar(128) NOT NULL,
	`name_ja` varchar(128) NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_categories_kind_slug` UNIQUE(`kind`,`slug`)
);
--> statement-breakpoint
CREATE TABLE `cli_details` (
	`entity_id` bigint unsigned NOT NULL,
	`command` varchar(64),
	`cli_type` varchar(32),
	`is_agent_ready` boolean,
	`last_verified_on` date,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cli_details_entity_id` PRIMARY KEY(`entity_id`)
);
--> statement-breakpoint
CREATE TABLE `cli_examples` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`entity_id` bigint unsigned NOT NULL,
	`position` smallint NOT NULL,
	`command` varchar(1024) NOT NULL,
	`origin` varchar(16) NOT NULL DEFAULT 'source',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cli_examples_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_cli_examples_pos` UNIQUE(`entity_id`,`position`)
);
--> statement-breakpoint
CREATE TABLE `cli_install_methods` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`entity_id` bigint unsigned NOT NULL,
	`manager` varchar(16) NOT NULL,
	`platform` varchar(16) NOT NULL DEFAULT 'any',
	`command` varchar(1024) NOT NULL,
	`is_primary` boolean NOT NULL DEFAULT false,
	`position` smallint NOT NULL DEFAULT 0,
	`origin` varchar(16) NOT NULL DEFAULT 'source',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cli_install_methods_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_cli_install_methods` UNIQUE(`entity_id`,`manager`,`platform`)
);
--> statement-breakpoint
CREATE TABLE `client_capabilities` (
	`entity_id` bigint unsigned NOT NULL,
	`capability` varchar(32) NOT NULL,
	`support` varchar(12) NOT NULL,
	`note` varchar(255),
	`origin` varchar(16) NOT NULL DEFAULT 'source',
	CONSTRAINT `client_capabilities_entity_id_capability_pk` PRIMARY KEY(`entity_id`,`capability`)
);
--> statement-breakpoint
CREATE TABLE `client_details` (
	`entity_id` bigint unsigned NOT NULL,
	`client_type` varchar(32),
	`runtime` varchar(16),
	`is_open_source` boolean,
	`pricing` varchar(16),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `client_details_entity_id` PRIMARY KEY(`entity_id`)
);
--> statement-breakpoint
CREATE TABLE `entities` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`kind` varchar(16) NOT NULL,
	`slug` varchar(191) NOT NULL,
	`identity_key` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`icon_url` varchar(1024),
	`status` varchar(16) NOT NULL DEFAULT 'draft',
	`is_official` boolean NOT NULL DEFAULT false,
	`is_verified` boolean NOT NULL DEFAULT false,
	`is_featured` boolean NOT NULL DEFAULT false,
	`primary_category_id` bigint unsigned,
	`repository_id` bigint unsigned,
	`repository_path` varchar(512) NOT NULL DEFAULT '',
	`license_spdx` varchar(64),
	`stars` int unsigned,
	`installs` int unsigned,
	`quality_score` smallint,
	`first_seen_at` datetime(3),
	`source_updated_at` datetime(3),
	`last_commit_at` datetime(3),
	`published_at` datetime(3),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `entities_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_entities_kind_slug` UNIQUE(`kind`,`slug`),
	CONSTRAINT `uq_entities_identity_key` UNIQUE(`identity_key`)
);
--> statement-breakpoint
CREATE TABLE `entity_aliases` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`entity_id` bigint unsigned NOT NULL,
	`type` varchar(24) NOT NULL,
	`value` varchar(255) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `entity_aliases_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_entity_aliases` UNIQUE(`entity_id`,`type`,`value`)
);
--> statement-breakpoint
CREATE TABLE `entity_authors` (
	`entity_id` bigint unsigned NOT NULL,
	`author_id` bigint unsigned NOT NULL,
	`role` varchar(16) NOT NULL,
	CONSTRAINT `entity_authors_entity_id_author_id_role_pk` PRIMARY KEY(`entity_id`,`author_id`,`role`)
);
--> statement-breakpoint
CREATE TABLE `entity_categories` (
	`entity_id` bigint unsigned NOT NULL,
	`category_id` bigint unsigned NOT NULL,
	`is_primary` boolean NOT NULL DEFAULT false,
	`origin` varchar(16) NOT NULL DEFAULT 'source',
	CONSTRAINT `entity_categories_entity_id_category_id_pk` PRIMARY KEY(`entity_id`,`category_id`)
);
--> statement-breakpoint
CREATE TABLE `entity_links` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`entity_id` bigint unsigned NOT NULL,
	`type` varchar(24) NOT NULL,
	`url` varchar(2048) NOT NULL,
	`url_hash` char(64) NOT NULL,
	`label` varchar(255),
	`origin` varchar(16) NOT NULL DEFAULT 'source',
	`source_id` varchar(32),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `entity_links_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_entity_links_url` UNIQUE(`entity_id`,`type`,`url_hash`)
);
--> statement-breakpoint
CREATE TABLE `entity_list_items` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`entity_id` bigint unsigned NOT NULL,
	`list` varchar(24) NOT NULL,
	`locale` varchar(8) NOT NULL,
	`position` smallint NOT NULL,
	`text` varchar(1024) NOT NULL,
	`origin` varchar(16) NOT NULL DEFAULT 'source',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `entity_list_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_entity_list_items_pos` UNIQUE(`entity_id`,`list`,`locale`,`position`)
);
--> statement-breakpoint
CREATE TABLE `entity_media` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`entity_id` bigint unsigned NOT NULL,
	`type` varchar(16) NOT NULL,
	`url` varchar(2048) NOT NULL,
	`url_hash` char(64) NOT NULL,
	`width` smallint unsigned,
	`height` smallint unsigned,
	`position` smallint NOT NULL DEFAULT 0,
	`origin` varchar(16) NOT NULL DEFAULT 'source',
	`source_id` varchar(32),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `entity_media_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_entity_media_url` UNIQUE(`entity_id`,`type`,`url_hash`)
);
--> statement-breakpoint
CREATE TABLE `entity_metrics` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`entity_id` bigint unsigned NOT NULL,
	`metric` varchar(32) NOT NULL,
	`period` varchar(8) NOT NULL DEFAULT 'total',
	`source_id` varchar(32) NOT NULL,
	`observed_on` date NOT NULL,
	`value` bigint unsigned NOT NULL,
	CONSTRAINT `entity_metrics_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_entity_metrics_point` UNIQUE(`entity_id`,`metric`,`source_id`,`period`,`observed_on`)
);
--> statement-breakpoint
CREATE TABLE `entity_platforms` (
	`entity_id` bigint unsigned NOT NULL,
	`platform` varchar(16) NOT NULL,
	CONSTRAINT `entity_platforms_entity_id_platform_pk` PRIMARY KEY(`entity_id`,`platform`)
);
--> statement-breakpoint
CREATE TABLE `entity_relations` (
	`entity_id` bigint unsigned NOT NULL,
	`related_entity_id` bigint unsigned NOT NULL,
	`relation` varchar(24) NOT NULL,
	`score` decimal(6,4),
	`origin` varchar(16) NOT NULL DEFAULT 'source',
	`source_id` varchar(32),
	CONSTRAINT `entity_relations_entity_id_related_entity_id_relation_pk` PRIMARY KEY(`entity_id`,`related_entity_id`,`relation`)
);
--> statement-breakpoint
CREATE TABLE `entity_sources` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`entity_id` bigint unsigned NOT NULL,
	`source_id` varchar(32) NOT NULL,
	`kind` varchar(16) NOT NULL,
	`external_id` varchar(255) NOT NULL,
	`url` varchar(1024),
	`is_primary` boolean NOT NULL DEFAULT false,
	`first_seen_at` datetime(3),
	`last_seen_at` datetime(3),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `entity_sources_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_entity_sources_external` UNIQUE(`source_id`,`kind`,`external_id`)
);
--> statement-breakpoint
CREATE TABLE `entity_tags` (
	`entity_id` bigint unsigned NOT NULL,
	`tag_id` bigint unsigned NOT NULL,
	`origin` varchar(16) NOT NULL DEFAULT 'source',
	`source_id` varchar(32),
	CONSTRAINT `entity_tags_entity_id_tag_id_pk` PRIMARY KEY(`entity_id`,`tag_id`)
);
--> statement-breakpoint
CREATE TABLE `entity_texts` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`entity_id` bigint unsigned NOT NULL,
	`field` varchar(24) NOT NULL,
	`locale` varchar(8) NOT NULL,
	`content` mediumtext NOT NULL,
	`format` varchar(16) NOT NULL DEFAULT 'plain',
	`origin` varchar(16) NOT NULL DEFAULT 'source',
	`source_id` varchar(32),
	`model` varchar(64),
	`content_hash` char(64) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `entity_texts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_entity_texts_field_locale` UNIQUE(`entity_id`,`field`,`locale`)
);
--> statement-breakpoint
CREATE TABLE `loop_details` (
	`entity_id` bigint unsigned NOT NULL,
	`loop_type` varchar(16),
	`max_iterations` smallint unsigned,
	`interval_seconds` int unsigned,
	`check_command` varchar(1024),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `loop_details_entity_id` PRIMARY KEY(`entity_id`)
);
--> statement-breakpoint
CREATE TABLE `loop_steps` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`entity_id` bigint unsigned NOT NULL,
	`locale` varchar(8) NOT NULL,
	`position` smallint NOT NULL,
	`title` varchar(255) NOT NULL,
	`body` text,
	`origin` varchar(16) NOT NULL DEFAULT 'source',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `loop_steps_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_loop_steps_pos` UNIQUE(`entity_id`,`locale`,`position`)
);
--> statement-breakpoint
CREATE TABLE `loop_supported_agents` (
	`entity_id` bigint unsigned NOT NULL,
	`agent_name` varchar(128) NOT NULL,
	`agent_entity_id` bigint unsigned,
	`is_active` boolean NOT NULL DEFAULT true,
	CONSTRAINT `loop_supported_agents_entity_id_agent_name_pk` PRIMARY KEY(`entity_id`,`agent_name`)
);
--> statement-breakpoint
CREATE TABLE `repositories` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`host` varchar(64) NOT NULL,
	`owner` varchar(128) NOT NULL,
	`name` varchar(128) NOT NULL,
	`owner_author_id` bigint unsigned,
	`description` text,
	`homepage` varchar(1024),
	`default_branch` varchar(128),
	`primary_language` varchar(64),
	`license_spdx` varchar(64),
	`stars` int unsigned,
	`forks` int unsigned,
	`watchers` int unsigned,
	`open_issues` int unsigned,
	`is_archived` boolean NOT NULL DEFAULT false,
	`is_fork` boolean NOT NULL DEFAULT false,
	`repo_created_at` datetime(3),
	`pushed_at` datetime(3),
	`last_commit_at` datetime(3),
	`synced_at` datetime(3),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `repositories_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_repositories_host_owner_name` UNIQUE(`host`,`owner`,`name`)
);
--> statement-breakpoint
CREATE TABLE `repository_topics` (
	`repository_id` bigint unsigned NOT NULL,
	`topic` varchar(64) NOT NULL,
	CONSTRAINT `repository_topics_repository_id_topic_pk` PRIMARY KEY(`repository_id`,`topic`)
);
--> statement-breakpoint
CREATE TABLE `server_details` (
	`entity_id` bigint unsigned NOT NULL,
	`is_remote` boolean NOT NULL DEFAULT false,
	`runtime` varchar(16),
	`auth_type` varchar(16),
	`version` varchar(64),
	`registry_name` varchar(255),
	`protocol_version` varchar(16),
	`tools_count` smallint unsigned NOT NULL DEFAULT 0,
	`prompts_count` smallint unsigned NOT NULL DEFAULT 0,
	`resources_count` smallint unsigned NOT NULL DEFAULT 0,
	`probed_at` datetime(3),
	`probe_status` varchar(16),
	`probe_error` varchar(512),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `server_details_entity_id` PRIMARY KEY(`entity_id`),
	CONSTRAINT `uq_server_details_registry_name` UNIQUE(`registry_name`)
);
--> statement-breakpoint
CREATE TABLE `server_env_vars` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`entity_id` bigint unsigned NOT NULL,
	`package_id` bigint unsigned,
	`name` varchar(128) NOT NULL,
	`description` text,
	`is_required` boolean NOT NULL DEFAULT false,
	`is_secret` boolean NOT NULL DEFAULT false,
	`default_value` varchar(1024),
	`format` varchar(32),
	`origin` varchar(16) NOT NULL DEFAULT 'source',
	`source_id` varchar(32),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `server_env_vars_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_server_env_vars` UNIQUE(`entity_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `server_package_arguments` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`package_id` bigint unsigned NOT NULL,
	`scope` varchar(8) NOT NULL,
	`arg_type` varchar(12) NOT NULL,
	`name` varchar(128),
	`value` varchar(1024),
	`value_hint` varchar(128),
	`description` text,
	`is_required` boolean NOT NULL DEFAULT false,
	`is_repeated` boolean NOT NULL DEFAULT false,
	`position` smallint NOT NULL DEFAULT 0,
	CONSTRAINT `server_package_arguments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `server_packages` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`entity_id` bigint unsigned NOT NULL,
	`registry_type` varchar(16) NOT NULL,
	`identifier` varchar(255) NOT NULL,
	`version` varchar(64),
	`runtime_hint` varchar(32),
	`transport` varchar(24),
	`registry_base_url` varchar(255),
	`file_sha256` char(64),
	`origin` varchar(16) NOT NULL DEFAULT 'source',
	`source_id` varchar(32),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `server_packages_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_server_packages` UNIQUE(`entity_id`,`registry_type`,`identifier`)
);
--> statement-breakpoint
CREATE TABLE `server_prompt_arguments` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`prompt_id` bigint unsigned NOT NULL,
	`name` varchar(128) NOT NULL,
	`description` text,
	`is_required` boolean NOT NULL DEFAULT false,
	`position` smallint NOT NULL DEFAULT 0,
	CONSTRAINT `server_prompt_arguments_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_server_prompt_arguments` UNIQUE(`prompt_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `server_prompts` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`entity_id` bigint unsigned NOT NULL,
	`name` varchar(128) NOT NULL,
	`title` varchar(255),
	`description` text,
	`position` smallint NOT NULL DEFAULT 0,
	`origin` varchar(16) NOT NULL DEFAULT 'source',
	`fetched_at` datetime(3),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `server_prompts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_server_prompts_name` UNIQUE(`entity_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `server_remote_headers` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`remote_id` bigint unsigned NOT NULL,
	`name` varchar(128) NOT NULL,
	`description` text,
	`is_required` boolean NOT NULL DEFAULT false,
	`is_secret` boolean NOT NULL DEFAULT false,
	`value_hint` varchar(255),
	CONSTRAINT `server_remote_headers_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_server_remote_headers` UNIQUE(`remote_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `server_remotes` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`entity_id` bigint unsigned NOT NULL,
	`transport` varchar(24) NOT NULL,
	`url` varchar(2048) NOT NULL,
	`url_hash` char(64) NOT NULL,
	`auth_type` varchar(16),
	`is_primary` boolean NOT NULL DEFAULT false,
	`origin` varchar(16) NOT NULL DEFAULT 'source',
	`source_id` varchar(32),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `server_remotes_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_server_remotes_url` UNIQUE(`entity_id`,`url_hash`)
);
--> statement-breakpoint
CREATE TABLE `server_resources` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`entity_id` bigint unsigned NOT NULL,
	`uri` varchar(2048) NOT NULL,
	`uri_hash` char(64) NOT NULL,
	`name` varchar(255),
	`title` varchar(255),
	`description` text,
	`mime_type` varchar(128),
	`is_template` boolean NOT NULL DEFAULT false,
	`position` smallint NOT NULL DEFAULT 0,
	`origin` varchar(16) NOT NULL DEFAULT 'source',
	`fetched_at` datetime(3),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `server_resources_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_server_resources_uri` UNIQUE(`entity_id`,`uri_hash`)
);
--> statement-breakpoint
CREATE TABLE `server_tool_params` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`tool_id` bigint unsigned NOT NULL,
	`path` varchar(255) NOT NULL,
	`name` varchar(128) NOT NULL,
	`depth` tinyint unsigned NOT NULL DEFAULT 0,
	`json_type` varchar(64),
	`description` text,
	`is_required` boolean NOT NULL DEFAULT false,
	`enum_values` json,
	`default_value` json,
	`position` smallint NOT NULL DEFAULT 0,
	CONSTRAINT `server_tool_params_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_server_tool_params_path` UNIQUE(`tool_id`,`path`)
);
--> statement-breakpoint
CREATE TABLE `server_tools` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`entity_id` bigint unsigned NOT NULL,
	`name` varchar(128) NOT NULL,
	`title` varchar(255),
	`description` text,
	`input_schema` json,
	`output_schema` json,
	`annotations` json,
	`hint_read_only` boolean,
	`hint_destructive` boolean,
	`hint_idempotent` boolean,
	`hint_open_world` boolean,
	`position` smallint NOT NULL DEFAULT 0,
	`origin` varchar(16) NOT NULL DEFAULT 'source',
	`source_id` varchar(32),
	`fetched_at` datetime(3),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `server_tools_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_server_tools_name` UNIQUE(`entity_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `server_transports` (
	`entity_id` bigint unsigned NOT NULL,
	`transport` varchar(24) NOT NULL,
	CONSTRAINT `server_transports_entity_id_transport_pk` PRIMARY KEY(`entity_id`,`transport`)
);
--> statement-breakpoint
CREATE TABLE `skill_details` (
	`entity_id` bigint unsigned NOT NULL,
	`canonical_key` varchar(255),
	`skill_slug` varchar(128),
	`skill_path` varchar(512),
	`install_command` varchar(1024),
	`first_seen_on` date,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `skill_details_entity_id` PRIMARY KEY(`entity_id`),
	CONSTRAINT `uq_skill_details_canonical_key` UNIQUE(`canonical_key`)
);
--> statement-breakpoint
CREATE TABLE `skill_security_audits` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`entity_id` bigint unsigned NOT NULL,
	`auditor` varchar(128) NOT NULL,
	`result` varchar(16) NOT NULL,
	`audited_at` datetime(3),
	`url` varchar(1024),
	`origin` varchar(16) NOT NULL DEFAULT 'source',
	`source_id` varchar(32),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `skill_security_audits_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_skill_security_audits` UNIQUE(`entity_id`,`auditor`)
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`slug` varchar(64) NOT NULL,
	`name` varchar(128) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tags_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_tags_slug` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `ingest_documents` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`target_id` bigint unsigned NOT NULL,
	`run_id` bigint unsigned,
	`requested_url` varchar(2048) NOT NULL,
	`final_url` varchar(2048) NOT NULL,
	`http_status` smallint unsigned NOT NULL,
	`content_type` varchar(128),
	`bytes` int unsigned NOT NULL DEFAULT 0,
	`content_hash` char(64),
	`blob_key` varchar(512),
	`not_modified` boolean NOT NULL DEFAULT false,
	`duration_ms` int unsigned,
	`fetched_at` datetime(3) NOT NULL,
	CONSTRAINT `ingest_documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ingest_drafts` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`record_id` bigint unsigned NOT NULL,
	`source_id` varchar(32) NOT NULL,
	`kind` varchar(16) NOT NULL,
	`external_id` varchar(255) NOT NULL,
	`identity_key` varchar(255),
	`mapper_version` smallint unsigned NOT NULL,
	`draft_hash` char(64) NOT NULL,
	`draft` json NOT NULL,
	`entity_id` bigint unsigned,
	`mapped_at` datetime(3) NOT NULL,
	`published_at` datetime(3),
	CONSTRAINT `ingest_drafts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_ingest_drafts_record` UNIQUE(`record_id`)
);
--> statement-breakpoint
CREATE TABLE `ingest_enrichments` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`enricher` varchar(32) NOT NULL,
	`subject_key` varchar(255) NOT NULL,
	`status` varchar(16) NOT NULL,
	`http_status` smallint unsigned,
	`etag` varchar(255),
	`content_hash` char(64),
	`data` json,
	`error` varchar(1024),
	`fetched_at` datetime(3) NOT NULL,
	`expires_at` datetime(3),
	CONSTRAINT `ingest_enrichments_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_ingest_enrichments_subject` UNIQUE(`enricher`,`subject_key`)
);
--> statement-breakpoint
CREATE TABLE `ingest_issues` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`draft_id` bigint unsigned NOT NULL,
	`source_id` varchar(32) NOT NULL,
	`kind` varchar(16) NOT NULL,
	`external_id` varchar(255) NOT NULL,
	`code` varchar(48) NOT NULL,
	`detail` varchar(1024),
	`run_id` bigint unsigned,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `ingest_issues_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ingest_records` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`source_id` varchar(32) NOT NULL,
	`kind` varchar(16) NOT NULL,
	`external_id` varchar(255) NOT NULL,
	`target_id` bigint unsigned,
	`url` varchar(2048) NOT NULL,
	`parser_version` smallint unsigned NOT NULL,
	`content_hash` char(64) NOT NULL,
	`data` json NOT NULL,
	`fetched_at` datetime(3) NOT NULL,
	`parsed_at` datetime(3) NOT NULL,
	`changed_at` datetime(3) NOT NULL,
	CONSTRAINT `ingest_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_ingest_records_external` UNIQUE(`source_id`,`kind`,`external_id`)
);
--> statement-breakpoint
CREATE TABLE `ingest_runs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`source_id` varchar(32) NOT NULL,
	`command` varchar(16) NOT NULL,
	`options` json,
	`status` varchar(16) NOT NULL DEFAULT 'running',
	`targets_discovered` int unsigned NOT NULL DEFAULT 0,
	`targets_skipped` int unsigned NOT NULL DEFAULT 0,
	`docs_fetched` int unsigned NOT NULL DEFAULT 0,
	`docs_not_modified` int unsigned NOT NULL DEFAULT 0,
	`docs_unchanged` int unsigned NOT NULL DEFAULT 0,
	`records_parsed` int unsigned NOT NULL DEFAULT 0,
	`drafts_mapped` int unsigned NOT NULL DEFAULT 0,
	`failures` int unsigned NOT NULL DEFAULT 0,
	`error` text,
	`host` varchar(128),
	`pid` int unsigned,
	`started_at` datetime(3) NOT NULL,
	`finished_at` datetime(3),
	CONSTRAINT `ingest_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ingest_sources` (
	`id` varchar(32) NOT NULL,
	`name` varchar(128) NOT NULL,
	`homepage` varchar(512) NOT NULL,
	`is_enabled` boolean NOT NULL DEFAULT true,
	`politeness` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ingest_sources_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ingest_targets` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`source_id` varchar(32) NOT NULL,
	`kind` varchar(16) NOT NULL,
	`external_id` varchar(255) NOT NULL,
	`url` varchar(2048) NOT NULL,
	`url_hash` char(64) NOT NULL,
	`sitemap_lastmod` datetime(3),
	`priority` smallint NOT NULL DEFAULT 0,
	`state` varchar(16) NOT NULL DEFAULT 'pending',
	`http_status` smallint unsigned,
	`etag` varchar(255),
	`last_modified` varchar(64),
	`content_hash` char(64),
	`fail_count` smallint unsigned NOT NULL DEFAULT 0,
	`last_error` varchar(1024),
	`discovered_at` datetime(3) NOT NULL,
	`last_seen_at` datetime(3) NOT NULL,
	`fetched_at` datetime(3),
	`next_fetch_at` datetime(3),
	`locked_by` varchar(64),
	`locked_until` datetime(3),
	`last_run_id` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ingest_targets_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_ingest_targets_url` UNIQUE(`source_id`,`url_hash`),
	CONSTRAINT `uq_ingest_targets_external` UNIQUE(`source_id`,`kind`,`external_id`)
);
--> statement-breakpoint
ALTER TABLE `agent_details` ADD CONSTRAINT `agent_details_entity_id_entities_id_fk` FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `categories` ADD CONSTRAINT `categories_parent_id_categories_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cli_details` ADD CONSTRAINT `cli_details_entity_id_entities_id_fk` FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cli_examples` ADD CONSTRAINT `cli_examples_entity_id_entities_id_fk` FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cli_install_methods` ADD CONSTRAINT `cli_install_methods_entity_id_entities_id_fk` FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `client_capabilities` ADD CONSTRAINT `client_capabilities_entity_id_entities_id_fk` FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `client_details` ADD CONSTRAINT `client_details_entity_id_entities_id_fk` FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `entities` ADD CONSTRAINT `entities_primary_category_id_categories_id_fk` FOREIGN KEY (`primary_category_id`) REFERENCES `categories`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `entities` ADD CONSTRAINT `entities_repository_id_repositories_id_fk` FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `entity_aliases` ADD CONSTRAINT `entity_aliases_entity_id_entities_id_fk` FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `entity_authors` ADD CONSTRAINT `entity_authors_entity_id_entities_id_fk` FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `entity_authors` ADD CONSTRAINT `entity_authors_author_id_authors_id_fk` FOREIGN KEY (`author_id`) REFERENCES `authors`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `entity_categories` ADD CONSTRAINT `entity_categories_entity_id_entities_id_fk` FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `entity_categories` ADD CONSTRAINT `entity_categories_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `entity_links` ADD CONSTRAINT `entity_links_entity_id_entities_id_fk` FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `entity_list_items` ADD CONSTRAINT `entity_list_items_entity_id_entities_id_fk` FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `entity_media` ADD CONSTRAINT `entity_media_entity_id_entities_id_fk` FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `entity_metrics` ADD CONSTRAINT `entity_metrics_entity_id_entities_id_fk` FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `entity_platforms` ADD CONSTRAINT `entity_platforms_entity_id_entities_id_fk` FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `entity_relations` ADD CONSTRAINT `entity_relations_entity_id_entities_id_fk` FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `entity_relations` ADD CONSTRAINT `entity_relations_related_entity_id_entities_id_fk` FOREIGN KEY (`related_entity_id`) REFERENCES `entities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `entity_sources` ADD CONSTRAINT `entity_sources_entity_id_entities_id_fk` FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `entity_tags` ADD CONSTRAINT `entity_tags_entity_id_entities_id_fk` FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `entity_tags` ADD CONSTRAINT `entity_tags_tag_id_tags_id_fk` FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `entity_texts` ADD CONSTRAINT `entity_texts_entity_id_entities_id_fk` FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loop_details` ADD CONSTRAINT `loop_details_entity_id_entities_id_fk` FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loop_steps` ADD CONSTRAINT `loop_steps_entity_id_entities_id_fk` FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loop_supported_agents` ADD CONSTRAINT `loop_supported_agents_entity_id_entities_id_fk` FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loop_supported_agents` ADD CONSTRAINT `loop_supported_agents_agent_entity_id_entities_id_fk` FOREIGN KEY (`agent_entity_id`) REFERENCES `entities`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `repositories` ADD CONSTRAINT `repositories_owner_author_id_authors_id_fk` FOREIGN KEY (`owner_author_id`) REFERENCES `authors`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `repository_topics` ADD CONSTRAINT `repository_topics_repository_id_repositories_id_fk` FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `server_details` ADD CONSTRAINT `server_details_entity_id_entities_id_fk` FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `server_env_vars` ADD CONSTRAINT `server_env_vars_entity_id_entities_id_fk` FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `server_env_vars` ADD CONSTRAINT `server_env_vars_package_id_server_packages_id_fk` FOREIGN KEY (`package_id`) REFERENCES `server_packages`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `server_package_arguments` ADD CONSTRAINT `server_package_arguments_package_id_server_packages_id_fk` FOREIGN KEY (`package_id`) REFERENCES `server_packages`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `server_packages` ADD CONSTRAINT `server_packages_entity_id_entities_id_fk` FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `server_prompt_arguments` ADD CONSTRAINT `server_prompt_arguments_prompt_id_server_prompts_id_fk` FOREIGN KEY (`prompt_id`) REFERENCES `server_prompts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `server_prompts` ADD CONSTRAINT `server_prompts_entity_id_entities_id_fk` FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `server_remote_headers` ADD CONSTRAINT `server_remote_headers_remote_id_server_remotes_id_fk` FOREIGN KEY (`remote_id`) REFERENCES `server_remotes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `server_remotes` ADD CONSTRAINT `server_remotes_entity_id_entities_id_fk` FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `server_resources` ADD CONSTRAINT `server_resources_entity_id_entities_id_fk` FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `server_tool_params` ADD CONSTRAINT `server_tool_params_tool_id_server_tools_id_fk` FOREIGN KEY (`tool_id`) REFERENCES `server_tools`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `server_tools` ADD CONSTRAINT `server_tools_entity_id_entities_id_fk` FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `server_transports` ADD CONSTRAINT `server_transports_entity_id_entities_id_fk` FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `skill_details` ADD CONSTRAINT `skill_details_entity_id_entities_id_fk` FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `skill_security_audits` ADD CONSTRAINT `skill_security_audits_entity_id_entities_id_fk` FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ingest_documents` ADD CONSTRAINT `ingest_documents_target_id_ingest_targets_id_fk` FOREIGN KEY (`target_id`) REFERENCES `ingest_targets`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ingest_documents` ADD CONSTRAINT `ingest_documents_run_id_ingest_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `ingest_runs`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ingest_drafts` ADD CONSTRAINT `ingest_drafts_record_id_ingest_records_id_fk` FOREIGN KEY (`record_id`) REFERENCES `ingest_records`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ingest_drafts` ADD CONSTRAINT `ingest_drafts_source_id_ingest_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `ingest_sources`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ingest_drafts` ADD CONSTRAINT `ingest_drafts_entity_id_entities_id_fk` FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ingest_issues` ADD CONSTRAINT `ingest_issues_draft_id_ingest_drafts_id_fk` FOREIGN KEY (`draft_id`) REFERENCES `ingest_drafts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ingest_issues` ADD CONSTRAINT `ingest_issues_source_id_ingest_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `ingest_sources`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ingest_issues` ADD CONSTRAINT `ingest_issues_run_id_ingest_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `ingest_runs`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ingest_records` ADD CONSTRAINT `ingest_records_source_id_ingest_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `ingest_sources`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ingest_records` ADD CONSTRAINT `ingest_records_target_id_ingest_targets_id_fk` FOREIGN KEY (`target_id`) REFERENCES `ingest_targets`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ingest_runs` ADD CONSTRAINT `ingest_runs_source_id_ingest_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `ingest_sources`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ingest_targets` ADD CONSTRAINT `ingest_targets_source_id_ingest_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `ingest_sources`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ingest_targets` ADD CONSTRAINT `ingest_targets_last_run_id_ingest_runs_id_fk` FOREIGN KEY (`last_run_id`) REFERENCES `ingest_runs`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_cli_details_command` ON `cli_details` (`command`);--> statement-breakpoint
CREATE INDEX `ix_cli_install_methods_manager` ON `cli_install_methods` (`manager`);--> statement-breakpoint
CREATE INDEX `ix_client_capabilities` ON `client_capabilities` (`capability`,`support`);--> statement-breakpoint
CREATE INDEX `ix_entities_kind_status_stars` ON `entities` (`kind`,`status`,`stars`);--> statement-breakpoint
CREATE INDEX `ix_entities_primary_category` ON `entities` (`primary_category_id`);--> statement-breakpoint
CREATE INDEX `ix_entities_repository` ON `entities` (`repository_id`);--> statement-breakpoint
CREATE INDEX `ix_entity_aliases_value` ON `entity_aliases` (`type`,`value`);--> statement-breakpoint
CREATE INDEX `ix_entity_authors_author` ON `entity_authors` (`author_id`);--> statement-breakpoint
CREATE INDEX `ix_entity_categories_category` ON `entity_categories` (`category_id`);--> statement-breakpoint
CREATE INDEX `ix_entity_links_type` ON `entity_links` (`type`);--> statement-breakpoint
CREATE INDEX `ix_entity_metrics_metric_day` ON `entity_metrics` (`metric`,`observed_on`);--> statement-breakpoint
CREATE INDEX `ix_entity_platforms_platform` ON `entity_platforms` (`platform`);--> statement-breakpoint
CREATE INDEX `ix_entity_relations_related` ON `entity_relations` (`related_entity_id`);--> statement-breakpoint
CREATE INDEX `ix_entity_sources_entity` ON `entity_sources` (`entity_id`);--> statement-breakpoint
CREATE INDEX `ix_entity_tags_tag` ON `entity_tags` (`tag_id`);--> statement-breakpoint
CREATE INDEX `ix_repositories_stars` ON `repositories` (`stars`);--> statement-breakpoint
CREATE INDEX `ix_repository_topics_topic` ON `repository_topics` (`topic`);--> statement-breakpoint
CREATE INDEX `ix_server_details_remote` ON `server_details` (`is_remote`);--> statement-breakpoint
CREATE INDEX `ix_server_env_vars_name` ON `server_env_vars` (`name`);--> statement-breakpoint
CREATE INDEX `ix_server_package_arguments_package` ON `server_package_arguments` (`package_id`);--> statement-breakpoint
CREATE INDEX `ix_server_packages_identifier` ON `server_packages` (`registry_type`,`identifier`);--> statement-breakpoint
CREATE INDEX `ix_server_tool_params_name` ON `server_tool_params` (`name`);--> statement-breakpoint
CREATE INDEX `ix_server_tools_name` ON `server_tools` (`name`);--> statement-breakpoint
CREATE INDEX `ix_server_transports_transport` ON `server_transports` (`transport`);--> statement-breakpoint
CREATE INDEX `ix_skill_security_audits_result` ON `skill_security_audits` (`result`);--> statement-breakpoint
CREATE INDEX `ix_ingest_documents_target_time` ON `ingest_documents` (`target_id`,`fetched_at`);--> statement-breakpoint
CREATE INDEX `ix_ingest_documents_run` ON `ingest_documents` (`run_id`);--> statement-breakpoint
CREATE INDEX `ix_ingest_drafts_identity` ON `ingest_drafts` (`identity_key`);--> statement-breakpoint
CREATE INDEX `ix_ingest_drafts_entity` ON `ingest_drafts` (`entity_id`);--> statement-breakpoint
CREATE INDEX `ix_ingest_enrichments_expiry` ON `ingest_enrichments` (`expires_at`);--> statement-breakpoint
CREATE INDEX `ix_ingest_issues_code` ON `ingest_issues` (`code`);--> statement-breakpoint
CREATE INDEX `ix_ingest_issues_external` ON `ingest_issues` (`source_id`,`kind`,`external_id`);--> statement-breakpoint
CREATE INDEX `ix_ingest_runs_source_started` ON `ingest_runs` (`source_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `ix_ingest_targets_queue` ON `ingest_targets` (`state`,`next_fetch_at`);--> statement-breakpoint
CREATE INDEX `ix_ingest_targets_source_kind_state` ON `ingest_targets` (`source_id`,`kind`,`state`);