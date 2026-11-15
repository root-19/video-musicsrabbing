<?php

namespace Tests\Feature;

use Tests\TestCase;

class LibraryTest extends TestCase
{
    protected string $root;

    protected function setUp(): void
    {
        parent::setUp();

        // Keep the real library untouched: point the config at a scratch dir.
        $this->root = storage_path('framework/testing/library-' . getmypid());
        config(['downloader.library_dir' => $this->root]);

        $this->wipe();
    }

    protected function tearDown(): void
    {
        $this->wipe();

        parent::tearDown();
    }

    protected function wipe(): void
    {
        if (! is_dir($this->root)) {
            return;
        }

        foreach (glob($this->root . '/*', GLOB_ONLYDIR) ?: [] as $dir) {
            foreach (glob($dir . '/*') ?: [] as $f) {
                @unlink($f);
            }
            @rmdir($dir);
        }

        @rmdir($this->root);
    }

    public function test_it_starts_with_no_folders(): void
    {
        $this->getJson('/library')
            ->assertOk()
            ->assertJson(['folders' => []]);
    }

    public function test_it_creates_lists_renames_and_deletes_a_folder(): void
    {
        $this->postJson('/library/folders', ['name' => 'My Clips'])
            ->assertOk()
            ->assertJsonPath('folders.0.name', 'My Clips')
            ->assertJsonPath('folders.0.count', 0);

        $this->assertDirectoryExists($this->root . '/My Clips');

        $this->postJson('/library/folders/rename', ['folder' => 'My Clips', 'name' => 'Tutorials'])
            ->assertOk()
            ->assertJsonPath('folders.0.name', 'Tutorials');

        $this->deleteJson('/library/folders', ['folder' => 'Tutorials'])
            ->assertOk()
            ->assertJson(['folders' => []]);

        $this->assertDirectoryDoesNotExist($this->root . '/Tutorials');
    }

    public function test_it_refuses_a_duplicate_folder(): void
    {
        $this->postJson('/library/folders', ['name' => 'Clips'])->assertOk();

        $this->postJson('/library/folders', ['name' => 'Clips'])
            ->assertStatus(422)
            ->assertJsonPath('message', 'A folder with that name already exists.');
    }

    /**
     * Names that could escape the library root must never reach the filesystem.
     */
    public function test_it_rejects_unsafe_folder_names(): void
    {
        foreach (['../evil', '..', 'has/slash', 'has\\slash', '.hidden', ''] as $name) {
            $this->postJson('/library/folders', ['name' => $name])
                ->assertStatus(422);
        }

        $this->assertDirectoryDoesNotExist($this->root . '/../evil');
    }

    public function test_it_serves_deletes_and_counts_files(): void
    {
        $this->postJson('/library/folders', ['name' => 'Clips'])->assertOk();
        file_put_contents($this->root . '/Clips/demo.mp4', str_repeat('x', 512));

        $this->getJson('/library')
            ->assertOk()
            ->assertJsonPath('folders.0.count', 1)
            ->assertJsonPath('folders.0.size', 512)
            ->assertJsonPath('folders.0.files.0.name', 'demo.mp4')
            ->assertJsonPath('folders.0.files.0.kind', 'video');

        $this->get('/library/file?folder=Clips&file=demo.mp4')->assertOk();
        $this->get('/library/file?folder=Clips&file=demo.mp4&dl=1')
            ->assertOk()
            ->assertDownload('demo.mp4');

        $this->deleteJson('/library/file', ['folder' => 'Clips', 'file' => 'demo.mp4'])
            ->assertOk()
            ->assertJsonPath('folders.0.count', 0);
    }

    public function test_it_refuses_to_serve_a_file_outside_the_folder(): void
    {
        $this->postJson('/library/folders', ['name' => 'Clips'])->assertOk();

        foreach (['../../../.env', '..\\..\\.env', '../Other/secret.mp4'] as $file) {
            $this->get('/library/file?folder=Clips&file=' . urlencode($file))
                ->assertNotFound();
        }
    }

    public function test_an_mp3_is_reported_as_audio(): void
    {
        $this->postJson('/library/folders', ['name' => 'Songs'])->assertOk();
        file_put_contents($this->root . '/Songs/track.mp3', 'x');

        $this->getJson('/library')
            ->assertJsonPath('folders.0.files.0.kind', 'audio');
    }

    public function test_download_rejects_a_backwards_clip(): void
    {
        $this->postJson('/download', [
            'url' => 'https://example.com/video',
            'format' => 'video',
            'start' => 30,
            'end' => 10,
        ])
            ->assertStatus(422)
            ->assertJsonPath('message', 'The end of the clip must come after its start.');
    }

    public function test_download_rejects_an_unsafe_destination_folder(): void
    {
        $this->postJson('/download', [
            'url' => 'https://example.com/video',
            'format' => 'video',
            'folder' => '../escape',
        ])->assertStatus(422);
    }
}
