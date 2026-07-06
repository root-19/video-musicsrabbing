<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class DownloadController extends Controller
{
    /**
     * Diagnostics endpoint: reports whether everything needed to download is
     * available (proc_open, yt-dlp, ffmpeg, writable temp dir). Open in a
     * browser after deploying to quickly see what is misconfigured.
     */
    public function health()
    {
        $ytdlp = config('downloader.ytdlp');
        $ffmpegDir = config('downloader.ffmpeg_dir');
        $ffmpeg = rtrim($ffmpegDir, '/\\') . DIRECTORY_SEPARATOR . 'ffmpeg' . (PHP_OS_FAMILY === 'Windows' ? '.exe' : '');
        $tmp = storage_path('app/tmp');
        @mkdir($tmp, 0775, true);

        $out = [
            'os' => PHP_OS_FAMILY,
            'php_version' => PHP_VERSION,
            'proc_open_available' => function_exists('proc_open'),
            'ytdlp_path' => $ytdlp,
            'ytdlp_exists' => is_file($ytdlp),
            'ytdlp_executable' => is_file($ytdlp) && is_executable($ytdlp),
            'ffmpeg_path' => $ffmpeg,
            'ffmpeg_exists' => is_file($ffmpeg),
            'ffmpeg_executable' => is_file($ffmpeg) && is_executable($ffmpeg),
            'tmp_dir' => $tmp,
            'tmp_writable' => is_writable($tmp),
            'cookies_path' => config('downloader.cookies'),
            'cookies_present' => (bool) (config('downloader.cookies') && is_file(config('downloader.cookies'))),
        ];

        // Deno JS runtime (required by modern yt-dlp for YouTube).
        $deno = dirname($ytdlp) . DIRECTORY_SEPARATOR . 'deno' . (PHP_OS_FAMILY === 'Windows' ? '.exe' : '');
        $out['deno_path'] = $deno;
        $out['deno_present'] = is_file($deno);

        // Try actually running yt-dlp --version.
        if ($out['proc_open_available'] && $out['ytdlp_exists']) {
            try {
                $r = Process::timeout(30)->env($this->procEnv())->run([$ytdlp, '--version']);
                $out['ytdlp_run_exit'] = $r->exitCode();
                $out['ytdlp_run_output'] = trim($r->output());
                $out['ytdlp_run_error'] = trim($r->errorOutput());
            } catch (\Throwable $e) {
                $out['ytdlp_run_exception'] = $e->getMessage();
            }
        }

        $out['ready'] = $out['proc_open_available']
            && ($out['ytdlp_run_exit'] ?? 1) === 0
            && $out['ffmpeg_exists'];

        return response()->json($out, 200, [], JSON_PRETTY_PRINT);
    }

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
            ...$this->authArgs(),
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
            'banner' => ['sometimes', 'boolean'],
            'voice' => ['sometimes', 'in:none,deep,chipmunk,robot'],
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
            ...$this->authArgs(),
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

        // Optionally overlay the banner and/or apply a voice effect with ffmpeg.
        // Returns a freshly-processed file, or the original if nothing to do.
        $servePath = $this->applyEffects(
            $file,
            $workDir,
            $data['format'],
            (bool) ($data['banner'] ?? false),
            $data['voice'] ?? 'none',
        );

        // Serve the (possibly processed) file but keep the original, human-friendly
        // filename that yt-dlp produced from the video title.
        return response()
            ->download($servePath, basename($file))
            ->deleteFileAfterSend(true);
    }

    /**
     * Post-process the downloaded file with ffmpeg: burn in the banner overlay
     * (video only) and/or apply a voice effect. Returns the path to the new
     * file, or the untouched original when there is nothing to do (or ffmpeg
     * fails — we would rather hand back the clean download than error out).
     */
    protected function applyEffects(string $input, string $workDir, string $format, bool $banner, string $voice): string
    {
        $audioFilter = $this->voiceFilter($voice);
        $wantBanner = $banner && $format === 'video' && is_file((string) config('downloader.banner'));

        // Nothing requested (or banner missing / not applicable to audio).
        if (! $wantBanner && $audioFilter === null) {
            return $input;
        }

        $ext = $format === 'audio' ? 'mp3' : 'mp4';
        $outFile = $workDir . DIRECTORY_SEPARATOR . 'processed_' . Str::random(8) . '.' . $ext;

        $cmd = [$this->ffmpegBin(), '-y', '-i', $input];

        if ($wantBanner) {
            $cmd[] = '-i';
            $cmd[] = config('downloader.banner');
        }

        if ($format === 'audio') {
            // Audio-only: apply the voice filter and re-encode to MP3.
            array_push($cmd, '-af', $audioFilter, '-c:a', 'libmp3lame', '-q:a', '2');
        } elseif ($wantBanner) {
            // Stretch the banner to the full video width and a slim fixed
            // height (a footer bar — wide, not tall) and pin it flush to the
            // bottom edge. When a voice effect is also requested, route the
            // audio through the same filtergraph; otherwise copy it untouched.
            $ratio = max(0.02, min(0.9, (float) config('downloader.banner_height', 0.12)));
            $parts = [
                sprintf('[1][0]scale2ref=w=main_w:h=main_h*%s[wm][base]', $ratio),
                '[base][wm]overlay=0:H-h[v]',
            ];
            $maps = ['-map', '[v]'];

            if ($audioFilter !== null) {
                $parts[] = '[0:a]' . $audioFilter . '[a]';
                array_push($maps, '-map', '[a]');
            } else {
                array_push($maps, '-map', '0:a?');
            }

            array_push($cmd, '-filter_complex', implode(';', $parts), ...$maps);
            array_push($cmd, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p');
            array_push($cmd, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart');
        } else {
            // Video with a voice effect only: keep the video stream as-is and
            // just re-encode the filtered audio.
            array_push($cmd, '-af', $audioFilter, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart');
        }

        $cmd[] = $outFile;

        $result = Process::timeout(config('downloader.timeout'))->env($this->procEnv())->run($cmd);

        if ($result->successful() && is_file($outFile) && filesize($outFile) > 0) {
            return $outFile;
        }

        // Fall back to the untouched download so the user still gets their file.
        @unlink($outFile);

        return $input;
    }

    /**
     * ffmpeg audio filter for a voice effect, or null for "none".
     *
     * "deep"/"chipmunk" shift the pitch by re-interpreting the sample rate and
     * then restore the original duration with atempo. "robot" zeroes the phase
     * with an FFT filter for a monotone, vocoder-like sound. We resample to a
     * fixed 44.1kHz first so the pitch factor is consistent across sources.
     */
    protected function voiceFilter(string $voice): ?string
    {
        return match ($voice) {
            'deep' => 'aresample=44100,asetrate=44100*0.8,aresample=44100,atempo=1.25',
            'chipmunk' => 'aresample=44100,asetrate=44100*1.5,aresample=44100,atempo=0.6667',
            'robot' => "afftfilt=real='hypot(re,im)*sin(0)':imag='hypot(re,im)*cos(0)':win_size=512:overlap=0.75",
            default => null,
        };
    }

    /**
     * Absolute path to the ffmpeg binary inside the configured ffmpeg dir.
     */
    protected function ffmpegBin(): string
    {
        $dir = rtrim((string) config('downloader.ffmpeg_dir'), '/\\');

        return $dir . DIRECTORY_SEPARATOR . 'ffmpeg' . (PHP_OS_FAMILY === 'Windows' ? '.exe' : '');
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
     * Authentication / anti-bot arguments shared by info() and download().
     * Adds a cookies file (needed to bypass YouTube's "confirm you're not a
     * bot" check on server IPs) and any configured extractor args.
     */
    protected function authArgs(): array
    {
        $args = [];

        $cookies = config('downloader.cookies');
        if ($cookies && is_file($cookies)) {
            $args[] = '--cookies';
            $args[] = $cookies;
        }

        $extractor = trim((string) config('downloader.extractor_args'));
        if ($extractor !== '') {
            $args[] = '--extractor-args';
            $args[] = $extractor;
        }

        return $args;
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

        // Cache dir for the Deno JS runtime (required by modern yt-dlp for
        // YouTube). Must be writable and not on a noexec mount like /tmp.
        $denoDir = $tmp . DIRECTORY_SEPARATOR . 'deno';
        if (! is_dir($denoDir)) {
            @mkdir($denoDir, 0775, true);
        }

        // Prepend our bin dir to PATH so yt-dlp auto-discovers deno (and ffmpeg).
        $binDir = dirname(config('downloader.ytdlp'));
        $path = $binDir . PATH_SEPARATOR . (getenv('PATH') ?: '');

        if (PHP_OS_FAMILY !== 'Windows') {
            return [
                'TMP' => $tmp,
                'TEMP' => $tmp,
                'TMPDIR' => $tmp,
                'PATH' => $path,
                'HOME' => $tmp,
                'DENO_DIR' => $denoDir,
                'XDG_CACHE_HOME' => $tmp,
            ];
        }

        $env = [
            'TMP' => $tmp,
            'TEMP' => $tmp,
            'TMPDIR' => $tmp,
            'DENO_DIR' => $denoDir,
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

        // Ensure our bin dir (deno, ffmpeg) is discoverable on PATH.
        $env['PATH'] = $path;

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
