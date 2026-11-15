-- ---------------------------------------------------------------------------
-- MediaGrab — library_items
-- ---------------------------------------------------------------------------
-- One row per saved download. The FILE itself still lives on disk under
-- storage/app/library/<folder>/<filename>; this table only carries the
-- metadata that the filename cannot hold — where it came from, which seconds
-- were kept, whether it was muted.
--
-- Run it against the `video` database:
--     mysql -u root video < database/sql/library_items.sql
-- ...or paste the whole file into phpMyAdmin / Workbench / HeidiSQL.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `library_items` (
    `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    -- Who saved it. NULL = saved by a guest (the download page needs no login
    -- today, so every row will be NULL until you put auth in front of it).
    `user_id`       BIGINT UNSIGNED NULL DEFAULT NULL,

    -- Where it sits on disk. Together these two are the file's address, so
    -- they are unique as a pair.
    `folder`        VARCHAR(100)    NOT NULL,
    `filename`      VARCHAR(255)    NOT NULL,

    -- Where it came from.
    `source_url`    TEXT            NULL DEFAULT NULL,
    `title`         VARCHAR(255)    NULL DEFAULT NULL,
    `uploader`      VARCHAR(255)    NULL DEFAULT NULL,
    `thumbnail`     TEXT            NULL DEFAULT NULL,
    `extractor`     VARCHAR(60)     NULL DEFAULT NULL,

    -- What was done to it. start/end are seconds from the start of the
    -- SOURCE; both NULL means the whole thing was kept.
    `format`        ENUM('video','audio') NOT NULL DEFAULT 'video',
    `start_second`  INT UNSIGNED    NULL DEFAULT NULL,
    `end_second`    INT UNSIGNED    NULL DEFAULT NULL,
    `muted`         TINYINT(1)      NOT NULL DEFAULT 0,
    `banner`        TINYINT(1)      NOT NULL DEFAULT 0,
    `voice`         VARCHAR(20)     NOT NULL DEFAULT 'none',

    -- The file as saved.
    `bytes`         BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `duration`      INT UNSIGNED    NULL DEFAULT NULL,

    `created_at`    TIMESTAMP       NULL DEFAULT NULL,
    `updated_at`    TIMESTAMP       NULL DEFAULT NULL,

    PRIMARY KEY (`id`),
    UNIQUE KEY `library_items_folder_filename_unique` (`folder`, `filename`),
    KEY `library_items_user_id_index` (`user_id`),
    KEY `library_items_folder_index` (`folder`),
    KEY `library_items_created_at_index` (`created_at`),

    CONSTRAINT `library_items_user_id_foreign`
        FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
        ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;
