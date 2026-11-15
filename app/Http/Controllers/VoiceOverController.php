<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * Voice-over studio: the user uploads a video and a script (typed or from a
 * .txt file), picks a normal boy/girl voice, and we synthesize the speech and
 * lay it over the video with ffmpeg. Extends DownloadController to reuse its
 * ffmpeg/process/tmp-dir helpers.
 */
class VoiceOverController extends DownloadController
{
    public function show()
    {
        return Inertia::render('VoiceOver', [
            'ttsAvailable' => $this->ttsEngineAvailable(),
            'voices' => $this->availableVoices(),
        ]);
    }

    /**
     * Voices the user can pick from. The two built-in voices (Boy / Girl) are
     * always offered first — they run on the free local engine and never use
     * any API credits — followed by the natural Voice.ai voices when an API
     * key is configured. Each entry: id, label, desc, gender.
     */
    protected function availableVoices(): array
    {
        $local = [
            ['id' => 'boy', 'label' => 'Boy (free)', 'desc' => 'Built-in male voice — no credits', 'gender' => 'male'],
            ['id' => 'girl', 'label' => 'Girl (free)', 'desc' => 'Built-in female voice — no credits', 'gender' => 'female'],
        ];

        return array_merge($local, $this->voiceAiVoices());
    }

    /**
     * The natural voices from the Voice.ai API (cached for an hour). Returns an
     * empty list when no API key is configured. Kept separate from the free
     * built-in voices so those are always available even with zero credits.
     */
    protected function voiceAiVoices(): array
    {
        if ((string) config('downloader.voiceai.key') === '') {
            return [];
        }

        return Cache::remember('voiceai.voices', 3600, function () {
            try {
                $response = Http::withToken((string) config('downloader.voiceai.key'))
                    ->timeout(15)
                    ->get((string) config('downloader.voiceai.voices_endpoint'));

                if ($response->successful() && is_array($response->json())) {
                    $voices = collect($response->json())
                        ->filter(fn ($v) => ($v['status'] ?? '') === 'AVAILABLE' && ! empty($v['voice_id']))
                        ->map(function ($v) {
                            // Names look like "Matt - American Male" — split into
                            // a short label and a descriptive accent line.
                            $name = (string) ($v['name'] ?? 'Voice');
                            [$label, $desc] = array_pad(array_map('trim', explode('-', $name, 2)), 2, '');

                            return [
                                'id' => (string) $v['voice_id'],
                                'label' => $label ?: $name,
                                'desc' => $desc !== '' ? $desc : 'Natural AI voice',
                                'gender' => $this->guessGender($name),
                            ];
                        })
                        ->values()
                        ->all();

                    if (! empty($voices)) {
                        return $voices;
                    }
                }
            } catch (\Throwable) {
                // fall through — the free built-in Boy/Girl voices still work.
            }

            // API unreachable / empty: offer no API voices. The always-present
            // free built-in Boy/Girl (added in availableVoices) cover the user.
            return [];
        });
    }

    /**
     * Best-effort gender guess from the voice name, used only to pick an icon
     * and a matching browser preview voice on the frontend.
     */
    protected function guessGender(string $name): ?string
    {
        if (preg_match('/female|ellie|emma|alicia|lauren|zira|aria|jenny/i', $name)) {
            return 'female';
        }
        if (preg_match('/male|dalton|lachlan|matt|ryan|david|mark|guy/i', $name)) {
            return 'male';
        }

        return null;
    }

