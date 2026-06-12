// Landing page: start/join a party, local party history, open parties.
import React, { useEffect, useState } from 'react';
import { GAMES, myParties, forgetParty } from '../state.js';

const when = ts => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export default function Landing({ party }) {
	const [code, setCode] = useState('');
	const [mine, setMine] = useState(myParties);
	const [open, setOpen] = useState([]);

	useEffect(() => {
		let live = true;
		const refresh = async () => {
			try {
				const list = await (await fetch('/api/parties')).json();
				if (live) setOpen(list);
			} catch {}
		};
		refresh();
		const timer = setInterval(refresh, 10000);
		return () => { live = false; clearInterval(timer); };
	}, []);

	const join = () => { if (/^[A-Z]{4}$/.test(code)) party.enterParty(code); };

	return <section className="landing fade-in">
		<img className="hero" src="/hero.svg" alt="Puzzle Party games" />
		<h2>Race your friends. Any puzzle, one party.</h2>
		<p className="muted">Start a party, share the code or QR, then swap between Genius Square, Genius Star,
		Sudoku, Boggle, Pipes and more, round by round. Scores roll up across every game.</p>
		<button className="primary big" onClick={() => party.enterParty()}>Start a party</button>
		<div className="join-row">
			<input placeholder="or enter a party code" maxLength={4} autoCapitalize="characters"
				value={code} onChange={ev => setCode(ev.target.value.toUpperCase())}
				onKeyDown={ev => ev.key === 'Enter' && join()} />
			<button onClick={join}>Join</button>
		</div>
		{!!mine.length && <>
			<h3>Your parties</h3>
			<div className="party-list">
				{mine.map(p =>
					<button key={p.code} type="button" className="party-card" onClick={() => party.enterParty(p.code)}>
						<b>{p.mine ? '👑 ' : ''}{p.code}{p.name ? ' · ' + p.name : ''}</b>
						<small>{p.mine ? 'your party' : 'host: ' + (p.host || '?')} · last visited {when(p.ts)}</small>
						<span className="x" title="forget this party"
							onClick={ev => { ev.stopPropagation(); forgetParty(p.code); setMine(myParties()); }}>✕</span>
					</button>)}
			</div>
		</>}
		<h3>Open parties</h3>
		<div className="party-list">
			{open.length ? open.map(p =>
				<button key={p.code} type="button" className="party-card" onClick={() => party.enterParty(p.code)}>
					<b>🎲 {p.code}{p.name ? ' · ' + p.name : ''}</b>
					<span>{p.host || 'someone'} · {p.players} player{p.players === 1 ? '' : 's'}</span>
					<small>{p.phase === 'playing' ? `playing ${GAMES[p.game]?.name || p.game}` : 'in the lobby'}</small>
				</button>)
				: <p className="muted">No open parties right now — start one and flip on “discoverable”.</p>}
		</div>
	</section>;
}
