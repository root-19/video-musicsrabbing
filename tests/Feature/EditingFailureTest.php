<?php

namespace Tests\Feature;

use App\Http\Controllers\DownloadController;
use ReflectionMethod;
use Tests\TestCase;

/**
 * A failed edit must never masquerade as a successful download.
 *
 * The original code fell back to the untouched file whenever ffmpeg failed,
 * which on a server with a broken ffmpeg looks exactly like the trim and mute
 * options quietly doing nothing. These tests pin the louder behaviour.
 */
class EditingFailureTest extends TestCase
{
    protected function invokeApplyEffects(array $opts, ?string &$error = null): ?string
    {
        $controller = new DownloadController();
        $method = new ReflectionMethod($controller, 'applyEffects');
        $method->setAccessible(true);

        $work = storage_path('framework/testing/edit-' . getmypid());
        if (! is_dir($work)) {
            mkdir($work, 0775, true);
        }

        $input = $work . '/input.mp4';
        file_put_contents($input, 'not really a video');

        try {
            return $method->invokeArgs($controller, [$input, $work, 'video', $opts, &$error]);
        } finally {
            foreach (glob($work . '/*') ?: [] as $f) {
                @unlink($f);
            }
            @rmdir($work);
        }
    }

    public function test_a_missing_ffmpeg_reports_an_error_instead_of_the_unedited_file(): void
    {
        config(['downloader.ffmpeg_dir' => storage_path('framework/testing/no-such-dir')]);

        $error = null;
        $result = $this->invokeApplyEffects(['mute' => true], $error);

        $this->assertNull($result, 'A failed edit must not return a path.');
        $this->assertStringContainsString('ffmpeg is not installed', (string) $error);
    }

    public function test_a_failing_ffmpeg_reports_an_error_instead_of_the_unedited_file(): void
    {
        // A real binary that is not ffmpeg: it runs, then exits non-zero.
        $dir = storage_path('framework/testing/fakebin');
        @mkdir($dir, 0775, true);

        $isWindows = PHP_OS_FAMILY === 'Windows';
        $path = $dir . '/ffmpeg' . ($isWindows ? '.exe' : '');

        // On Windows a .exe cannot be faked, so borrow a command that fails.
        if ($isWindows) {
            @copy((string) (getenv('SystemRoot') ?: 'C:\\Windows') . '\\System32\\find.exe', $path);
        } else {
            file_put_contents($path, "#!/bin/sh\necho 'boom' >&2\nexit 1\n");
            chmod($path, 0755);
        }

        if (! is_file($path)) {
            $this->markTestSkipped('Could not stage a failing ffmpeg stand-in.');
        }

        config(['downloader.ffmpeg_dir' => $dir]);

        $error = null;
        $result = $this->invokeApplyEffects(['start' => 1.0, 'end' => 3.0], $error);

        $this->assertNull($result, 'A failed edit must not return a path.');
        $this->assertNotEmpty($error, 'The reason ffmpeg failed must be reported.');

        @unlink($path);
        @rmdir($dir);
    }

    public function test_nothing_requested_returns_the_original_untouched(): void
    {
        $error = null;
        $result = $this->invokeApplyEffects(['voice' => 'none'], $error);

        $this->assertNotNull($result);
        $this->assertStringEndsWith('input.mp4', (string) $result);
        $this->assertNull($error);
    }
}
