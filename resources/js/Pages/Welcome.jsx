import { Head } from '@inertiajs/react';
import { useState } from 'react';

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
        title: 'Lightning Fast',
        desc: 'Our servers grab and process your media in seconds — no waiting, no throttling.',
        icon: (
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"
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
    {
        title: 'Any Device',
        desc: 'Works right in your browser on desktop, tablet, and mobile — nothing to install.',
        icon: (
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25"
            />
        ),
    },
    {
        title: 'Unlimited Downloads',
        desc: 'Save as many videos and tracks as you like — always free, no daily limits.',
        icon: (
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"
            />
        ),
    },
    {
        title: 'Safe & Private',
        desc: 'We never store your files or track your activity. Your downloads stay yours.',
        icon: (
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
            />
        ),
    },
];

const steps = [
    { n: '1', title: 'Copy the link', desc: 'Grab the URL of any video or track from your favorite site.' },
    { n: '2', title: 'Paste it above', desc: 'Drop the link into the box and pick your format — video or audio.' },
    { n: '3', title: 'Download', desc: 'Hit the button and your file is ready in seconds. That easy.' },
];

export default function Welcome() {
    const [url, setUrl] = useState('');
    const [format, setFormat] = useState('video');
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState('');
    const [error, setError] = useState('');

    // Optional post-processing.
    const [banner, setBanner] = useState(false);
    const [voice, setVoice] = useState('none');

    const handleDownload = async () => {
        setError('');
        setStatus('');

        const link = url.trim();
        if (!link) {
            setError('Please paste a link first.');
            return;
        }

        setLoading(true);
        setStatus(
            format === 'audio'
                ? 'Extracting audio — this can take a moment…'
                : 'Grabbing video — this can take a moment…',
        );

        try {
            const response = await window.axios.post(
                '/download',
                {
                    url: link,
                    format,
                    banner: format === 'video' && banner,
                    voice,
                },
                { responseType: 'blob', timeout: 0 },
            );

            // Pull the filename from the Content-Disposition header.
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

            setStatus('Done! Your file has been saved to your downloads.');
        } catch (e) {
            let message = 'Something went wrong. Please check the link and try again.';
            const data = e?.response?.data;
            if (data instanceof Blob) {
                try {
                    const text = await data.text();
                    try {
                        message = JSON.parse(text).message || message;
                    } catch {
                        if (text) message = text.slice(0, 300);
                    }
                } catch {
                    /* keep default */
                }
            } else if (data?.message) {
                message = data.message;
            }
            setError(message);
            setStatus('');
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <Head title="MediaGrab — Free Video & Music Downloader" />
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
                            <a href="#platforms" className="transition hover:text-white">Platforms</a>
                        </nav>

                        <a
                            href="#"
                            className="rounded-lg bg-gradient-to-r from-fuchsia-500 to-indigo-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/25 transition hover:opacity-90"
                        >
                            Download now
                        </a>
                    </header>

                    {/* Hero */}
                    <main>
                        <section className="mx-auto max-w-4xl px-6 pt-16 pb-10 text-center sm:pt-24">
                            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium text-slate-300 backdrop-blur">
                                <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400" />
                                100% free · No watermarks · No limits
                            </span>

                            <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-white sm:text-6xl">
                                Download any{' '}
                                <span className="bg-gradient-to-r from-fuchsia-400 via-pink-400 to-indigo-400 bg-clip-text text-transparent">
                                    video &amp; music
                                </span>
                                <br className="hidden sm:block" /> in seconds
                            </h1>

                            <p className="mx-auto mt-5 max-w-2xl text-base text-slate-400 sm:text-lg">
                                Paste a link from YouTube, TikTok, Instagram, SoundCloud and more.
                                Save HD videos or extract high-quality MP3 audio — right in your browser.
                            </p>

                            {/* Download box */}
                            <div className="mx-auto mt-10 max-w-2xl rounded-2xl border border-white/10 bg-white/[0.04] p-2 shadow-2xl shadow-black/40 backdrop-blur">
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

                                <div className="flex flex-col gap-2 sm:flex-row">
                                    <div className="relative flex-1">
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
                                            className="w-full rounded-xl border-0 bg-black/30 py-4 pl-12 pr-4 text-sm text-white placeholder-slate-500 ring-1 ring-inset ring-white/10 transition focus:ring-2 focus:ring-fuchsia-500 disabled:opacity-60"
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleDownload}
                                        disabled={loading}
                                        className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-500 to-indigo-500 px-7 py-4 text-sm font-bold text-white shadow-lg shadow-fuchsia-500/25 transition hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
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
                                                Download
                                            </>
                                        )}
                                    </button>
                                </div>

                                {/* Optional extras: banner overlay + voice effect */}
                                <div className="mt-2 grid gap-2 rounded-xl bg-black/20 p-3 sm:grid-cols-2">
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
                                        <span className="pl-6.5 text-xs text-slate-500">
                                            Wide strip stretched across the bottom edge
                                        </span>
                                    </div>

                                    {/* Voice effect */}
                                    <div className="flex flex-col gap-2">
                                        <label className="text-sm font-medium text-slate-300">
                                            AI voice effect
                                        </label>
                                        <select
                                            value={voice}
                                            disabled={loading}
                                            onChange={(e) => setVoice(e.target.value)}
                                            className="rounded-lg border-0 bg-black/30 py-2 pl-3 pr-8 text-sm text-white ring-1 ring-inset ring-white/10 transition focus:ring-2 focus:ring-fuchsia-500 disabled:opacity-50"
                                        >
                                            <option value="none">Original voice</option>
                                            <option value="deep">Deep</option>
                                            <option value="chipmunk">Chipmunk (high)</option>
                                            <option value="robot">Robot</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            {/* Status / error feedback */}
                            {status && (
                                <div className="mx-auto mt-4 flex max-w-2xl items-center justify-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
                                    {loading && (
                                        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                        </svg>
                                    )}
                                    {status}
                                </div>
                            )}
                            {error && (
                                <div className="mx-auto mt-4 max-w-2xl rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                                    {error}
                                </div>
                            )}

                            <p className="mt-4 text-xs text-slate-500">
                                By using MediaGrab you agree to only download content you have the rights to.
                            </p>
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
                                    Everything you need to save media
                                </h2>
                                <p className="mt-4 text-slate-400">
                                    Powerful, fast, and free. Built for people who just want their media without the hassle.
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
                                    From link to download in under a minute — no experience required.
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

                        {/* CTA */}
                        <section className="mx-auto max-w-5xl px-6 py-16">
                            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-fuchsia-600/20 via-indigo-600/20 to-slate-900 p-10 text-center sm:p-16">
                                <div className="pointer-events-none absolute -top-20 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-fuchsia-500/30 blur-3xl" />
                                <div className="relative">
                                    <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                                        Ready to grab your media?
                                    </h2>
                                    <p className="mx-auto mt-4 max-w-xl text-slate-300">
                                        Scroll up, paste a link, and download your first video or track for free — right now.
                                    </p>
                                    <a
                                        href="#"
                                        className="mt-8 inline-flex items-center gap-2 rounded-xl bg-white px-8 py-4 text-sm font-bold text-slate-900 shadow-lg transition hover:bg-slate-100 active:scale-[0.98]"
                                    >
                                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v13.5m0 0l4.5-4.5M12 16.5L7.5 12M4.5 21h15" />
                                        </svg>
                                        Start downloading
                                    </a>
                                </div>
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
            </div>
        </>
    );
}
