CREATE TABLE `agents` (
	`session` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`pi_session` text NOT NULL,
	`url` text NOT NULL,
	`bound_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`session`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`n` integer NOT NULL,
	`action` text NOT NULL,
	`author` text NOT NULL,
	`body` text NOT NULL,
	`images` text,
	`status` text,
	`at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `blocks_document_id` ON `blocks` (`document_id`);--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`doc` text NOT NULL,
	`anchor_kind` text NOT NULL,
	`quote` text,
	`body` text NOT NULL,
	`images` text,
	`author` text NOT NULL,
	`created_at` text NOT NULL,
	`edited_at` text,
	`status` text NOT NULL,
	`resolved_at` text,
	`resolved_by` text,
	`reopened_at` text,
	`reopened_by` text,
	`block_id` text,
	`block_rev` integer,
	`replies` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `comments_document_id_doc` ON `comments` (`document_id`,`doc`);--> statement-breakpoint
CREATE INDEX `comments_status` ON `comments` (`status`);--> statement-breakpoint
CREATE TABLE `content_block_revs` (
	`block_id` text NOT NULL,
	`rev` integer NOT NULL,
	`text` text NOT NULL,
	`plain` text NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`block_id`) REFERENCES `content_blocks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `content_block_revs_block` ON `content_block_revs` (`block_id`);--> statement-breakpoint
CREATE TABLE `content_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`n` integer NOT NULL,
	`grp` integer NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`plain` text NOT NULL,
	`hash` text NOT NULL,
	`rev` integer NOT NULL,
	`updated_rev` integer NOT NULL,
	`deleted_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `content_blocks_document_id` ON `content_blocks` (`document_id`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text,
	`created_at` text NOT NULL,
	`opened_at` text NOT NULL,
	`kind` text,
	`closed_at` text,
	`body` text,
	`title` text,
	`sections` integer,
	`diagrams` integer,
	`branch` text,
	`detached` integer,
	`repo_name` text,
	`repo_root` text,
	`rel_path` text,
	`worktree_name` text,
	`worktree_path` text,
	`project_name` text,
	`project_root` text,
	`src_mtime` integer,
	`src_size` integer,
	`indexed_at` text,
	`body_rev` integer
);
--> statement-breakpoint
CREATE TABLE `reading_state` (
	`document_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`progress` real NOT NULL,
	`read_at` text NOT NULL,
	`source_mtime` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`doc` text NOT NULL,
	`round` integer NOT NULL,
	`body` text NOT NULL,
	`author` text NOT NULL,
	`created_at` text NOT NULL,
	`verdict` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reviews_document_id` ON `reviews` (`document_id`);