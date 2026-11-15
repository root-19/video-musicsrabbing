<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * The saved-media library.
 *
 * Downloads can be stored on the server inside user-created folders instead of
 * being streamed straight to the browser. Everything lives under
 * storage/app/library/<folder>/<file>. Folder names are restricted to a safe
 * character set so they can be used directly as directory names with no risk
 * of path traversal.
 */
class LibraryController extends Controller
{
    /** Characters allowed in a folder name. */
    public const FOLDER_REGEX = '/^[A-Za-z0-9][A-Za-z0-9 _\-]{0,49}$/';

    /**
     * List every folder with the files it holds.
     */
    public function index(): JsonResponse
    {
        return response()->json(['folders' => static::folders()]);
    }

    /**
     * Create a new (empty) folder.
     */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'regex:' . self::FOLDER_REGEX],
        ], [
            'name.regex' => 'Folder names can only contain letters, numbers, spaces, dashes and underscores.',
        ]);

        $name = trim($data['name']);
        $dir = static::folderPath($name);

        if (is_dir($dir)) {
            return response()->json(['message' => 'A folder with that name already exists.'], 422);
        }

        if (! @mkdir($dir, 0775, true) && ! is_dir($dir)) {
            return response()->json(['message' => 'Could not create that folder on the server.'], 500);
        }

        return response()->json([
            'message' => 'Folder created.',
            'folders' => static::folders(),
        ]);
    }

    /**
     * Rename a folder, keeping everything inside it.
     */
    public function rename(Request $request): JsonResponse
    {
        $data = $request->validate([
            'folder' => ['required', 'string', 'regex:' . self::FOLDER_REGEX],
            'name' => ['required', 'string', 'regex:' . self::FOLDER_REGEX],
        ]);

        $from = static::folderPath($data['folder']);
        $to = static::folderPath(trim($data['name']));

        if (! is_dir($from)) {
            return response()->json(['message' => 'That folder no longer exists.'], 404);
        }

        if ($from !== $to && is_dir($to)) {
            return response()->json(['message' => 'A folder with that name already exists.'], 422);
        }

        if ($from !== $to && ! @rename($from, $to)) {
            return response()->json(['message' => 'Could not rename that folder.'], 500);
        }

        return response()->json(['message' => 'Folder renamed.', 'folders' => static::folders()]);
    }

    /**
     * Delete a folder and everything inside it.
     */
    public function destroy(Request $request): JsonResponse
    {
        $data = $request->validate([
            'folder' => ['required', 'string', 'regex:' . self::FOLDER_REGEX],
        ]);

        $dir = static::folderPath($data['folder']);

        if (is_dir($dir)) {
            foreach (glob($dir . DIRECTORY_SEPARATOR . '*') ?: [] as $f) {
                if (is_file($f)) {
                    @unlink($f);
                }
            }
            @rmdir($dir);
        }

        return response()->json(['message' => 'Folder deleted.', 'folders' => static::folders()]);
    }

    /**
     * Delete a single saved file.
     */
    public function destroyFile(Request $request): JsonResponse
    {
        $data = $request->validate([
            'folder' => ['required', 'string', 'regex:' . self::FOLDER_REGEX],
            'file' => ['required', 'string', 'max:255'],
        ]);

        $path = static::filePath($data['folder'], $data['file']);

        if ($path && is_file($path)) {
            @unlink($path);
        }

        return response()->json(['message' => 'File deleted.', 'folders' => static::folders()]);
    }

    /**
     * Serve a saved file — inline for in-page playback (BinaryFileResponse
     * honours HTTP range requests, so the player can seek) or as an attachment
     * when ?dl=1 is present.
     */
    public function file(Request $request): BinaryFileResponse
    {
        $data = $request->validate([
            'folder' => ['required', 'string', 'regex:' . self::FOLDER_REGEX],
            'file' => ['required', 'string', 'max:255'],
        ]);

        $path = static::filePath($data['folder'], $data['file']);

        abort_if(! $path || ! is_file($path), 404, 'File not found.');

        return $request->boolean('dl')
            ? response()->download($path)
            : response()->file($path);
    }

    /* ------------------------------------------------------------------ */
    /* Helpers — also used by DownloadController                           */
    /* ------------------------------------------------------------------ */

    /**
     * Absolute path of the library root, created on demand.
     */
    public static function root(): string
    {
        $root = rtrim((string) config('downloader.library_dir'), '/\\');

        if (! is_dir($root)) {
            @mkdir($root, 0775, true);
        }

        return $root;
    }

    /**
     * Absolute path of one folder. The name is re-validated here, so this is
     * safe to call from anywhere.
     */
    public static function folderPath(string $name): string
    {
        $name = trim($name);

        abort_unless(preg_match(self::FOLDER_REGEX, $name) === 1, 422, 'Invalid folder name.');

        return static::root() . DIRECTORY_SEPARATOR . $name;
    }

    /**
     * Absolute path of one file inside a folder, or null when the name escapes
     * the folder (path traversal) or the folder does not exist.
     */
    public static function filePath(string $folder, string $file): ?string
    {
        $dir = static::folderPath($folder);
        $base = basename(str_replace('\\', '/', $file));

        if ($base === '' || $base === '.' || $base === '..' || ! is_dir($dir)) {
            return null;
        }

        $real = realpath($dir . DIRECTORY_SEPARATOR . $base);
        $realDir = realpath($dir);

        if ($real === false || $realDir === false) {
            return null;
        }

        if (! str_starts_with($real, rtrim($realDir, '/\\') . DIRECTORY_SEPARATOR)) {
            return null;
        }

        return $real;
    }

    /**
     * Every folder, each with its files (newest first) and the lightweight
     * metadata the UI needs.
     *
     * @return array<int, array<string, mixed>>
     */
    public static function folders(): array
    {
        $root = static::root();
        $out = [];

        foreach (glob($root . DIRECTORY_SEPARATOR . '*', GLOB_ONLYDIR) ?: [] as $dir) {
            $name = basename($dir);

            if (preg_match(self::FOLDER_REGEX, $name) !== 1) {
                continue;
            }

            $files = [];
            $bytes = 0;

            foreach (glob($dir . DIRECTORY_SEPARATOR . '*') ?: [] as $f) {
                if (! is_file($f)) {
                    continue;
                }

                $size = (int) filesize($f);
                $bytes += $size;
                $ext = strtolower((string) pathinfo($f, PATHINFO_EXTENSION));

                $files[] = [
                    'name' => basename($f),
                    'size' => $size,
                    'modified' => (int) filemtime($f),
                    'kind' => in_array($ext, ['mp3', 'm4a', 'opus', 'wav', 'aac', 'flac'], true) ? 'audio' : 'video',
                    'url' => route('library.file', ['folder' => $name, 'file' => basename($f)]),
                    'download_url' => route('library.file', ['folder' => $name, 'file' => basename($f), 'dl' => 1]),
                ];
            }

            usort($files, fn ($a, $b) => $b['modified'] <=> $a['modified']);

            $out[] = [
                'name' => $name,
                'files' => $files,
                'count' => count($files),
                'size' => $bytes,
                'modified' => (int) filemtime($dir),
            ];
        }

        usort($out, fn ($a, $b) => strcasecmp($a['name'], $b['name']));

        return $out;
    }

    /**
     * Copy a finished download into a library folder, never overwriting an
     * existing file — " (2)", " (3)" … are appended as needed.
     *
     * @return array<string, mixed>
     */
    public static function storeFile(string $source, string $folder, string $filename): array
    {
        $dir = static::folderPath($folder);

        if (! is_dir($dir) && ! @mkdir($dir, 0775, true) && ! is_dir($dir)) {
            abort(500, 'Could not create the destination folder on the server.');
        }

        $base = pathinfo($filename, PATHINFO_FILENAME) ?: 'download';
        $ext = (string) pathinfo($filename, PATHINFO_EXTENSION);
        $ext = $ext !== '' ? '.' . $ext : '';

        $target = $dir . DIRECTORY_SEPARATOR . $base . $ext;
        $i = 2;
        while (file_exists($target)) {
            $target = $dir . DIRECTORY_SEPARATOR . $base . ' (' . $i . ')' . $ext;
            $i++;
        }

        if (! @copy($source, $target)) {
            abort(500, 'The saved folder is not writable on the server.');
        }

        return [
            'folder' => $folder,
            'name' => basename($target),
            'size' => (int) filesize($target),
            'url' => route('library.file', ['folder' => $folder, 'file' => basename($target)]),
            'download_url' => route('library.file', ['folder' => $folder, 'file' => basename($target), 'dl' => 1]),
        ];
    }
}
