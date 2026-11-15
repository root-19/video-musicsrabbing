import { Head } from '@inertiajs/react';
import { useEffect, useRef, useState } from 'react';

// Heuristics to find a similar-sounding browser voice for the quick preview.
const previewProfiles = {
    male: { match: /david|mark|guy|james|male/i, pitch: 0.95 },
    female: { match: /zira|jenny|aria|susan|hazel|samantha|female/i, pitch: 1.1 },
};

const fallbackVoices = [
    { id: 'boy', label: 'Boy', desc: 'Normal male voice', gender: 'male' },
    { id: 'girl', label: 'Girl', desc: 'Normal female voice', gender: 'female' },
];

const genderEmoji = (gender) => (gender === 'female' ? '👧' : gender === 'male' ? '👦' : '🎤');

export default function VoiceOver({ ttsAvailable = true, voices: voiceList }) {
    const voices = voiceList?.length ? voiceList : fallbackVoices;
    const [videoFile, setVideoFile] = useState(null);
    const [videoUrl, setVideoUrl] = useState('');
    const [text, setText] = useState('');
    const [voice, setVoice] = useState(voices[0]?.id);
    const [mode, setMode] = useState('replace');
    const [effect, setEffect] = useState('none');
    const [dragging, setDragging] = useState(false);

    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState('');
    const [error, setError] = useState('');
    const [result, setResult] = useState(null); // { url, filename }
    const [previewing, setPreviewing] = useState(false);

    const fileInputRef = useRef(null);
    const textFileRef = useRef(null);

    // Revoke object URLs when they are replaced / on unmount.
    useEffect(() => () => videoUrl && URL.revokeObjectURL(videoUrl), [videoUrl]);
    useEffect(() => () => result && URL.revokeObjectURL(result.url), [result]);
    useEffect(() => () => window.speechSynthesis?.cancel(), []);

    const acceptVideo = (file) => {
        if (!file) return;
        if (!/\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(file.name)) {
            setError('Please choose a video file (MP4, MOV, WEBM, MKV or AVI).');
            return;
        }
        setError('');
        setVideoFile(file);
        setVideoUrl(URL.createObjectURL(file));
    };

    const loadTextFile = (file) => {
        if (!file) return;
        const reader = new FileReader();
        // Fill the textarea so the script stays fully editable after upload.
        reader.onload = () => setText(String(reader.result || '').slice(0, 5000));
        reader.readAsText(file);
    };

    // Quick in-browser preview of the script with a similar voice. The final
    // render is generated on the server, so this is just for editing feedback.
    const previewVoice = () => {
        const synth = window.speechSynthesis;
        if (!synth) return;

        if (previewing) {
            synth.cancel();
            setPreviewing(false);
            return;
        }
        if (!text.trim()) {
            setError('Type your script first, then press preview.');
            return;
        }

        setError('');
        const cfg = voices.find((v) => v.id === voice);
        const profile = previewProfiles[cfg?.gender] || previewProfiles.male;
        const utter = new SpeechSynthesisUtterance(text.trim());
        const all = synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'));
        const match = all.find((v) => profile.match.test(v.name)) || all[0];
        if (match) utter.voice = match;
        if (!all.find((v) => profile.match.test(v.name))) utter.pitch = profile.pitch;
        utter.onend = () => setPreviewing(false);
        utter.onerror = () => setPreviewing(false);
        synth.cancel();
        synth.speak(utter);
        setPreviewing(true);
    };

    const handleRender = async () => {
        setError('');
        setStatus('');

        if (!videoFile) {
            setError('Please upload a video first.');
            return;
        }
        if (!text.trim()) {
            setError('Please type (or upload) the text you want spoken.');
            return;
        }

        window.speechSynthesis?.cancel();
        setPreviewing(false);
        setLoading(true);
        setStatus('Generating the voice and rendering it onto your video — this can take a moment…');
        if (result) {
            URL.revokeObjectURL(result.url);
            setResult(null);
        }

        try {
            const form = new FormData();
            form.append('video', videoFile);
            form.append('text', text.trim());
            form.append('voice', voice);
            form.append('mode', mode);
            form.append('effect', effect);

            const response = await window.axios.post('/voice-over/render', form, {
                responseType: 'blob',
                timeout: 0,
            });

            const disposition = response.headers['content-disposition'] || '';
            const match = /filename\*?=(?:UTF-8'')?["']?([^"';]+)/i.exec(disposition);
            const filename = match ? decodeURIComponent(match[1]) : 'voiceover.mp4';

            const blobUrl = URL.createObjectURL(response.data);
            setResult({ url: blobUrl, filename });

            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();

            setStatus('Done! Your video was saved to your downloads. Edit the text and render again anytime.');
        } catch (e) {
            let message = 'Something went wrong. Please try again.';
            const data = e?.response?.data;
            if (data instanceof Blob) {
                try {
                    const raw = await data.text();
                    try {
                        message = JSON.parse(raw).message || message;
                    } catch {
                        if (raw) message = raw.slice(0, 300);
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
            <Head title="Voice Over Studio — MediaGrab" />
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
                        <a href="/" className="flex items-center gap-2.5">
                            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-fuchsia-500 to-indigo-500 shadow-lg shadow-fuchsia-500/25">
                                <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                                </svg>
                            </span>
                            <span className="text-lg font-bold tracking-tight text-white">
                                Media<span className="text-fuchsia-400">Grab</span>
                            </span>
                        </a>

                        <nav className="hidden items-center gap-8 text-sm font-medium text-slate-400 md:flex">
                            <a href="/" className="transition hover:text-white">Downloader</a>
                            <a href="/voice-over" className="text-white">Voice Over</a>
                        </nav>

                        <a
                            href="/"
                            className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/10"
                        >
                            ← Back to downloader
                        </a>
                    </header>

                    <main className="mx-auto max-w-4xl px-6 pb-24 pt-10 sm:pt-16">
                        <div className="text-center">
                            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium text-slate-300 backdrop-blur">
                                <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400" />
                                Voice Over Studio
                            </span>
                            <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
                                Add an{' '}
                                <span className="bg-gradient-to-r from-fuchsia-400 via-pink-400 to-indigo-400 bg-clip-text text-transparent">
                                    AI voice over
                                </span>{' '}
                                to your video
                            </h1>
                            <p className="mx-auto mt-4 max-w-2xl text-base text-slate-400 sm:text-lg">
                                Upload a video, type or upload your script, pick a boy or girl voice —
                                then edit the text and re-render as many times as you like.
                            </p>
                        </div>

                        {!ttsAvailable && (
                            <div className="mx-auto mt-6 max-w-2xl rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
                                Heads up: no text-to-speech engine is configured on this server, so rendering will fail.
                                Set <code className="font-mono">VOICEAI_API_KEY</code> in the .env file (or install{' '}
                                <code className="font-mono">espeak-ng</code>) to enable it.
                            </div>
                        )}

                        <div className="mt-10 space-y-5">
                            {/* Step 1 — upload video */}
                            <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/40 backdrop-blur sm:p-6">
                                <div className="flex items-center gap-3">
                                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 to-indigo-500 text-sm font-extrabold text-white">1</span>
                                    <h2 className="text-lg font-semibold text-white">Upload your video</h2>
                                </div>

                                <div
                                    onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                                    onDragLeave={() => setDragging(false)}
                                    onDrop={(e) => { e.preventDefault(); setDragging(false); acceptVideo(e.dataTransfer.files?.[0]); }}
                                    onClick={() => fileInputRef.current?.click()}
                                    className={`mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${
                                        dragging ? 'border-fuchsia-400 bg-fuchsia-500/10' : 'border-white/15 bg-black/20 hover:border-fuchsia-500/50 hover:bg-black/30'
                                    }`}
                                >
                                    <svg className="h-10 w-10 text-fuchsia-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                                    </svg>
                                    {videoFile ? (
                                        <>
                                            <p className="text-sm font-semibold text-white">{videoFile.name}</p>
                                            <p className="text-xs text-slate-500">
                                                {(videoFile.size / (1024 * 1024)).toFixed(1)} MB — click to choose a different video
                                            </p>
                                        </>
                                    ) : (
                                        <>
                                            <p className="text-sm font-semibold text-white">Drag &amp; drop your video here</p>
                                            <p className="text-xs text-slate-500">or click to browse — MP4, MOV, WEBM, MKV, AVI (max 300 MB)</p>
                                        </>
                                    )}
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="video/*,.mkv,.avi,.mov,.m4v"
                                        className="hidden"
                                        onChange={(e) => acceptVideo(e.target.files?.[0])}
                                    />
                                </div>

                                {videoUrl && (
                                    <video src={videoUrl} controls className="mt-4 max-h-72 w-full rounded-xl bg-black" />
                                )}
                            </section>

                            {/* Step 2 — the script (editable) */}
                            <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/40 backdrop-blur sm:p-6">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div className="flex items-center gap-3">
                                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 to-indigo-500 text-sm font-extrabold text-white">2</span>
                                        <h2 className="text-lg font-semibold text-white">Write your script</h2>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => textFileRef.current?.click()}
                                        disabled={loading}
                                        className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
                                    >
                                        📄 Upload .txt file
                                    </button>
                                    <input
                                        ref={textFileRef}
                                        type="file"
                                        accept=".txt,text/plain"
                                        className="hidden"
                                        onChange={(e) => { loadTextFile(e.target.files?.[0]); e.target.value = ''; }}
                                    />
                                </div>

                                <textarea
                                    value={text}
                                    onChange={(e) => setText(e.target.value.slice(0, 5000))}
                                    disabled={loading}
                                    rows={6}
                                    placeholder="Type the words you want the voice to say… You can edit this anytime, even after rendering."
                                    className="mt-4 w-full resize-y rounded-xl border-0 bg-black/30 p-4 text-sm leading-relaxed text-white placeholder-slate-500 ring-1 ring-inset ring-white/10 transition focus:ring-2 focus:ring-fuchsia-500 disabled:opacity-60"
                                />
                                <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                                    <span>Fully editable — change the text and render again anytime.</span>
                                    <span>{text.length} / 5000</span>
                                </div>
                            </section>

                            {/* Step 3 — voice + options */}
                            <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/40 backdrop-blur sm:p-6">
                                <div className="flex items-center gap-3">
                                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 to-indigo-500 text-sm font-extrabold text-white">3</span>
                                    <h2 className="text-lg font-semibold text-white">Choose the voice</h2>
                                </div>

                                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                    {voices.map((v) => (
                                        <button
                                            key={v.id}
                                            type="button"
                                            onClick={() => setVoice(v.id)}
                                            disabled={loading}
                                            className={`flex items-center gap-3 rounded-xl border p-3.5 text-left transition ${
                                                voice === v.id
                                                    ? 'border-fuchsia-500/60 bg-fuchsia-500/10 ring-1 ring-fuchsia-500/40'
                                                    : 'border-white/10 bg-black/20 hover:border-white/25 hover:bg-black/30'
                                            }`}
                                        >
                                            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl ${
                                                voice === v.id ? 'bg-gradient-to-br from-fuchsia-500 to-indigo-500' : 'bg-white/10'
                                            }`}>
                                                {genderEmoji(v.gender)}
                                            </span>
                                            <span className="min-w-0">
                                                <span className="block truncate text-sm font-bold text-white">{v.label}</span>
                                                <span className="block truncate text-xs text-slate-400">{v.desc}</span>
                                            </span>
                                            {voice === v.id && (
                                                <svg className="ml-auto h-5 w-5 shrink-0 text-fuchsia-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                </svg>
                                            )}
                                        </button>
                                    ))}
                                </div>

                                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="flex flex-wrap items-center gap-3">
                                        <button
                                            type="button"
                                            onClick={previewVoice}
                                            disabled={loading}
                                            className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
                                        >
                                            {previewing ? '⏹ Stop preview' : '▶ Preview voice'}
                                        </button>

                                        <select
                                            value={effect}
                                            disabled={loading}
                                            onChange={(e) => setEffect(e.target.value)}
                                            title="Voice effect"
                                            className="rounded-lg border-0 bg-black/30 py-2 pl-3 pr-8 text-sm text-white ring-1 ring-inset ring-white/10 transition focus:ring-2 focus:ring-fuchsia-500 disabled:opacity-50"
                                        >
                                            <option value="none">Normal voice</option>
                                            <option value="deep">Deep</option>
                                            <option value="chipmunk">Chipmunk (high)</option>
                                            <option value="robot">Robot</option>
                                        </select>
                                    </div>

                                    <div className="flex items-center gap-4 text-sm">
                                        {[
                                            { id: 'replace', label: 'Replace original audio' },
                                            { id: 'mix', label: 'Mix over original audio' },
                                        ].map((opt) => (
                                            <label key={opt.id} className="flex cursor-pointer items-center gap-2 font-medium text-slate-300">
                                                <input
                                                    type="radio"
                                                    name="mode"
                                                    checked={mode === opt.id}
                                                    disabled={loading}
                                                    onChange={() => setMode(opt.id)}
                                                    className="h-4 w-4 border-white/20 bg-black/40 text-fuchsia-500 focus:ring-fuchsia-500 focus:ring-offset-0"
                                                />
                                                {opt.label}
                                            </label>
                                        ))}
                                    </div>
                                </div>
                                <p className="mt-2 text-xs text-slate-500">
                                    The <strong className="text-slate-300">Boy</strong> and <strong className="text-slate-300">Girl</strong> voices are free and built-in (no credits). The other voices use the Voice AI studio and sound more natural but use API credits. The preview uses your browser's voice.
                                </p>
                            </section>

                            {/* Render */}
                            <button
                                type="button"
                                onClick={handleRender}
                                disabled={loading}
                                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-500 to-indigo-500 px-7 py-4 text-sm font-bold text-white shadow-lg shadow-fuchsia-500/25 transition hover:opacity-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
                            >
                                {loading ? (
                                    <>
                                        <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                        </svg>
                                        Rendering your voice over…
                                    </>
                                ) : (
                                    <>
                                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                                        </svg>
                                        {result ? 'Render again with edited text' : 'Render voice over'}
                                    </>
                                )}
                            </button>

                            {/* Status / error feedback */}
                            {status && (
                                <div className="flex items-center justify-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
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
                                <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                                    {error}
                                </div>
                            )}

                            {/* Result preview */}
                            {result && (
                                <section className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-5 backdrop-blur sm:p-6">
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <h2 className="text-lg font-semibold text-white">✅ Your rendered video</h2>
                                        <a
                                            href={result.url}
                                            download={result.filename}
                                            className="rounded-lg bg-gradient-to-r from-fuchsia-500 to-indigo-500 px-4 py-2 text-sm font-semibold text-white shadow transition hover:opacity-90"
                                        >
                                            ⬇ Download again
                                        </a>
                                    </div>
                                    <video src={result.url} controls className="mt-4 max-h-96 w-full rounded-xl bg-black" />
                                    <p className="mt-2 text-xs text-slate-400">
                                        Not happy with it? Edit the script above and hit render again — your video stays loaded.
                                    </p>
                                </section>
                            )}
                        </div>
                    </main>
                </div>
            </div>
        </>
    );
}