    /**
     * Synthesize the script with the chosen voice, merge it onto the uploaded
     * video, and stream the finished MP4 back to the browser.
     */
    public function render(Request $request): BinaryFileResponse
    {
        $data = $request->validate([
            'video' => ['required', 'file', 'mimes:mp4,mov,m4v,webm,mkv,avi', 'max:307200'],
            'text' => ['required', 'string', 'max:5000'],
            'voice' => ['required', 'string', 'max:64'],
            'mode' => ['required', 'in:replace,mix'],
            'effect' => ['sometimes', 'in:none,deep,chipmunk,robot'],
        ]);

        if (! collect($this->availableVoices())->pluck('id')->contains($data['voice'])) {
            abort(422, 'Unknown voice — please pick one of the listed voices.');
        }

        $this->sweepOldFiles();

        $workDir = rtrim(config('downloader.tmp_dir'), '/\\') . DIRECTORY_SEPARATOR . Str::random(24);
        if (! is_dir($workDir)) {
            mkdir($workDir, 0775, true);
        }

        $ext = strtolower($data['video']->getClientOriginalExtension() ?: 'mp4');
        $inputName = 'input.' . $ext;
        $data['video']->move($workDir, $inputName);
        $inputPath = $workDir . DIRECTORY_SEPARATOR . $inputName;

        // 1) Script text -> spoken audio (WAV).
        $speechPath = $workDir . DIRECTORY_SEPARATOR . 'speech.wav';
        $error = $this->synthesize($data['text'], $data['voice'], $speechPath, $workDir);
        if ($error !== null) {
            $this->rmdir($workDir);
            abort(422, $error);
        }

        // 1b) Optional voice effect (the same deep/chipmunk/robot ffmpeg
        // filters the downloader page offers), applied to the spoken audio
        // only — background audio in "mix" mode stays untouched. Falls back
        // to the plain voice if the filter fails, like applyEffects() does.
        $filter = $this->voiceFilter($data['effect'] ?? 'none');
        if ($filter !== null) {
            $fxPath = $workDir . DIRECTORY_SEPARATOR . 'speech_fx.wav';

            try {
                $result = Process::timeout(config('downloader.timeout'))->env($this->procEnv())->run([
                    $this->ffmpegBin(), '-y', '-i', $speechPath, '-af', $filter, $fxPath,
                ]);

                if ($result->successful() && is_file($fxPath) && filesize($fxPath) > 0) {
                    $speechPath = $fxPath;
                } else {
                    @unlink($fxPath);
                }
            } catch (\Throwable) {
                @unlink($fxPath);
            }
        }

        // 2) Merge the voice onto the video.
        $outFile = $workDir . DIRECTORY_SEPARATOR . 'voiceover_' . Str::random(8) . '.mp4';
        $error = $this->mergeVoice($inputPath, $speechPath, $outFile, $data['mode']);
        if ($error !== null) {
            $this->rmdir($workDir);
            abort(422, $error);
        }

        $original = pathinfo($data['video']->getClientOriginalName(), PATHINFO_FILENAME);
        $downloadName = Str::slug($original ?: 'video') . '-voiceover.mp4';

        return response()
            ->download($outFile, $downloadName)
            ->deleteFileAfterSend(true);
    }

    /**
     * Turn the script into a WAV file. The primary engine is the Voice.ai TTS
     * API (natural voices) when an API key is configured; if that fails for any
     * reason (out of credits, network error, bad voice…) we automatically fall
     * back to the built-in local engine — Windows SAPI voices via PowerShell,
     * or espeak-ng on Linux/macOS — so a render never dies just because the
     * paid API is unavailable. Returns null on success or a user-facing error
     * message when every engine fails.
     */
    protected function synthesize(string $text, string $voice, string $outWav, string $workDir): ?string
    {
        // The free built-in Boy/Girl voices never touch the API (no credits).
        $isLocalVoice = ($voice === 'boy' || $voice === 'girl');

        $apiError = null;
        if (! $isLocalVoice && (string) config('downloader.voiceai.key') !== '') {
            $apiError = $this->synthesizeVoiceAi($text, $voice, $outWav, $workDir);
            if ($apiError === null) {
                return null;
            }

            // Voice.ai failed — log why and drop to the always-available local
            // voice instead of failing the whole request.
            Log::warning('Voice.ai TTS failed, falling back to local engine: ' . $apiError);
            @unlink($outWav);
        }

        // Map the chosen voice to a local boy/girl voice (the local engine has
        // no concept of the Voice.ai voice IDs).
        $localVoice = $this->localVoiceFor($voice);

        $localError = $this->synthesizeLocal($text, $localVoice, $outWav, $workDir);

        // Surface the API error too when the local fallback also fails, so the
        // user sees the real reason (e.g. "insufficient credits").
        if ($localError !== null && ! empty($apiError)) {
            return $apiError . ' The built-in backup voice also failed: ' . $localError;
        }

        return $localError;
    }

