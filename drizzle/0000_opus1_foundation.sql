CREATE TABLE `generation_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`kind` enum('tts','video','image') NOT NULL,
	`provider` varchar(64) NOT NULL,
	`engine` varchar(64),
	`provider_job_id` varchar(255),
	`status` enum('pending','running','completed','failed') NOT NULL DEFAULT 'pending',
	`input_ref` json,
	`output_url` varchar(1024),
	`provider_output_url` varchar(1024),
	`duration_ms` int,
	`cost_raw_amount` decimal(12,4),
	`cost_raw_unit` varchar(32),
	`cost_usd` decimal(12,6),
	`error` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `generation_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `jopara_lexicon` (
	`id` int AUTO_INCREMENT NOT NULL,
	`term` varchar(255) NOT NULL,
	`language` enum('gn','es','jopara') NOT NULL,
	`ipa` varchar(255),
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `jopara_lexicon_id` PRIMARY KEY(`id`),
	CONSTRAINT `jopara_lexicon_term_lang_idx` UNIQUE(`term`,`language`)
);
--> statement-breakpoint
CREATE TABLE `lexicon_pronunciations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`term_id` int NOT NULL,
	`engine` varchar(64) NOT NULL DEFAULT 'default',
	`speech_form` varchar(255) NOT NULL,
	`verified` boolean NOT NULL DEFAULT false,
	`verified_by` varchar(128),
	`verified_at` timestamp,
	`sample_audio_url` varchar(1024),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `lexicon_pronunciations_id` PRIMARY KEY(`id`),
	CONSTRAINT `lexicon_pron_term_engine_idx` UNIQUE(`term_id`,`engine`)
);
--> statement-breakpoint
CREATE TABLE `listing_media` (
	`id` int AUTO_INCREMENT NOT NULL,
	`listing_id` int NOT NULL,
	`kind` enum('photo','clip') NOT NULL DEFAULT 'photo',
	`url` varchar(1024) NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `listing_media_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `listings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`project_id` int NOT NULL,
	`address` varchar(255) NOT NULL,
	`neighborhood` varchar(128),
	`city` varchar(128),
	`price` decimal(15,2),
	`currency` enum('PYG','USD') NOT NULL DEFAULT 'PYG',
	`rooms` int,
	`bathrooms` int,
	`area_m2` decimal(10,2),
	`features` json,
	`status` enum('draft','available','sold','withdrawn') NOT NULL DEFAULT 'draft',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `listings_id` PRIMARY KEY(`id`),
	CONSTRAINT `listings_project_idx` UNIQUE(`project_id`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`kind` enum('listing','content_item') NOT NULL DEFAULT 'listing',
	`title` varchar(255) NOT NULL,
	`status` enum('draft','active','archived') NOT NULL DEFAULT 'draft',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `projects_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `provider_rates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`provider` varchar(64) NOT NULL,
	`unit` varchar(32) NOT NULL,
	`usd_per_unit` decimal(12,6) NOT NULL,
	`plan_label` varchar(64),
	`effective_from` timestamp NOT NULL DEFAULT (now()),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `provider_rates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `script_lines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`script_id` int NOT NULL,
	`line_number` int NOT NULL,
	`display_text` text NOT NULL,
	`speech_text` text NOT NULL,
	`provisional` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `script_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `script_lines_script_no_idx` UNIQUE(`script_id`,`line_number`)
);
--> statement-breakpoint
CREATE TABLE `scripts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`project_id` int NOT NULL,
	`language` enum('es','gn') NOT NULL,
	`status` enum('draft','approved') NOT NULL DEFAULT 'draft',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `scripts_id` PRIMARY KEY(`id`),
	CONSTRAINT `scripts_project_lang_idx` UNIQUE(`project_id`,`language`)
);
--> statement-breakpoint
CREATE TABLE `unresolved_terms` (
	`id` int AUTO_INCREMENT NOT NULL,
	`term` varchar(255) NOT NULL,
	`language` enum('gn','es','jopara') NOT NULL,
	`script_line_id` int,
	`occurrences` int NOT NULL DEFAULT 1,
	`status` enum('open','promoted','ignored') NOT NULL DEFAULT 'open',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `unresolved_terms_id` PRIMARY KEY(`id`),
	CONSTRAINT `unresolved_terms_term_lang_idx` UNIQUE(`term`,`language`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(255) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`role` enum('admin') NOT NULL DEFAULT 'admin',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_idx` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `videos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`project_id` int NOT NULL,
	`language` enum('es','gn') NOT NULL,
	`voice_id` int,
	`script_id` int,
	`aspect` enum('9:16','16:9') NOT NULL DEFAULT '9:16',
	`status` enum('pending','rendering','completed','failed') NOT NULL DEFAULT 'pending',
	`final_video_url` varchar(1024),
	`total_cost_usd` decimal(12,6),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `videos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `voices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`provider` varchar(64) NOT NULL,
	`provider_voice_id` varchar(255) NOT NULL,
	`engine` varchar(64) NOT NULL,
	`provider_params` json,
	`language` enum('es','gn','multi') NOT NULL DEFAULT 'multi',
	`label` varchar(128) NOT NULL,
	`sample_url` varchar(1024),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `voices_id` PRIMARY KEY(`id`),
	CONSTRAINT `voices_provider_voice_engine_idx` UNIQUE(`provider`,`provider_voice_id`,`engine`)
);
--> statement-breakpoint
ALTER TABLE `lexicon_pronunciations` ADD CONSTRAINT `lexicon_pronunciations_term_id_jopara_lexicon_id_fk` FOREIGN KEY (`term_id`) REFERENCES `jopara_lexicon`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `listing_media` ADD CONSTRAINT `listing_media_listing_id_listings_id_fk` FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `listings` ADD CONSTRAINT `listings_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `script_lines` ADD CONSTRAINT `script_lines_script_id_scripts_id_fk` FOREIGN KEY (`script_id`) REFERENCES `scripts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scripts` ADD CONSTRAINT `scripts_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `unresolved_terms` ADD CONSTRAINT `unresolved_terms_script_line_id_script_lines_id_fk` FOREIGN KEY (`script_line_id`) REFERENCES `script_lines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `videos` ADD CONSTRAINT `videos_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `videos` ADD CONSTRAINT `videos_voice_id_voices_id_fk` FOREIGN KEY (`voice_id`) REFERENCES `voices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `videos` ADD CONSTRAINT `videos_script_id_scripts_id_fk` FOREIGN KEY (`script_id`) REFERENCES `scripts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `generation_jobs_kind_status_idx` ON `generation_jobs` (`kind`,`status`);--> statement-breakpoint
CREATE INDEX `generation_jobs_provider_idx` ON `generation_jobs` (`provider`);--> statement-breakpoint
CREATE INDEX `listing_media_listing_idx` ON `listing_media` (`listing_id`);--> statement-breakpoint
CREATE INDEX `projects_kind_status_idx` ON `projects` (`kind`,`status`);--> statement-breakpoint
CREATE INDEX `provider_rates_lookup_idx` ON `provider_rates` (`provider`,`unit`,`effective_from`);--> statement-breakpoint
CREATE INDEX `unresolved_terms_status_idx` ON `unresolved_terms` (`status`);--> statement-breakpoint
CREATE INDEX `videos_project_lang_idx` ON `videos` (`project_id`,`language`);