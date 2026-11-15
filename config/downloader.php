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

    // youtube-dl (https://github.com/ytdl-org/youtube-dl). When present it is
    // tried FIRST for YouTube links; yt-dlp remains the fallback so a failure
    // in either binary never surfaces to the user unless both fail.
    'youtubedl' => env('YOUTUBEDL_PATH', storage_path('app/bin/youtube-dl' . (PHP_OS_FAMILY === 'Windows' ? '.exe' : ''))),

    // Folder that contains ffmpeg / ffprobe. yt-dlp needs this for MP3 extraction
    // and for merging separate video+audio streams into a single MP4.
    'ffmpeg_dir' => env('FFMPEG_DIR', storage_path('app/bin')),

    /*
    |--------------------------------------------------------------------------
    | Banner / watermark
    |--------------------------------------------------------------------------
    |
    | PNG image that can optionally be overlaid onto downloaded videos (a
    | watermark). It is scaled to a fraction of the video width and placed in
    | the corner the user chooses. Replace public/banner.png with your own art
    | (transparent PNG recommended) or point DOWNLOADER_BANNER elsewhere.
    |
    */

    'banner' => env('DOWNLOADER_BANNER', public_path('banner.png')),

    // Height of the banner footer strip as a fraction of the video height.
    // The banner is stretched to the full video width and this height, then
    // pinned flush to the bottom edge — a wide, short footer bar (not a tall
    // block). 0.12 = 12% of the video height. Tune to taste.
    'banner_height' => (float) env('DOWNLOADER_BANNER_HEIGHT', 0.12),

    /*
    |--------------------------------------------------------------------------
    | Cookies (bot-check bypass)
    |--------------------------------------------------------------------------
    |
    | YouTube (and some other sites) block requests from datacenter/server IPs
    | with "Sign in to confirm you're not a bot". Exporting cookies from a
    | logged-in browser (Netscape cookies.txt format) and pointing here lets
    | yt-dlp authenticate. Use a throwaway account — heavy automated use can get
    | an account flagged. Leave the file absent to run without cookies.
    |
    */

    'cookies' => env('YTDLP_COOKIES', storage_path('app/cookies.txt')),

    /*
    |--------------------------------------------------------------------------
    | Extra extractor arguments
    |--------------------------------------------------------------------------
    |
    | Passed to yt-dlp as --extractor-args. Sometimes selecting a different
    | YouTube player client helps, e.g. "youtube:player_client=default,-web".
    |
    */

    'extractor_args' => env('YTDLP_EXTRACTOR_ARGS', ''),

    /*
    |--------------------------------------------------------------------------
    | Voice.ai text-to-speech (voice-over page)
    |--------------------------------------------------------------------------
    |
    | When an API key is set, the /voice-over page uses the Voice.ai TTS API
    | (natural-sounding voices) to speak the script. Without a key it falls
    | back to the local engine (Windows SAPI / espeak-ng). Voice IDs come from
    | GET https://dev.voice.ai/api/v1/tts/voices.
    |
    */

    'voiceai' => [
        'key' => env('VOICEAI_API_KEY', ''),
        'endpoint' => env('VOICEAI_TTS_ENDPOINT', 'https://dev.voice.ai/api/v1/tts/speech'),
        'voices_endpoint' => env('VOICEAI_VOICES_ENDPOINT', 'https://dev.voice.ai/api/v1/tts/voices'),
        'voices' => [
            'boy' => env('VOICEAI_VOICE_BOY', 'c9530f8a-dcb5-4db3-aed0-690694247a1a'),   // Matt - American Male
            'girl' => env('VOICEAI_VOICE_GIRL', 'e16986bd-1ce9-4c1c-88e7-bbe02b1340d1'), // Alicia - American Female
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Temp download directory
    |--------------------------------------------------------------------------
    */

    'tmp_dir' => storage_path('app/downloads'),

    /*
    |--------------------------------------------------------------------------
    | Saved library directory
    |--------------------------------------------------------------------------
    |
    | Where downloads the user chooses to KEEP on the server are filed away, one
    | sub-directory per folder they create in the UI. Unlike tmp_dir this is
    | never swept — files stay until they are deleted from the library page.
    |
    */

    'library_dir' => env('DOWNLOADER_LIBRARY_DIR', storage_path('app/library')),

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
