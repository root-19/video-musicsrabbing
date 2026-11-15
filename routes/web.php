<?php

use App\Http\Controllers\DownloadController;
use App\Http\Controllers\LibraryController;
use App\Http\Controllers\ProfileController;
use App\Http\Controllers\VoiceOverController;
use Illuminate\Support\Facades\Route;
use Inertia\Inertia;

Route::get('/', function () {
    return Inertia::render('Welcome', [
        'folders' => LibraryController::folders(),
    ]);
});

Route::get('/health/media', [DownloadController::class, 'health'])->name('media.health');
Route::post('/info', [DownloadController::class, 'info'])->name('media.info');
Route::post('/download', [DownloadController::class, 'download'])->name('media.download');

/*
 * Saved library: folders the user creates to keep downloads on the server.
 */
Route::get('/library', [LibraryController::class, 'index'])->name('library.index');
Route::get('/library/file', [LibraryController::class, 'file'])->name('library.file');
Route::post('/library/folders', [LibraryController::class, 'store'])->name('library.folders.store');
Route::post('/library/folders/rename', [LibraryController::class, 'rename'])->name('library.folders.rename');
Route::delete('/library/folders', [LibraryController::class, 'destroy'])->name('library.folders.destroy');
Route::delete('/library/file', [LibraryController::class, 'destroyFile'])->name('library.file.destroy');

Route::get('/voice-over', [VoiceOverController::class, 'show'])->name('voiceover.show');
Route::post('/voice-over/render', [VoiceOverController::class, 'render'])->name('voiceover.render');

Route::get('/dashboard', function () {
    return Inertia::render('Dashboard');
})->middleware(['auth', 'verified'])->name('dashboard');

Route::middleware('auth')->group(function () {
    Route::get('/profile', [ProfileController::class, 'edit'])->name('profile.edit');
    Route::patch('/profile', [ProfileController::class, 'update'])->name('profile.update');
    Route::delete('/profile', [ProfileController::class, 'destroy'])->name('profile.destroy');
});

require __DIR__.'/auth.php';
