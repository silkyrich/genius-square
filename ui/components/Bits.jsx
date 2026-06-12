// Small shared bits: name modal, toasts, QR modal, feedback dialog.
import React, { useEffect, useRef, useState } from 'react';

const signIn = () => location.href = '/login?next=' + encodeURIComponent(location.pathname);

export function NameModal({ onSubmit }) {
	const ref = useRef(null);
	const [name, setName] = useState('');
	useEffect(() => { ref.current?.showModal(); }, []);
	return <dialog ref={ref}>
		<h2>Who's playing?</h2>
		<button type="button" className="google-btn" onClick={signIn}>
			<svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.8-2.1 5.1-4.4 6.7v5.5h7.1c4.2-3.9 6.6-9.6 6.6-16.2z"/><path fill="#34A853" d="M24 46c6 0 10.9-2 14.5-5.3l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.5v5.7C8.1 41.2 15.5 46 24 46z"/><path fill="#FBBC05" d="M11.8 28.3c-.4-1.3-.7-2.8-.7-4.3s.2-3 .7-4.3V14H4.5C3 17 2.1 20.4 2.1 24s.9 7 2.4 10l7.3-5.7z"/><path fill="#EA4335" d="M24 10.7c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.2 30 2 24 2 15.5 2 8.1 6.8 4.5 14l7.3 5.7c1.7-5.2 6.5-9 12.2-9z"/></svg>
			Sign in with Google
		</button>
		<p className="muted">or play as a guest</p>
		<form onSubmit={ev => { ev.preventDefault(); ref.current?.close(); onSubmit(name); }}>
			<input placeholder="your name" maxLength={24} required autoComplete="name"
				value={name} onChange={ev => setName(ev.target.value)} />
			<button className="primary">Play</button>
		</form>
	</dialog>;
}

export function Toasts({ toasts }) {
	return <div className="toasts">
		{toasts.map(t => <div className="toast" key={t.id}>{t.text}</div>)}
	</div>;
}

export function QRModal({ open, onClose, url }) {
	const ref = useRef(null);
	const [svg, setSvg] = useState('');
	useEffect(() => {
		if (!open) { ref.current?.close(); return; }
		let live = true;
		(async () => {
			const { default: qrcode } = await import(/* @vite-ignore */ '/vendor/qrcode.mjs');
			const qr = qrcode(0, 'M');
			qr.addData(url);
			qr.make();
			if (live) setSvg(qr.createSvgTag({ cellSize: 8, margin: 4, scalable: true }));
		})();
		ref.current?.showModal();
		return () => { live = false; };
	}, [open, url]);
	return <dialog ref={ref} onClose={onClose}>
		<div className="qr-box" dangerouslySetInnerHTML={{ __html: svg }} />
		<p className="muted">{url}</p>
		<button onClick={onClose}>Close</button>
	</dialog>;
}

export function FeedbackDialog({ open, onClose, party }) {
	const ref = useRef(null);
	const [shot, setShot] = useState(null);
	const [attach, setAttach] = useState(true);
	const [text, setText] = useState('');
	const [status, setStatus] = useState('');
	const [sending, setSending] = useState(false);

	useEffect(() => {
		if (!open) { ref.current?.close(); return; }
		let live = true;
		(async () => {
			// capture the page BEFORE the dialog paints over it
			setShot(null);
			setStatus('capturing screenshot…');
			try {
				const { default: html2canvas } = await import(/* @vite-ignore */ '/vendor/html2canvas.mjs');
				await new Promise(r => setTimeout(r, 60));
				const canvas = await html2canvas(document.body, {
					windowWidth: innerWidth, windowHeight: innerHeight,
					x: scrollX, y: scrollY, width: innerWidth, height: innerHeight,
					logging: false,
				});
				if (live) setShot(canvas.toDataURL('image/jpeg', 0.55));
			} catch {}
			if (!live) return;
			setStatus('');
			ref.current?.showModal();
		})();
		return () => { live = false; };
	}, [open]);

	const sendFeedback = async () => {
		const t = text.trim();
		if (!t) { setStatus('say a little something first'); return; }
		setSending(true);
		setStatus('sending…');
		try {
			const r = await (await fetch('/api/feedback', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					text: t,
					image: attach ? shot : null,
					meta: {
						url: location.href,
						party: party.roomCode || '',
						game: party.game?.phase === 'playing' ? party.game.puzzle?.game : '',
						phase: party.game?.phase || 'landing',
						player: party.me.name || '',
						ua: navigator.userAgent,
					},
				}),
			})).json();
			setText('');
			setStatus('');
			party.toast(r.issue ? `🐞 filed as ${r.issue} — thank you!` : '🐞 feedback sent — thank you!');
			onClose();
		} catch {
			setStatus('failed to send — try again?');
		}
		setSending(false);
	};

	return <dialog ref={ref} onClose={onClose}>
		<h2>Feedback / bug report</h2>
		<p className="muted">Goes straight to the dev board, with a screenshot of what you're seeing.</p>
		{shot && <img className="fb-shot" src={shot} alt="screenshot preview" />}
		<label><input type="checkbox" checked={attach} onChange={ev => setAttach(ev.target.checked)} /> attach screenshot</label>
		<textarea rows={4} placeholder="What happened? What did you expect?" maxLength={2000}
			value={text} onChange={ev => setText(ev.target.value)} />
		<div className="fb-row">
			<button className="primary" disabled={sending} onClick={sendFeedback}>Send</button>
			<button type="button" onClick={onClose}>Cancel</button>
		</div>
		<p className="muted">{status}</p>
	</dialog>;
}