    /**
     * Decide which built-in boy/girl voice to use as a fallback for a given
     * selection. Accepts either a Voice.ai voice ID (looked up in the voice
     * list for its gender) or a literal "boy"/"girl".
     */
    protected function localVoiceFor(string $voice): string
    {
        if ($voice === 'boy' || $voice === 'girl') {
            return $voice;
        }

        $gender = collect($this->availableVoices())
            ->firstWhere('id', $voice)['gender'] ?? null;

        return $gender === 'female' ? 'girl' : 'boy';
    }

    /**
     * Built-in text-to-speech (no external API). Windows uses the SAPI voices
     * (David / Zira) through PowerShell; Linux/macOS use espeak-ng (or espeak)
     * when present. $voice is "boy" or "girl". Returns null on success or a
     * user-facing error message.
     */
    protected function synthesizeLocal(string $text, string $voice, string $outWav, string $workDir): ?string
    {
        // Write the script to a file so we never have to shell-escape it.
        $textFile = $workDir . DIRECTORY_SEPARATOR . 'script.txt';
        file_put_contents($textFile, $text);

        if (PHP_OS_FAMILY === 'Windows') {
            $gender = $voice === 'girl' ? 'Female' : 'Male';
            $script = sprintf(
                "Add-Type -AssemblyName System.Speech; " .
                "\$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; " .
                "\$s.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::%s, [System.Speech.Synthesis.VoiceAge]::Adult); " .
                "\$s.Rate = 0; " .
                "\$s.SetOutputToWaveFile('%s'); " .
                "\$s.Speak([System.IO.File]::ReadAllText('%s', [System.Text.Encoding]::UTF8)); " .
                "\$s.SetOutputToNull(); \$s.Dispose();",
                $gender,
                str_replace("'", "''", $outWav),
                str_replace("'", "''", $textFile),
            );

            try {
                $result = Process::timeout(config('downloader.timeout'))->env($this->procEnv())->run([
                    'powershell', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', $script,
                ]);
            } catch (\Throwable $e) {
                return 'Text-to-speech failed: ' . Str::limit($e->getMessage(), 200);
            }

            if ($result->successful() && is_file($outWav) && filesize($outWav) > 0) {
                return null;
            }

            return 'Text-to-speech failed: ' . Str::limit(trim($result->errorOutput() ?: $result->output()) ?: 'no audio was produced.', 300);
        }

        // Linux / macOS: espeak-ng with a male/female voice variant.
        $variant = $voice === 'girl' ? 'en-us+f3' : 'en-us+m3';
        $lastError = '';

        foreach ($this->espeakCandidates() as $bin) {
            try {
                $result = Process::timeout(config('downloader.timeout'))->env($this->procEnv())->run([
                    $bin, '-v', $variant, '-s', '165', '-w', $outWav, '-f', $textFile,
                ]);
            } catch (\Throwable $e) {
                $lastError = $e->getMessage();
                continue;
            }

            if ($result->successful() && is_file($outWav) && filesize($outWav) > 0) {
                return null;
            }

            $lastError = trim($result->errorOutput()) ?: $lastError;
        }

        return 'Text-to-speech is not available on this server — install espeak-ng (e.g. "apt install espeak-ng") or drop an espeak-ng binary into storage/app/bin. '
            . Str::limit($lastError, 200);
    }

