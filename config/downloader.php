<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Binary paths
    |--------------------------------------------------------------------------
    |
    | Paths to the yt-dlp and ffmpeg executables. By default these point to the
    | binaries bundled inside storage/app/bin. On Linux/macOS you may instead
    | set these to "yt-dlp" / "ffmpeg" if they are installed on the system PATH.
    |
    */

    'ytdlp' => env('YTDLP_PATH', storage_path('app/bin/yt-dlp' . (PHP_OS_FAMILY === 'Windows' ? '.exe' : ''))),

    // Folder that contains ffmpeg / ffprobe. yt-dlp needs this for MP3 extraction
    // and for merging separate video+audio streams into a single MP4.
    'ffmpeg_dir' => env('FFMPEG_DIR', storage_path('app/bin')),

    /*
    |--------------------------------------------------------------------------
    | Temp download directory
    |--------------------------------------------------------------------------
    */

    'tmp_dir' => storage_path('app/downloads'),

    /*
    |--------------------------------------------------------------------------
    | Limits
    |--------------------------------------------------------------------------
    |
    | Max seconds a download is allowed to run before it is aborted.
    |
    */

    'timeout' => (int) env('DOWNLOADER_TIMEOUT', 600),

];
