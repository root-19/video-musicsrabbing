<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class DownloadController extends Controller
{
    /**
     * Fetch lightweight metadata for a URL (title, thumbnail, duration, etc.)
     * so the frontend can show a preview before downloading.
     */
    public function info(Request $request)
    {
        $data = $request->validate([
            'url' => ['required', 'url', 'max:2048'],
        ]);

        $result = Process::timeout(60)->env($this->procEnv())->run([
            $this->ytdlp(),
            '--no-playlist',
            '--no-warnings',
            '-J', // dump single JSON object
            $data['url'],
        ]);

        if (! $result->successful()) {
            return response()->json([
                'message' => 'Could not read that link. Make sure it is a valid, public video or audio URL.',
                'error' => $this->cleanError($result->errorOutput()),
            ], 422);
        }

        $meta = json_decode($result->output(), true) ?: [];

        return response()->json([
            'title' => $meta['title'] ?? 'Untitled',
            'uploader' => $meta['uploader'] ?? $meta['channel'] ?? null,
            'thumbnail' => $meta['thumbnail'] ?? null,
            'duration' => $meta['duration'] ?? null,
            'extractor' => $meta['extractor_key'] ?? null,
        ]);
    }

    /**
     * Download the media and stream the resulting file back to the browser.
     */
    public function download(Request $request): BinaryFileResponse
    {
        $data = $request->validate([
            'url' => ['required', 'url', 'max:2048'],
            'format' => ['required', 'in:video,audio'],
        ]);

        $this->sweepOldFiles();

        // Unique working directory for this request.
        $workDir = rtrim(config('downloader.tmp_dir'), '/\\') . DIRECTORY_SEPARATOR . Str::random(24);
        if (! is_dir($workDir)) {
            mkdir($workDir, 0775, true);
        }

        $output = $workDir . DIRECTORY_SEPARATOR . '%(title).150B.%(ext)s';

        $command = [
            $this->ytdlp(),
            '--no-playlist',
            '--no-warnings',
            '--no-part',
            '--restrict-filenames',
            '--ffmpeg-location', config('downloader.ffmpeg_dir'),
            '-o', $output,
        ];

        if ($data['format'] === 'audio') {
            // Extract best audio and convert to MP3 (requires ffmpeg).
            array_push($command, '-x', '--audio-format', 'mp3', '--audio-quality', '0');
        } else {
            // Prefer widely-compatible H.264 video + AAC audio so the merged MP4
            // plays everywhere (phones, Windows Media Player, all browsers).
            // Falling back to av1/opus/webm can leave players unable to decode the
            // audio track — it plays as a "silent" video even though audio exists.
            array_push(
                $command,
                '-f',
                'bv*[vcodec^=avc1]+ba[acodec^=mp4a]/b[ext=mp4]/bv*+ba/b',
                '--merge-output-format',
                'mp4',
            );
        }

        $command[] = $data['url'];

        $result = Process::timeout(config('downloader.timeout'))->env($this->procEnv())->run($command);

        if (! $result->successful()) {
            $this->rmdir($workDir);
            abort(422, 'Download failed: ' . $this->cleanError($result->errorOutput()));
        }

        // Locate the file yt-dlp produced.
        $files = array_values(array_filter(
            glob($workDir . DIRECTORY_SEPARATOR . '*') ?: [],
            'is_file'
        ));

        if (empty($files)) {
            $this->rmdir($workDir);
            abort(422, 'The download completed but no file was produced.');
        }

        $file = $files[0];

        return response()
            ->download($file, basename($file))
            ->deleteFileAfterSend(true);
    }

    /**
     * Absolute path to the yt-dlp binary; abort with a helpful message if missing.
     */
    protected function ytdlp(): string
    {
        $path = config('downloader.ytdlp');

        if (! is_file($path) && ! $this->onPath($path)) {
            abort(500, 'yt-dlp is not installed. Expected it at: ' . $path);
        }

        return $path;
    }

    protected function onPath(string $bin): bool
    {
        // Allows using a bare "yt-dlp" that lives on the system PATH.
        return ! str_contains($bin, DIRECTORY_SEPARATOR);
    }

    /**
     * Environment for the yt-dlp process.
     *
     * The Windows build of yt-dlp is a PyInstaller bundle that unpacks itself
     * into a temp directory and initialises an embedded Python interpreter.
     * When spawned from PHP's built-in server (php artisan serve), Symfony
     * Process does not reliably inherit the Windows environment block, so the
     * bundle fails with "Could not create temporary directory" (no TEMP) or
     * "failed to get random numbers to initialize Python" (no SystemRoot/PATH).
     * We therefore pass the essential Windows variables through explicitly.
     */
    protected function procEnv(): array
    {
        $tmp = storage_path('app/tmp');
        if (! is_dir($tmp)) {
            mkdir($tmp, 0775, true);
        }

        if (PHP_OS_FAMILY !== 'Windows') {
            return ['TMP' => $tmp, 'TEMP' => $tmp, 'TMPDIR' => $tmp];
        }

        $env = [
            'TMP' => $tmp,
            'TEMP' => $tmp,
            'TMPDIR' => $tmp,
        ];

        // Forward the core Windows variables the embedded Python needs.
        foreach (['SystemRoot', 'SystemDrive', 'windir', 'PATH', 'PATHEXT', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'USERPROFILE'] as $key) {
            $value = getenv($key);
            if ($value !== false && $value !== '') {
                $env[$key] = $value;
            }
        }

        if (empty($env['SystemRoot'])) {
            $env['SystemRoot'] = 'C:\\Windows';
        }

        return $env;
    }

    /**
     * Delete download folders older than one hour to keep storage clean.
     */
    protected function sweepOldFiles(): void
    {
        $base = config('downloader.tmp_dir');
        if (! is_dir($base)) {
            mkdir($base, 0775, true);
            return;
        }

        foreach (glob($base . DIRECTORY_SEPARATOR . '*', GLOB_ONLYDIR) ?: [] as $dir) {
            if (filemtime($dir) < time() - 3600) {
                $this->rmdir($dir);
            }
        }
    }

    protected function rmdir(string $dir): void
    {
        if (! is_dir($dir)) {
            return;
        }
        foreach (glob($dir . DIRECTORY_SEPARATOR . '*') ?: [] as $f) {
            is_dir($f) ? $this->rmdir($f) : @unlink($f);
        }
        @rmdir($dir);
    }

    /**
     * Trim yt-dlp's noisy error output down to something user-friendly.
     */
    protected function cleanError(string $error): string
    {
        $lines = array_filter(array_map('trim', explode("\n", $error)));
        $errLine = collect($lines)->first(fn ($l) => Str::startsWith($l, 'ERROR:'));

        return Str::limit($errLine ?: (end($lines) ?: 'Unknown error'), 300);
    }
}