    /**
     * Generate the speech WAV through the Voice.ai text-to-speech API.
     * The API accepts at most 500 characters per request, so longer scripts
     * are split into sentence-sized chunks, generated one by one, and stitched
     * back together with ffmpeg. Returns null on success or a user-facing
     * error message.
     */
    protected function synthesizeVoiceAi(string $text, string $voiceId, string $outWav, string $workDir): ?string
    {
        $chunks = $this->chunkText($text, 450);
        $parts = [];

        foreach ($chunks as $i => $chunk) {
            $part = count($chunks) === 1 ? $outWav : $workDir . DIRECTORY_SEPARATOR . 'speech_part' . $i . '.wav';

            $error = $this->requestVoiceAi($chunk, $voiceId, $part);
            if ($error !== null) {
                return $error;
            }

            $parts[] = $part;
        }

        if (count($parts) === 1) {
            return null;
        }

        // Stitch the chunk WAVs together (same codec/params, so a plain
        // stream copy through the concat demuxer is enough).
        $list = $workDir . DIRECTORY_SEPARATOR . 'speech_parts.txt';
        file_put_contents($list, implode("\n", array_map(
            fn ($p) => "file '" . str_replace(['\\', "'"], ['/', "'\\''"], $p) . "'",
            $parts,
        )));

        try {
            $result = Process::timeout(config('downloader.timeout'))->env($this->procEnv())->run([
                $this->ffmpegBin(), '-y', '-f', 'concat', '-safe', '0', '-i', $list, '-c', 'copy', $outWav,
            ]);
        } catch (\Throwable $e) {
            return 'Could not join the speech audio: ' . Str::limit($e->getMessage(), 200);
        }

        if ($result->successful() && is_file($outWav) && filesize($outWav) > 0) {
            return null;
        }

        return 'Could not join the speech audio: ' . $this->cleanError($result->errorOutput());
    }

    /**
     * One Voice.ai TTS request; writes the returned audio bytes to $outWav.
     * Returns null on success or a user-facing error message.
     */
    protected function requestVoiceAi(string $text, string $voiceId, string $outWav): ?string
    {
        try {
            $response = Http::withToken((string) config('downloader.voiceai.key'))
                ->timeout((int) config('downloader.timeout'))
                ->post((string) config('downloader.voiceai.endpoint'), [
                    'text' => $text,
                    'voice_id' => $voiceId,
                    'audio_format' => 'wav',
                ]);
        } catch (\Throwable $e) {
            return 'Could not reach the Voice AI service: ' . Str::limit($e->getMessage(), 200);
        }

        if ($response->successful() && strlen($response->body()) > 0) {
            file_put_contents($outWav, $response->body());

            if (is_file($outWav) && filesize($outWav) > 0) {
                return null;
            }
        }

        $detail = $response->json('detail') ?? $response->json('message') ?? Str::limit(trim($response->body()), 200);
        if (! is_string($detail)) {
            $detail = json_encode($detail);
        }

        return 'Voice AI could not generate the speech (HTTP ' . $response->status() . '): '
            . ($detail !== '' ? Str::limit($detail, 300) : 'unknown error');
    }

    /**
     * Split the script into chunks of at most $limit characters, preferring
     * sentence boundaries and falling back to word boundaries for run-on
     * sentences, so each chunk still sounds natural on its own.
     */
    protected function chunkText(string $text, int $limit = 450): array
    {
        $sentences = preg_split('/(?<=[.!?…])\s+|\n+/u', trim($text), -1, PREG_SPLIT_NO_EMPTY) ?: [];

        // Break any single sentence longer than the limit into word pieces.
        $units = [];
        foreach ($sentences as $sentence) {
            $sentence = trim($sentence);
            while (mb_strlen($sentence) > $limit) {
                $head = mb_substr($sentence, 0, $limit);
                $cut = mb_strrpos($head, ' ') ?: $limit;
                $units[] = trim(mb_substr($sentence, 0, $cut));
                $sentence = trim(mb_substr($sentence, $cut));
            }
            if ($sentence !== '') {
                $units[] = $sentence;
            }
        }

        // Greedily pack the units back into chunks up to the limit.
        $chunks = [];
        $current = '';
        foreach ($units as $unit) {
            if ($current === '') {
                $current = $unit;
            } elseif (mb_strlen($current) + 1 + mb_strlen($unit) <= $limit) {
                $current .= ' ' . $unit;
            } else {
                $chunks[] = $current;
                $current = $unit;
            }
        }
        if ($current !== '') {
            $chunks[] = $current;
        }

        return $chunks ?: [Str::limit($text, $limit, '')];
    }

