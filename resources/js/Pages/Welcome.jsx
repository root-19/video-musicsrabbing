import { Head } from '@inertiajs/react';
import { useCallback, useEffect, useRef, useState } from 'react';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

/** Seconds -> "m:ss", or "h:mm:ss" once the clip runs past an hour. */
function formatTime(seconds, forceHours = false) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, '0');

    return h > 0 || forceHours ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** "1:30" / "0:01:30" / "90" -> 90. Returns null when it makes no sense. */
function parseTime(text) {
    const raw = String(text ?? '').trim();
    if (raw === '') return null;

    const parts = raw.split(':').map((p) => p.trim());
    if (parts.some((p) => p === '' || !/^\d+(\.\d+)?$/.test(p))) return null;

    return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

function formatBytes(bytes) {
    const b = Number(bytes) || 0;
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
    if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
    return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const looksLikeUrl = (text) => /^https?:\/\/[^\s.]+\.[^\s]{2,}$/i.test(text.trim());

/**
 * Turn the server's report of the finished file into a short sentence.
 *
 * `result` is what ffprobe measured on the file that was actually produced —
 * not a repeat of what was requested — so this is the one place that can say
 * for certain whether the cut and the mute really landed.
 */
function describeResult(applied) {
    if (!applied) return '';

    const measured = applied.result;
    const bits = [];

    if (measured?.duration) bits.push(`${formatTime(measured.duration)} long`);

    if (measured && typeof measured.has_audio === 'boolean') {
        bits.push(measured.has_audio ? 'audio kept' : 'no audio (muted)');
    } else if (applied.muted) {
        bits.push('muted');
    }

    if (applied.banner) bits.push('banner added');
    if (applied.voice && applied.voice !== 'none') bits.push(`${applied.voice} voice`);

    if (bits.length === 0) return '';

    // Flag the one case the user would otherwise have to discover by opening
    // the file: a mute was asked for but the result still carries audio.
    const contradiction = applied.muted && measured?.has_audio === true
        ? ' ⚠ You asked for it muted but the file still has audio — please report this.'
        : '';

    return ` The file is ${bits.join(', ')}.${contradiction}`;
}

/** Pull a readable message out of an axios error, blob responses included. */
async function errorMessage(e, fallback) {
    const data = e?.response?.data;

    if (data instanceof Blob) {
        try {
            const text = await data.text();
            try {
                return JSON.parse(text).message || fallback;
            } catch {
                return text ? text.slice(0, 300) : fallback;
            }
        } catch {
            return fallback;
        }
    }

    if (data?.message) return data.message;
    if (data?.errors) {
        const first = Object.values(data.errors)[0];
        if (Array.isArray(first) && first[0]) return first[0];
    }

    return fallback;
}

/* ------------------------------------------------------------------ */
/* Static marketing content                                            */
/* ------------------------------------------------------------------ */

const platforms = [
    { name: 'YouTube', color: 'text-red-500' },
    { name: 'TikTok', color: 'text-cyan-400' },
    { name: 'Instagram', color: 'text-pink-500' },
    { name: 'Facebook', color: 'text-blue-500' },
    { name: 'Twitter / X', color: 'text-sky-400' },
    { name: 'SoundCloud', color: 'text-orange-500' },
    { name: 'Vimeo', color: 'text-teal-400' },
    { name: 'Twitch', color: 'text-violet-400' },
];

const features = [
    {
        title: 'Instant Preview',
        desc: 'Paste a link and see the thumbnail, title and length before you commit to a download.',
        icon: (
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
        ),
    },
    {
        title: 'Built-in Trimmer',
        desc: 'Drag the handles — or type an exact timestamp — and keep only the seconds you actually need.',
        icon: (
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M7.848 8.25l1.536.887M7.848 8.25a3 3 0 11-5.196-3 3 3 0 015.196 3zm1.536.887a2.165 2.165 0 011.083 1.839c.005.351.054.695.14 1.024M9.384 9.137l10.962-6.333m-1.728 15.287a2.25 2.25 0 100-4.5 2.25 2.25 0 000 4.5zM14.25 12l6.096 3.52"
            />
        ),
    },
    {
        title: 'One-click Mute',
        desc: 'Strip the audio track out of any MP4 and get a clean, silent clip ready for your own voice-over.',
        icon: (
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M17.25 9.75L19.5 12m0 0l2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z"
            />
        ),
    },
    {
        title: 'Your Own Folders',
        desc: 'Create folders, file every download into one, and come back to play or re-download it any time.',
        icon: (
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 10.5v6m3-3H9m4.06-7.19l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
            />
        ),
    },
    {
        title: 'HD Video & Audio',
        desc: 'Download in up to 4K video or extract crisp 320kbps MP3 audio in one click.',
        icon: (
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z"
            />
        ),
    },
    {
        title: 'No Sign-up Needed',
        desc: 'Just paste a link and go. No account, no software, no annoying pop-ups.',
        icon: (
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
        ),
    },
];

const steps = [
    { n: '1', title: 'Paste the link', desc: 'Drop any video or music URL in the box — the preview loads by itself.' },
    { n: '2', title: 'Edit the clip', desc: 'Trim it to the exact seconds you want, mute it, add your banner.' },
    { n: '3', title: 'Pick where it goes', desc: 'Straight to your device, or filed into one of your own folders.' },
];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function Welcome({ folders: initialFolders = [] }) {
    /* Link + format */
    const [url, setUrl] = useState('');
    const [format, setFormat] = useState('video');

    /* Preview */
    const [info, setInfo] = useState(null);
    const [infoLoading, setInfoLoading] = useState(false);
    const [infoError, setInfoError] = useState('');

    /* Clip window */
    const [trimOn, setTrimOn] = useState(false);
    const [start, setStart] = useState(0);
    const [end, setEnd] = useState(0);
    const [startText, setStartText] = useState('0:00');
    const [endText, setEndText] = useState('0:00');

    /* Extras */
    const [mute, setMute] = useState(false);
    const [banner, setBanner] = useState(false);
    const [voice, setVoice] = useState('none');

    /* Destination */
    const [folders, setFolders] = useState(initialFolders);
    const [dest, setDest] = useState('');
    const [newFolder, setNewFolder] = useState('');
    const [showNewFolder, setShowNewFolder] = useState(false);
    const [busyFolder, setBusyFolder] = useState(false);

    /* Run state */
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState('');
    const [error, setError] = useState('');
    const [player, setPlayer] = useState(null);

    const requestId = useRef(0);
    const libraryRef = useRef(null);

    const duration = Math.floor(Number(info?.duration) || 0);
    const hasDuration = duration > 0;
    const clipLength = Math.max(0, end - start);
    // A trim counts only when it actually narrows the clip. Without a known
    // duration we cannot compare against the end, so any end the user typed
    // is taken at face value.
    const trimmed = trimOn && (start > 0 || (end > 0 && (! hasDuration || end < duration)));

    /* -------------------------------------------------------------- */
    /* Auto-preview: debounce the URL, then ask the server about it    */
    /* -------------------------------------------------------------- */

    useEffect(() => {
        const link = url.trim();

        setInfoError('');

        if (!looksLikeUrl(link)) {
            requestId.current += 1;
            setInfo(null);
            setInfoLoading(false);
            return undefined;
        }

        const id = (requestId.current += 1);
        setInfoLoading(true);

        const timer = setTimeout(async () => {
            try {
                const { data } = await window.axios.post('/info', { url: link });
                if (id !== requestId.current) return;

                setInfo(data);
                if (Array.isArray(data.folders)) setFolders(data.folders);

                const secs = Math.floor(Number(data.duration) || 0);
                setStart(0);
                setEnd(secs);
                setStartText('0:00');
                setEndText(formatTime(secs));
                setTrimOn(false);
            } catch (e) {
                if (id !== requestId.current) return;
                setInfo(null);
                setInfoError(
                    await errorMessage(e, 'Could not read that link. Check that it is public and try again.'),
                );
            } finally {
                if (id === requestId.current) setInfoLoading(false);
            }
        }, 700);

        return () => clearTimeout(timer);
    }, [url]);

    /* Close the player with Escape. */
    useEffect(() => {
        if (!player) return undefined;
        const onKey = (e) => e.key === 'Escape' && setPlayer(null);
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [player]);

    /* -------------------------------------------------------------- */
    /* Trim handlers                                                   */
    /* -------------------------------------------------------------- */

    // Without a known duration (a preview that failed, or a live stream) the
    // clip can still be typed in by hand — it is just not bounded above.
    const MAX_SECONDS = 86400;

    const commitStart = useCallback(
        (value) => {
            const ceiling = end > 0 ? end - 1 : (hasDuration ? duration - 1 : MAX_SECONDS - 1);
            const v = clamp(Math.round(value), 0, Math.max(0, ceiling));
            setStart(v);
            setStartText(formatTime(v, duration >= 3600));
        },
        [end, duration, hasDuration],
    );

    const commitEnd = useCallback(
        (value) => {
            const v = clamp(Math.round(value), start + 1, hasDuration ? duration : MAX_SECONDS);
            setEnd(v);
            setEndText(formatTime(v, duration >= 3600));
        },
        [start, duration, hasDuration],
    );

    const applyPreset = (seconds) => {
        setTrimOn(true);
        const from = 0;
        const to = clamp(seconds, 1, hasDuration ? duration : MAX_SECONDS);
        setStart(from);
        setEnd(to);
        setStartText(formatTime(from, duration >= 3600));
        setEndText(formatTime(to, duration >= 3600));
    };

    const resetTrim = () => {
        setStart(0);
        setEnd(duration);
        setStartText('0:00');
        // With no known length there is no end to show; an empty box reads as
        // "run to the end", which is exactly what an absent end means.
        setEndText(hasDuration ? formatTime(duration, duration >= 3600) : '');
    };

    /* -------------------------------------------------------------- */
    /* Folder actions                                                  */
    /* -------------------------------------------------------------- */

    const refreshLibrary = useCallback(async () => {
        try {
            const { data } = await window.axios.get('/library');
            setFolders(data.folders || []);
        } catch {
            /* a stale list is better than an error here */
        }
    }, []);

    const createFolder = async () => {
        const name = newFolder.trim();
        if (!name) return;

        setBusyFolder(true);
        setError('');

        try {
            const { data } = await window.axios.post('/library/folders', { name });
            setFolders(data.folders || []);
            setDest(name);
            setNewFolder('');
            setShowNewFolder(false);
            setStatus(`Folder "${name}" is ready.`);
        } catch (e) {
            setError(await errorMessage(e, 'Could not create that folder.'));
        } finally {
            setBusyFolder(false);
        }
    };

    const deleteFolder = async (name) => {
        if (!window.confirm(`Delete the folder "${name}" and everything inside it?`)) return;

        try {
            const { data } = await window.axios.delete('/library/folders', { data: { folder: name } });
            setFolders(data.folders || []);
            if (dest === name) setDest('');
            setStatus(`Folder "${name}" deleted.`);
        } catch (e) {
            setError(await errorMessage(e, 'Could not delete that folder.'));
        }
    };

    const renameFolder = async (name) => {
        const next = window.prompt('New name for this folder:', name);
        if (!next || next.trim() === name) return;

        try {
            const { data } = await window.axios.post('/library/folders/rename', {
                folder: name,
                name: next.trim(),
            });
            setFolders(data.folders || []);
            if (dest === name) setDest(next.trim());
        } catch (e) {
            setError(await errorMessage(e, 'Could not rename that folder.'));
        }
    };

    const deleteFile = async (folder, file) => {
        if (!window.confirm(`Delete "${file}"?`)) return;

        try {
            const { data } = await window.axios.delete('/library/file', { data: { folder, file } });
            setFolders(data.folders || []);
            if (player && player.folder === folder && player.name === file) setPlayer(null);
        } catch (e) {
            setError(await errorMessage(e, 'Could not delete that file.'));
        }
    };

    /* -------------------------------------------------------------- */
    /* Download                                                        */
    /* -------------------------------------------------------------- */

    const handleDownload = async () => {
        setError('');
        setStatus('');

        const link = url.trim();
        if (!link) {
            setError('Please paste a link first.');
            return;
        }

        const payload = {
            url: link,
            format,
            banner: format === 'video' && banner,
            voice: format === 'video' && mute ? 'none' : voice,
            mute: format === 'video' && mute,
        };

        if (trimmed) {
            payload.start = start;
            payload.end = end;
        }

        if (dest) payload.folder = dest;

        setLoading(true);
        setStatus(
            trimmed
                ? `Grabbing and cutting ${formatTime(clipLength)} of ${format === 'audio' ? 'audio' : 'video'} — this can take a moment…`
                : format === 'audio'
                  ? 'Extracting audio — this can take a moment…'
                  : 'Grabbing video — this can take a moment…',
        );

        try {
            const response = await window.axios.post(
                '/download',
                payload,
                dest ? { timeout: 0 } : { responseType: 'blob', timeout: 0 },
            );

            if (dest) {
                // Kept on the server: refresh the library and point at it.
                setFolders(response.data.folders || []);
                setStatus(
                    `Saved "${response.data.file?.name}" to the "${dest}" folder.`
                    + describeResult(response.data.applied),
                );
                libraryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else {
                const disposition = response.headers['content-disposition'] || '';
                const match = /filename\*?=(?:UTF-8'')?["']?([^"';]+)/i.exec(disposition);
                const filename = match ? decodeURIComponent(match[1]) : 'download';

                const blobUrl = URL.createObjectURL(response.data);
                const a = document.createElement('a');
                a.href = blobUrl;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(blobUrl);

                let applied = null;
                try {
                    applied = JSON.parse(response.headers['x-mediagrab-applied'] || 'null');
                } catch {
                    /* the header is a nicety, never required */
                }

                setStatus('Done! Your file has been saved to your downloads.' + describeResult(applied));
            }
        } catch (e) {
            setError(
                await errorMessage(e, 'Something went wrong. Please check the link and try again.'),
            );
            setStatus('');
        } finally {
            setLoading(false);
        }
    };

    /* -------------------------------------------------------------- */
    /* Render                                                          */
    /* -------------------------------------------------------------- */

    const startPct = hasDuration ? (start / duration) * 100 : 0;
    const endPct = hasDuration ? (end / duration) * 100 : 100;
    const totalFiles = folders.reduce((n, f) => n + f.count, 0);

    return (
        <>
            <Head title="MediaGrab — Download, Trim & Organise Any Video" />
            <div className="min-h-screen bg-slate-950 text-slate-300 selection:bg-fuchsia-500/30 selection:text-white">
                {/* Ambient gradient glows */}
                <div className="pointer-events-none fixed inset-0 overflow-hidden">
                    <div className="absolute -top-40 -left-40 h-[28rem] w-[28rem] rounded-full bg-fuchsia-600/20 blur-3xl" />
                    <div className="absolute top-1/3 -right-40 h-[28rem] w-[28rem] rounded-full bg-indigo-600/20 blur-3xl" />
                    <div className="absolute bottom-0 left-1/3 h-[24rem] w-[24rem] rounded-full bg-cyan-500/10 blur-3xl" />
                </div>

                <div className="relative">
                    {/* Nav */}
                    <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
                        <a href="#" className="flex items-center gap-2.5">
                            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-fuchsia-500 to-indigo-500 shadow-lg shadow-fuchsia-500/25">
                                <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v13.5m0 0l4.5-4.5M12 16.5L7.5 12M4.5 21h15" />
                                </svg>
                            </span>
                            <span className="text-lg font-bold tracking-tight text-white">
                                Media<span className="text-fuchsia-400">Grab</span>
                            </span>
                        </a>

                        <nav className="hidden items-center gap-8 text-sm font-medium text-slate-400 md:flex">
                            <a href="#how" className="transition hover:text-white">How it works</a>
                            <a href="#features" className="transition hover:text-white">Features</a>
                            <a href="#library" className="transition hover:text-white">My library</a>
                            <a href="/voice-over" className="text-fuchsia-400 transition hover:text-fuchsia-300">Voice Over</a>
                        </nav>

                        <a
                            href="#library"
                            className="rounded-lg bg-gradient-to-r from-fuchsia-500 to-indigo-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/25 transition hover:opacity-90"
                        >
                            My library{totalFiles > 0 ? ` (${totalFiles})` : ''}
                        </a>
                    </header>

                    <main>
                        {/* Hero + studio */}
                        <section className="mx-auto max-w-4xl px-6 pt-14 pb-10 text-center sm:pt-20">
                            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium text-slate-300 backdrop-blur">
                                <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400" />
                                Preview · Trim · Mute · Save to your folders
                            </span>

                            <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-white sm:text-6xl">
                                Download, cut &amp;{' '}
                                <span className="bg-gradient-to-r from-fuchsia-400 via-pink-400 to-indigo-400 bg-clip-text text-transparent">
                                    organise
                                </span>
                                <br className="hidden sm:block" /> any video
                            </h1>

                            <p className="mx-auto mt-5 max-w-2xl text-base text-slate-400 sm:text-lg">
                                Paste a link to see it instantly. Keep only the seconds you need, mute it if you
                                want, then save it to your device — or file it into a folder you make here.
                            </p>

                            {/* ------------------------------------------------ */}
                            {/* The studio box                                    */}
                            {/* ------------------------------------------------ */}
                            <div className="mx-auto mt-10 max-w-3xl rounded-2xl border border-white/10 bg-white/[0.04] p-2 text-left shadow-2xl shadow-black/40 backdrop-blur">
                                {/* Format switch */}
                                <div className="mb-2 flex gap-1.5 rounded-xl bg-black/20 p-1">
                                    {[
                                        { id: 'video', label: 'Video (MP4)' },
                                        { id: 'audio', label: 'Audio (MP3)' },
                                    ].map((opt) => (
                                        <button
                                            key={opt.id}
                                            type="button"
                                            onClick={() => setFormat(opt.id)}
                                            className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition ${
                                                format === opt.id
                                                    ? 'bg-gradient-to-r from-fuchsia-500 to-indigo-500 text-white shadow'
                                                    : 'text-slate-400 hover:text-white'
                                            }`}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>

                                {/* Link field */}
                                <div className="relative">
                                    <svg
                                        className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.8"
                                    >
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                                    </svg>
                                    <input
                                        type="url"
                                        value={url}
                                        onChange={(e) => setUrl(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && !loading && handleDownload()}
                                        disabled={loading}
                                        placeholder="Paste your video or music link here…"
                                        className="w-full rounded-xl border-0 bg-black/30 py-4 pl-12 pr-12 text-sm text-white placeholder-slate-500 ring-1 ring-inset ring-white/10 transition focus:ring-2 focus:ring-fuchsia-500 disabled:opacity-60"
                                    />
                                    {infoLoading && (
                                        <svg className="absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-fuchsia-400" viewBox="0 0 24 24" fill="none">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                        </svg>
                                    )}
                                    {!infoLoading && info && (
                                        <button
                                            type="button"
                                            onClick={() => setUrl('')}
                                            title="Clear"
                                            className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 transition hover:text-white"
                                        >
                                            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </button>
                                    )}
                                </div>

                                {infoError && (
                                    <div className="mt-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
                                        {infoError}
                                    </div>
                                )}

                                {/* ------------------------------------------ */}
                                {/* Preview card                                */}
                                {/* ------------------------------------------ */}
                                {info && (
                                    <div className="mt-2 overflow-hidden rounded-xl border border-white/10 bg-black/25">
                                        <div className="flex flex-col gap-4 p-3 sm:flex-row">
                                            <div className="relative w-full shrink-0 overflow-hidden rounded-lg bg-black sm:w-56">
                                                {info.thumbnail ? (
                                                    <img
                                                        src={info.thumbnail}
                                                        alt=""
                                                        className="h-32 w-full object-cover sm:h-32"
                                                        loading="lazy"
                                                    />
                                                ) : (
                                                    <div className="flex h-32 w-full items-center justify-center text-slate-600">
                                                        <svg className="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                                                        </svg>
                                                    </div>
                                                )}
                                                {hasDuration && (
                                                    <span className="absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                                                        {formatTime(duration)}
                                                    </span>
                                                )}
                                            </div>

                                            <div className="min-w-0 flex-1">
                                                <h3 className="truncate text-base font-semibold text-white" title={info.title}>
                                                    {info.title}
                                                </h3>
                                                {info.uploader && (
                                                    <p className="mt-1 truncate text-sm text-slate-400">{info.uploader}</p>
                                                )}
                                                <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold">
                                                    {info.extractor && (
                                                        <span className="rounded-full bg-fuchsia-500/15 px-2.5 py-1 text-fuchsia-300">
                                                            {info.extractor}
                                                        </span>
                                                    )}
                                                    {info.width && info.height && (
                                                        <span className="rounded-full bg-white/5 px-2.5 py-1 text-slate-300">
                                                            {info.width}×{info.height}
                                                        </span>
                                                    )}
                                                    {hasDuration && (
                                                        <span className="rounded-full bg-white/5 px-2.5 py-1 text-slate-300">
                                                            {formatTime(duration)} long
                                                        </span>
                                                    )}
                                                    {info.is_live && (
                                                        <span className="rounded-full bg-red-500/15 px-2.5 py-1 text-red-300">
                                                            Live
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                    </div>
                                )}

                                {/* -------------------------------- */}
                                {/* Clip editor — always reachable,    */}
                                {/* even when the preview could not    */}
                                {/* work out the length.               */}
                                {/* -------------------------------- */}
                                {url.trim() !== '' && (
                                <div className="mt-2 rounded-xl bg-black/20 p-4">
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <label className="flex cursor-pointer items-center gap-2.5 text-sm font-semibold text-white">
                                            <input
                                                type="checkbox"
                                                checked={trimOn}
                                                disabled={loading}
                                                onChange={(e) => {
                                                    setTrimOn(e.target.checked);
                                                    if (e.target.checked && end === 0 && hasDuration) resetTrim();
                                                }}
                                                className="h-4 w-4 rounded border-white/20 bg-black/40 text-fuchsia-500 focus:ring-fuchsia-500 focus:ring-offset-0 disabled:opacity-40"
                                            />
                                            Trim — save only part of this
                                        </label>

                                        {trimOn && clipLength > 0 && (
                                            <span className="rounded-full bg-gradient-to-r from-fuchsia-500/20 to-indigo-500/20 px-3 py-1 text-xs font-bold text-fuchsia-200 ring-1 ring-inset ring-fuchsia-500/30">
                                                Clip length {formatTime(clipLength)}
                                            </span>
                                        )}
                                    </div>

                                    {trimOn && !hasDuration && (
                                        <p className="mt-2 text-xs text-amber-400/80">
                                            This link’s length is unknown (no preview, or a live stream), so there is no
                                            slider — type the start and end below and the clip is cut to that window.
                                        </p>
                                    )}

                                    {trimOn && (
                                        <div className="mt-4">
                                            {/* Dual-handle track — only meaningful with a known length */}
                                            {hasDuration && (
                                            <>
                                            <div className="relative h-8 select-none">
                                                <div className="absolute top-1/2 h-1.5 w-full -translate-y-1/2 rounded-full bg-white/10" />
                                                <div
                                                    className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-fuchsia-500 to-indigo-500"
                                                    style={{ left: `${startPct}%`, right: `${100 - endPct}%` }}
                                                />
                                                <input
                                                    type="range"
                                                    min={0}
                                                    max={duration}
                                                    step={1}
                                                    value={start}
                                                    disabled={loading}
                                                    onChange={(e) => commitStart(Number(e.target.value))}
                                                    aria-label="Clip start"
                                                    className="trim-range absolute inset-0 h-8 w-full"
                                                />
                                                <input
                                                    type="range"
                                                    min={0}
                                                    max={duration}
                                                    step={1}
                                                    value={end}
                                                    disabled={loading}
                                                    onChange={(e) => commitEnd(Number(e.target.value))}
                                                    aria-label="Clip end"
                                                    className="trim-range trim-range-end absolute inset-0 h-8 w-full"
                                                />
                                            </div>

                                            <div className="mt-1 flex justify-between text-[11px] text-slate-500">
                                                <span>0:00</span>
                                                <span>{formatTime(duration)}</span>
                                            </div>
                                            </>
                                            )}

                                            {/* Exact timestamps */}
                                            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                                <label className="block">
                                                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                                                        Start at
                                                    </span>
                                                    <input
                                                        type="text"
                                                        inputMode="numeric"
                                                        value={startText}
                                                        disabled={loading}
                                                        onChange={(e) => setStartText(e.target.value)}
                                                        onBlur={() => {
                                                            const parsed = parseTime(startText);
                                                            parsed === null
                                                                ? setStartText(formatTime(start, duration >= 3600))
                                                                : commitStart(parsed);
                                                        }}
                                                        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                                                        placeholder="0:00"
                                                        className="mt-1 w-full rounded-lg border-0 bg-black/40 py-2.5 px-3 font-mono text-sm text-white ring-1 ring-inset ring-white/10 focus:ring-2 focus:ring-fuchsia-500"
                                                    />
                                                </label>
                                                <label className="block">
                                                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                                                        End at
                                                    </span>
                                                    <input
                                                        type="text"
                                                        inputMode="numeric"
                                                        value={endText}
                                                        disabled={loading}
                                                        onChange={(e) => setEndText(e.target.value)}
                                                        onBlur={() => {
                                                            const parsed = parseTime(endText);
                                                            parsed === null
                                                                ? setEndText(formatTime(end, duration >= 3600))
                                                                : commitEnd(parsed);
                                                        }}
                                                        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                                                        placeholder={formatTime(duration)}
                                                        className="mt-1 w-full rounded-lg border-0 bg-black/40 py-2.5 px-3 font-mono text-sm text-white ring-1 ring-inset ring-white/10 focus:ring-2 focus:ring-fuchsia-500"
                                                    />
                                                </label>
                                            </div>

                                            <p className="mt-2 text-[11px] text-slate-500">
                                                Type minutes and seconds like <span className="font-mono">1:30</span>, or
                                                plain seconds like <span className="font-mono">90</span>.
                                            </p>

                                            {/* Presets */}
                                            <div className="mt-3 flex flex-wrap gap-2">
                                                {[15, 30, 60, 180].map((s) =>
                                                    !hasDuration || s < duration ? (
                                                        <button
                                                            key={s}
                                                            type="button"
                                                            disabled={loading}
                                                            onClick={() => applyPreset(s)}
                                                            className="rounded-lg bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-300 ring-1 ring-inset ring-white/10 transition hover:bg-white/10 hover:text-white"
                                                        >
                                                            First {s < 60 ? `${s}s` : `${s / 60} min`}
                                                        </button>
                                                    ) : null,
                                                )}
                                                <button
                                                    type="button"
                                                    disabled={loading}
                                                    onClick={resetTrim}
                                                    className="rounded-lg bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-300 ring-1 ring-inset ring-white/10 transition hover:bg-white/10 hover:text-white"
                                                >
                                                    Whole video
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                                )}

                                {/* ------------------------------------------ */}
                                {/* Extras: mute · banner · voice               */}
                                {/* ------------------------------------------ */}
                                <div className="mt-2 grid gap-3 rounded-xl bg-black/20 p-3 sm:grid-cols-3">
                                    {/* Mute (video only) */}
                                    <div className={`flex flex-col justify-center gap-1 ${format === 'audio' ? 'pointer-events-none opacity-40' : ''}`}>
                                        <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-slate-300">
                                            <input
                                                type="checkbox"
                                                checked={mute}
                                                disabled={format === 'audio' || loading}
                                                onChange={(e) => setMute(e.target.checked)}
                                                className="h-4 w-4 rounded border-white/20 bg-black/40 text-fuchsia-500 focus:ring-fuchsia-500 focus:ring-offset-0"
                                            />
                                            Mute the video
                                        </label>
                                        <span className="pl-7 text-xs text-slate-500">Silent MP4, no audio track</span>
                                    </div>

                                    {/* Banner footer (video only) */}
                                    <div className={`flex flex-col justify-center gap-1 ${format === 'audio' ? 'pointer-events-none opacity-40' : ''}`}>
                                        <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-slate-300">
                                            <input
                                                type="checkbox"
                                                checked={banner}
                                                disabled={format === 'audio' || loading}
                                                onChange={(e) => setBanner(e.target.checked)}
                                                className="h-4 w-4 rounded border-white/20 bg-black/40 text-fuchsia-500 focus:ring-fuchsia-500 focus:ring-offset-0"
                                            />
                                            Add banner footer
                                        </label>
                                        <span className="pl-7 text-xs text-slate-500">Wide strip across the bottom</span>
                                    </div>

                                    {/* Voice effect */}
                                    <div className={`flex flex-col gap-1.5 ${format === 'video' && mute ? 'opacity-40' : ''}`}>
                                        <label className="text-sm font-medium text-slate-300">AI voice effect</label>
                                        <select
                                            value={format === 'video' && mute ? 'none' : voice}
                                            disabled={loading || (format === 'video' && mute)}
                                            onChange={(e) => setVoice(e.target.value)}
                                            className="rounded-lg border-0 bg-black/30 py-2 pl-3 pr-8 text-sm text-white ring-1 ring-inset ring-white/10 transition focus:ring-2 focus:ring-fuchsia-500 disabled:opacity-60"
                                        >
                                            <option value="none">Original voice</option>
                                            <option value="deep">Deep</option>
                                            <option value="chipmunk">Chipmunk (high)</option>
                                            <option value="robot">Robot</option>
                                        </select>
                                    </div>
                                </div>

                                {/* ------------------------------------------ */}
                                {/* Destination                                 */}
                                {/* ------------------------------------------ */}
                                <div className="mt-2 rounded-xl bg-black/20 p-3">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <span className="text-sm font-medium text-slate-300">Save it to</span>
                                        <button
                                            type="button"
                                            onClick={() => setShowNewFolder((v) => !v)}
                                            className="flex items-center gap-1.5 text-xs font-semibold text-fuchsia-400 transition hover:text-fuchsia-300"
                                        >
                                            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 10.5v6m3-3H9m4.06-7.19l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                                            </svg>
                                            New folder
                                        </button>
                                    </div>

                                    <select
                                        value={dest}
                                        disabled={loading}
                                        onChange={(e) => setDest(e.target.value)}
                                        className="mt-2 w-full rounded-lg border-0 bg-black/30 py-2.5 pl-3 pr-8 text-sm text-white ring-1 ring-inset ring-white/10 transition focus:ring-2 focus:ring-fuchsia-500 disabled:opacity-60"
                                    >
                                        <option value="">⬇ My device (straight to Downloads)</option>
                                        {folders.map((f) => (
                                            <option key={f.name} value={f.name}>
                                                📁 {f.name} ({f.count} {f.count === 1 ? 'file' : 'files'})
                                            </option>
                                        ))}
                                    </select>

                                    {showNewFolder && (
                                        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                                            <input
                                                type="text"
                                                value={newFolder}
                                                maxLength={50}
                                                onChange={(e) => setNewFolder(e.target.value)}
                                                onKeyDown={(e) => e.key === 'Enter' && !busyFolder && createFolder()}
                                                placeholder="Folder name, e.g. Tutorials"
                                                className="flex-1 rounded-lg border-0 bg-black/40 py-2.5 px-3 text-sm text-white placeholder-slate-500 ring-1 ring-inset ring-white/10 focus:ring-2 focus:ring-fuchsia-500"
                                            />
                                            <button
                                                type="button"
                                                onClick={createFolder}
                                                disabled={busyFolder || !newFolder.trim()}
                                                className="rounded-lg bg-white/10 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                {busyFolder ? 'Creating…' : 'Create'}
                                            </button>
                                        </div>
                                    )}

                                    <p className="mt-2 text-xs text-slate-500">
                                        {dest
                                            ? `Kept on the server in "${dest}" — play or re-download it any time from My library.`
                                            : 'Sent straight to your browser’s download folder and not kept on the server.'}
                                    </p>
                                </div>

                                {/* Go */}
                                <button
                                    type="button"
                                    onClick={handleDownload}
                                    disabled={loading}
                                    className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-500 to-indigo-500 px-7 py-4 text-sm font-bold text-white shadow-lg shadow-fuchsia-500/25 transition hover:opacity-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
                                >
                                    {loading ? (
                                        <>
                                            <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                            </svg>
                                            Working…
                                        </>
                                    ) : (
                                        <>
                                            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v13.5m0 0l4.5-4.5M12 16.5L7.5 12M4.5 21h15" />
                                            </svg>
                                            {dest ? `Save to "${dest}"` : 'Download'}
                                            {trimmed ? ` · ${formatTime(clipLength)} clip` : ''}
                                            {format === 'video' && mute ? ' · muted' : ''}
                                            {format === 'video' && banner ? ' · banner' : ''}
                                        </>
                                    )}
                                </button>
                            </div>

                            {/* Status / error feedback */}
                            {status && (
                                <div className="mx-auto mt-4 flex max-w-3xl items-center justify-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
                                    {loading && (
                                        <svg className="h-4 w-4 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                        </svg>
                                    )}
                                    {status}
                                </div>
                            )}
                            {error && (
                                <div className="mx-auto mt-4 max-w-3xl rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                                    {error}
                                </div>
                            )}

                            <p className="mt-4 text-xs text-slate-500">
                                By using MediaGrab you agree to only download content you have the rights to.
                            </p>
                        </section>

                        {/* ------------------------------------------------ */}
                        {/* My library                                        */}
                        {/* ------------------------------------------------ */}
                        <section id="library" ref={libraryRef} className="mx-auto max-w-5xl scroll-mt-8 px-6 py-14">
                            <div className="flex flex-wrap items-end justify-between gap-4">
                                <div>
                                    <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">My library</h2>
                                    <p className="mt-2 text-sm text-slate-400">
                                        {folders.length === 0
                                            ? 'Make a folder and every download you send to it is kept right here.'
                                            : `${folders.length} ${folders.length === 1 ? 'folder' : 'folders'} · ${totalFiles} ${totalFiles === 1 ? 'file' : 'files'}`}
                                    </p>
                                </div>

                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={refreshLibrary}
                                        className="rounded-lg bg-white/5 px-4 py-2 text-sm font-semibold text-slate-300 ring-1 ring-inset ring-white/10 transition hover:bg-white/10 hover:text-white"
                                    >
                                        Refresh
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowNewFolder(true);
                                            window.scrollTo({ top: 0, behavior: 'smooth' });
                                        }}
                                        className="rounded-lg bg-gradient-to-r from-fuchsia-500 to-indigo-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/25 transition hover:opacity-90"
                                    >
                                        New folder
                                    </button>
                                </div>
                            </div>

                            {folders.length === 0 ? (
                                <div className="mt-8 rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-12 text-center">
                                    <svg className="mx-auto h-12 w-12 text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 10.5v6m3-3H9m4.06-7.19l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                                    </svg>
                                    <p className="mt-4 text-sm text-slate-400">No folders yet.</p>
                                    <p className="mt-1 text-xs text-slate-500">
                                        Create one above, pick it under “Save it to”, and your downloads land here.
                                    </p>
                                </div>
                            ) : (
                                <div className="mt-8 space-y-4">
                                    {folders.map((folder) => (
                                        <div
                                            key={folder.name}
                                            className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur"
                                        >
                                            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
                                                <div className="flex min-w-0 items-center gap-3">
                                                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-fuchsia-500/20 to-indigo-500/20 ring-1 ring-white/10">
                                                        <svg className="h-5 w-5 text-fuchsia-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                                                        </svg>
                                                    </span>
                                                    <div className="min-w-0">
                                                        <h3 className="truncate font-semibold text-white">{folder.name}</h3>
                                                        <p className="text-xs text-slate-500">
                                                            {folder.count} {folder.count === 1 ? 'file' : 'files'} · {formatBytes(folder.size)}
                                                        </p>
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => setDest(folder.name)}
                                                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                                                            dest === folder.name
                                                                ? 'bg-fuchsia-500/20 text-fuchsia-300 ring-1 ring-inset ring-fuchsia-500/40'
                                                                : 'bg-white/5 text-slate-300 ring-1 ring-inset ring-white/10 hover:bg-white/10 hover:text-white'
                                                        }`}
                                                    >
                                                        {dest === folder.name ? '✓ Saving here' : 'Save here'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => renameFolder(folder.name)}
                                                        title="Rename folder"
                                                        className="rounded-lg bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-300 ring-1 ring-inset ring-white/10 transition hover:bg-white/10 hover:text-white"
                                                    >
                                                        Rename
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => deleteFolder(folder.name)}
                                                        title="Delete folder"
                                                        className="rounded-lg bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 ring-1 ring-inset ring-red-500/20 transition hover:bg-red-500/20"
                                                    >
                                                        Delete
                                                    </button>
                                                </div>
                                            </div>

                                            {folder.files.length === 0 ? (
                                                <p className="px-5 py-6 text-center text-sm text-slate-500">
                                                    This folder is empty.
                                                </p>
                                            ) : (
                                                <ul className="divide-y divide-white/5">
                                                    {folder.files.map((file) => (
                                                        <li
                                                            key={file.name}
                                                            className="flex flex-wrap items-center gap-3 px-5 py-3 transition hover:bg-white/[0.03]"
                                                        >
                                                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-black/40 text-slate-400">
                                                                {file.kind === 'audio' ? (
                                                                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
                                                                    </svg>
                                                                ) : (
                                                                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                                                                    </svg>
                                                                )}
                                                            </span>

                                                            <div className="min-w-0 flex-1">
                                                                <p className="truncate text-sm font-medium text-slate-200" title={file.name}>
                                                                    {file.name}
                                                                </p>
                                                                <p className="text-xs text-slate-500">
                                                                    {formatBytes(file.size)} ·{' '}
                                                                    {new Date(file.modified * 1000).toLocaleString()}
                                                                </p>
                                                            </div>

                                                            <div className="flex shrink-0 gap-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setPlayer({ ...file, folder: folder.name })}
                                                                    className="rounded-lg bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-300 ring-1 ring-inset ring-white/10 transition hover:bg-white/10 hover:text-white"
                                                                >
                                                                    Play
                                                                </button>
                                                                <a
                                                                    href={file.download_url}
                                                                    className="rounded-lg bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-300 ring-1 ring-inset ring-white/10 transition hover:bg-white/10 hover:text-white"
                                                                >
                                                                    Download
                                                                </a>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => deleteFile(folder.name, file.name)}
                                                                    className="rounded-lg bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 ring-1 ring-inset ring-red-500/20 transition hover:bg-red-500/20"
                                                                >
                                                                    Delete
                                                                </button>
                                                            </div>
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>

                        {/* Platforms */}
                        <section id="platforms" className="mx-auto max-w-5xl px-6 py-12">
                            <p className="text-center text-xs font-semibold uppercase tracking-widest text-slate-500">
                                Works with all your favorite platforms
                            </p>
                            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                                {platforms.map((p) => (
                                    <span
                                        key={p.name}
                                        className="rounded-full border border-white/10 bg-white/5 px-5 py-2 text-sm font-semibold text-slate-300 backdrop-blur transition hover:border-white/20 hover:bg-white/10"
                                    >
                                        <span className={p.color}>●</span> {p.name}
                                    </span>
                                ))}
                            </div>
                        </section>

                        {/* Features */}
                        <section id="features" className="mx-auto max-w-7xl px-6 py-16">
                            <div className="mx-auto max-w-2xl text-center">
                                <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                                    A tiny editor, not just a downloader
                                </h2>
                                <p className="mt-4 text-slate-400">
                                    See it, cut it, silence it, file it away — all before the file ever leaves this page.
                                </p>
                            </div>

                            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                                {features.map((f) => (
                                    <div
                                        key={f.title}
                                        className="group rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur transition hover:border-fuchsia-500/40 hover:bg-white/[0.06]"
                                    >
                                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-fuchsia-500/20 to-indigo-500/20 ring-1 ring-white/10 transition group-hover:from-fuchsia-500/30 group-hover:to-indigo-500/30">
                                            <svg className="h-6 w-6 text-fuchsia-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                                                {f.icon}
                                            </svg>
                                        </div>
                                        <h3 className="mt-5 text-lg font-semibold text-white">{f.title}</h3>
                                        <p className="mt-2 text-sm leading-relaxed text-slate-400">{f.desc}</p>
                                    </div>
                                ))}
                            </div>
                        </section>

                        {/* How it works */}
                        <section id="how" className="mx-auto max-w-7xl px-6 py-16">
                            <div className="mx-auto max-w-2xl text-center">
                                <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                                    Three simple steps
                                </h2>
                                <p className="mt-4 text-slate-400">
                                    From link to a trimmed, filed-away clip in under a minute.
                                </p>
                            </div>

                            <div className="mt-12 grid gap-6 md:grid-cols-3">
                                {steps.map((s) => (
                                    <div key={s.n} className="relative rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center backdrop-blur">
                                        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 to-indigo-500 text-xl font-extrabold text-white shadow-lg shadow-fuchsia-500/25">
                                            {s.n}
                                        </span>
                                        <h3 className="mt-5 text-lg font-semibold text-white">{s.title}</h3>
                                        <p className="mt-2 text-sm leading-relaxed text-slate-400">{s.desc}</p>
                                    </div>
                                ))}
                            </div>
                        </section>
                    </main>

                    {/* Footer */}
                    <footer className="border-t border-white/10">
                        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 py-10 text-sm text-slate-500 sm:flex-row">
                            <div className="flex items-center gap-2.5">
                                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-fuchsia-500 to-indigo-500">
                                    <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v13.5m0 0l4.5-4.5M12 16.5L7.5 12M4.5 21h15" />
                                    </svg>
                                </span>
                                <span className="font-semibold text-slate-400">
                                    Media<span className="text-fuchsia-400">Grab</span>
                                </span>
                            </div>
                            <p>© {new Date().getFullYear()} MediaGrab. For personal use only.</p>
                            <div className="flex gap-6">
                                <a href="#" className="transition hover:text-white">Privacy</a>
                                <a href="#" className="transition hover:text-white">Terms</a>
                                <a href="#" className="transition hover:text-white">Contact</a>
                            </div>
                        </div>
                    </footer>
                </div>

                {/* ---------------------------------------------------- */}
                {/* Player overlay                                        */}
                {/* ---------------------------------------------------- */}
                {player && (
                    <div
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
                        onClick={() => setPlayer(null)}
                    >
                        <div
                            className="w-full max-w-3xl overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-3">
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold text-white" title={player.name}>
                                        {player.name}
                                    </p>
                                    <p className="text-xs text-slate-500">
                                        {player.folder} · {formatBytes(player.size)}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setPlayer(null)}
                                    className="shrink-0 rounded-lg bg-white/5 p-2 text-slate-400 transition hover:bg-white/10 hover:text-white"
                                    aria-label="Close player"
                                >
                                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>

                            <div className="bg-black">
                                {player.kind === 'audio' ? (
                                    <div className="p-8">
                                        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                                        <audio src={player.url} controls autoPlay className="w-full" />
                                    </div>
                                ) : (
                                    /* eslint-disable-next-line jsx-a11y/media-has-caption */
                                    <video src={player.url} controls autoPlay className="max-h-[70vh] w-full bg-black" />
                                )}
                            </div>

                            <div className="flex justify-end gap-2 border-t border-white/10 px-5 py-3">
                                <a
                                    href={player.download_url}
                                    className="rounded-lg bg-gradient-to-r from-fuchsia-500 to-indigo-500 px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
                                >
                                    Download to device
                                </a>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}