    /**
     * Candidate espeak binaries: bundled copies in storage/app/bin first,
     * then whatever is on the system PATH.
     */
    protected function espeakCandidates(): array
    {
        $binDir = rtrim((string) config('downloader.ffmpeg_dir'), '/\\');

        $candidates = [];
        foreach (['espeak-ng', 'espeak'] as $name) {
            $bundled = $binDir . DIRECTORY_SEPARATOR . $name;
            if (is_file($bundled)) {
                $candidates[] = $bundled;
            }
        }

        return array_merge($candidates, ['espeak-ng', 'espeak']);
    }

    /**
     * Whether a TTS engine can run on this machine (used to warn the user on
     * page load instead of failing after a long upload).
     */
    protected function ttsEngineAvailable(): bool
    {
        if ((string) config('downloader.voiceai.key') !== '') {
            return true; // Voice.ai API needs no local engine.
        }

        if (! function_exists('proc_open')) {
            return false;
        }

        if (PHP_OS_FAMILY === 'Windows') {
            return true; // SAPI ships with Windows.
        }

        foreach ($this->espeakCandidates() as $bin) {
            try {
                $result = Process::timeout(10)->env($this->procEnv())->run([$bin, '--version']);
                if ($result->successful()) {
                    return true;
                }
            } catch (\Throwable) {
                // try the next candidate
            }
        }

        return false;
    }

    /**
     * Lay the spoken audio over the video. "replace" swaps the original audio
     * for the voice; "mix" ducks the original audio underneath it. The voice is
     * padded with silence so the video always keeps its full length. Returns
     * null on success or a user-facing error message.
     */
    protected function mergeVoice(string $video, string $speech, string $out, string $mode): ?string
    {
        $ffmpeg = $this->ffmpegBin();
        $audioOut = ['-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'];
        $lastError = '';

        $attempts = [];

        if ($mode === 'mix') {
            // Original audio ducked to 20% with the voice on top; duration
            // follows the original track. Falls back to "replace" below when
            // the video has no audio stream to mix with.
            $attempts[] = [
                $ffmpeg, '-y', '-i', $video, '-i', $speech,
                '-filter_complex', '[0:a]volume=0.2[bg];[1:a]apad[vo];[bg][vo]amix=inputs=2:duration=first:dropout_transition=0[a]',
                '-map', '0:v', '-map', '[a]', '-c:v', 'copy', ...$audioOut, $out,
            ];
        }

        // Replace: voice becomes the only audio track, padded to video length.
        $replace = [
            $ffmpeg, '-y', '-i', $video, '-i', $speech,
            '-map', '0:v', '-map', '1:a', '-af', 'apad', '-shortest',
            '-c:v', 'copy', ...$audioOut, $out,
        ];
        $attempts[] = $replace;

        // Last resort: same as replace but re-encode the video stream, for
        // sources whose codec cannot be copied into an MP4 container (VP8 etc).
        $reencode = $replace;
        array_splice($reencode, array_search('copy', $reencode, true), 1, ['libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p']);
        $attempts[] = $reencode;

        foreach ($attempts as $cmd) {
            try {
                $result = Process::timeout(config('downloader.timeout'))->env($this->procEnv())->run($cmd);
            } catch (\Throwable $e) {
                $lastError = $e->getMessage();
                continue;
            }

            if ($result->successful() && is_file($out) && filesize($out) > 0) {
                return null;
            }

            $lastError = trim($result->errorOutput());
            @unlink($out);
        }

        return 'Could not merge the voice onto the video: ' . $this->cleanError($lastError ?: 'unknown ffmpeg error');
    }
}
