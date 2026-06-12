// Everything inside a party: strip, lobby (game shelf, playlist, proposal),
// the live play area, players panel and chat. Direct port of public/app.js
// behaviors; the server blob stays the single source of truth.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GAMES, HELP, celebrate, forgetParty } from '../state.js';
import { QRModal } from './Bits.jsx';

const roomUrl = code => `${location.origin}/r/${code}`;

// ---------- party strip ----------
function Strip({ party, g }) {
	const { roomCode, isMaster, send } = party;
	const [shareLabel, setShareLabel] = useState('Share party');
	const [showQR, setShowQR] = useState(false);

	const share = async () => {
		const data = { title: 'Puzzle Party', text: `Join my Puzzle Party — code ${roomCode}`, url: roomUrl(roomCode) };
		if (navigator.share) { try { await navigator.share(data); } catch {} }
		else {
			await navigator.clipboard.writeText(roomUrl(roomCode));
			setShareLabel('Copied!');
			setTimeout(() => setShareLabel('Share party'), 1500);
		}
	};
	const rename = () => {
		const name = prompt('Name this party', g?.name || '');
		if (name !== null) send({ t: 'rename', name: name.trim() });
	};

	return <div className="panel strip span-all">
		<div className="code">PARTY <span>{roomCode}</span>{g?.name ? ' · ' + g.name : ''}</div>
		{isMaster && <button className="ghost" title="name this party" onClick={rename}>✏️</button>}
		<button onClick={share}>{shareLabel}</button>
		<button onClick={() => setShowQR(true)}>QR</button>
		<button className="danger" onClick={() => location.href = '/'}>Leave</button>
		<QRModal open={showQR} onClose={() => setShowQR(false)} url={roomUrl(roomCode)} />
	</div>;
}

// ---------- lobby: game shelf + options + propose ----------
function readOptions(mod, vals, picked) {
	const out = {};
	for (const def of mod.optionDefs || [])
		out[def.key] = vals[`${picked}.${def.key}`] ?? (def.type === 'toggle' ? !!def.default : def.default);
	return out;
}

function CardPanel({ g, picked, vals, setVals, send }) {
	const mod = GAMES[picked];
	const [pending, setPending] = useState(false);

	const propose = async () => {
		setPending(true);
		try {
			const payload = await mod.createPuzzle(readOptions(mod, vals, picked));
			send({ t: 'propose', puzzle: {
				game: mod.key,
				summary: payload.summary,
				scoreMode: mod.scoreMode,
				durationMs: payload.duration || mod.durationMs || 0,
				payload,
			} });
		} finally {
			setPending(false);
		}
	};
	const addToPlaylist = () => {
		if (!mod || (g.lockedGames || []).includes(mod.key)) return;
		const item = { game: mod.key, options: readOptions(mod, vals, picked), label: mod.name };
		send({ t: 'playlist', list: [...(g.playlist || []), item], idx: g.playlistIdx || 0 });
	};

	return <div className="card-panel" data-skin={picked}>
		<div className="opts">
			{(mod.optionDefs || []).map(def => {
				const k = `${picked}.${def.key}`;
				return def.type === 'select'
					? <label key={k} className="opt-select">{def.label}{' '}
						<select value={vals[k] ?? def.default}
							onChange={e => setVals(v => ({ ...v, [k]: e.target.value }))}>
							{def.choices.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
						</select>
					</label>
					: <label key={k} className="opt-toggle">
						<input type="checkbox" checked={vals[k] ?? !!def.default}
							onChange={e => setVals(v => ({ ...v, [k]: e.target.checked }))} />
						{' ' + def.label}
					</label>;
			})}
		</div>
		<div className="row">
			<button className="primary" disabled={pending} onClick={propose}>Set up the round</button>
			<button onClick={addToPlaylist}>+ Playlist</button>
		</div>
	</div>;
}

function Shelf({ g, send, picked, setPicked, vals, setVals }) {
	const locked = new Set(g.lockedGames || []);
	const toggleLock = (key, ev) => {
		ev.stopPropagation();	// host locks a game off the shelf for this party
		const next = new Set(locked);
		next.has(key) ? next.delete(key) : next.add(key);
		send({ t: 'lockGames', keys: [...next] });
	};
	const cards = [];
	for (const mod of Object.values(GAMES)) {
		const isLocked = locked.has(mod.key);
		cards.push(<button key={mod.key} type="button"
			className={'game-card' + (mod.key === picked ? ' picked' : '') + (isLocked ? ' locked' : '')}
			onClick={() => {
				if (isLocked) return;
				setPicked(mod.key);
				localStorage.setItem('gs-game', mod.key);
			}}>
			<span className="gc-icon">{mod.icon}</span>
			<b>{mod.name}</b>
			<small>{mod.blurb}</small>
			<span className="gc-lock" title={isLocked ? 'unlock this game' : 'lock this game'}
				onClick={ev => toggleLock(mod.key, ev)}>{isLocked ? '🔒' : '🔓'}</span>
		</button>);
		// options live right under the selected card's row, not at the bottom
		if (mod.key === picked)
			cards.push(<CardPanel key="panel" g={g} picked={picked} vals={vals} setVals={setVals} send={send} />);
	}
	return <div className="shelf">{cards}</div>;
}

// ---------- playlist ----------
function Playlist({ g, isMaster, send }) {
	if (!g.playlist?.length) return null;
	return <div className="playlist">
		{g.playlist.map((it, i) => <div key={i}
			className={'pl-item' + (i < g.playlistIdx ? ' done' : i === g.playlistIdx ? ' next' : '')}>
			<span className="pl-mark">{i < g.playlistIdx ? '✓' : i === g.playlistIdx ? '▶' : String(i + 1)}</span>
			<span className="pl-label">{`${GAMES[it.game]?.icon || ''} ${it.label}`}</span>
			{isMaster && <button className="pl-x" onClick={() => send({ t: 'playlist',
				list: g.playlist.filter((_, j) => j !== i),
				idx: g.playlistIdx > i ? g.playlistIdx - 1 : g.playlistIdx })}>✕</button>}
		</div>)}
	</div>;
}

// ---------- lobby ----------
function Lobby({ party, g, autoCancelled }) {
	const { me, isMaster, send } = party;
	const inLobby = g.phase === 'lobby', proposed = g.phase === 'proposed';
	const [picked, setPicked] = useState(() => localStorage.getItem('gs-game') || 'gs');
	const [vals, setVals] = useState({});		// option values keyed by `${game}.${key}`
	const [countText, setCountText] = useState('');
	const autoTimer = useRef(0);
	const gRef = useRef(g);
	gRef.current = g;

	// if the picked game gets locked, fall back to the first unlocked one
	const locked = new Set(g.lockedGames || []);
	const effPicked = locked.has(picked)
		? (Object.keys(GAMES).find(k => !locked.has(k)) || 'gs') : picked;

	const proposeFromPlaylist = useCallback(async () => {
		const cur = gRef.current;
		const item = cur?.playlist[cur.playlistIdx];
		const mod = item && GAMES[item.game];
		if (!mod) return;
		const payload = await mod.createPuzzle(item.options || {});
		send({ t: 'propose', puzzle: {
			game: mod.key, summary: payload.summary, scoreMode: mod.scoreMode,
			durationMs: payload.duration || mod.durationMs || 0, payload,
			playlistIdx: cur.playlistIdx,
		} });
	}, [send]);

	// next-up bar + auto-start countdown (port of updateNextUp)
	const next = inLobby && !proposed ? g.playlist[g.playlistIdx] : null;
	useEffect(() => {
		if (!next) { clearInterval(autoTimer.current); autoTimer.current = 0; setCountText(''); return; }
		if (!isMaster) { setCountText(''); return; }
		// after the first round the playlist runs itself, with a grace countdown
		if (g.round > 0 && !autoTimer.current && !autoCancelled.current) {
			let left = 6;
			setCountText(`auto-starting in ${left}s`);
			autoTimer.current = setInterval(() => {
				if (--left <= 0) {
					clearInterval(autoTimer.current); autoTimer.current = 0;
					setCountText('');
					proposeFromPlaylist();
				} else setCountText(`auto-starting in ${left}s`);
			}, 1000);
		}
	});
	useEffect(() => () => clearInterval(autoTimer.current), []);	// unmount only

	const startNow = () => {
		clearInterval(autoTimer.current); autoTimer.current = 0;
		setCountText('');
		proposeFromPlaylist();
	};
	const cancelAuto = () => {
		autoCancelled.current = true;
		clearInterval(autoTimer.current); autoTimer.current = 0;
		setCountText('paused — host starts manually');
	};

	let title = proposed ? `Round ${g.round + 1}` : (g.round === 0 ? 'New party' : `Round ${g.round} finished`);
	if (inLobby && !isMaster) title += ` — waiting for ${g.master} to pick a game`;

	const propMod = proposed ? GAMES[g.proposal.game] : null;
	const uniqueNames = [...new Set(party.players.map(p => p.name))].length;
	const counting = countText.startsWith('auto-starting');

	return <section className="panel col-main">
		<h2>{title}</h2>
		{inLobby && isMaster &&
			<Shelf g={g} send={send} picked={effPicked} setPicked={setPicked} vals={vals} setVals={setVals} />}
		<Playlist g={g} isMaster={isMaster} send={send} />
		{next && <div className="next-up">
			<b>{`Next up: ${GAMES[next.game]?.icon || ''} ${next.label}`}</b>
			{isMaster && countText && <span className="muted">{countText}</span>}
			{isMaster && <button className="primary" onClick={startNow}>Start now</button>}
			{isMaster && counting && <button onClick={cancelAuto}>Wait</button>}
		</div>}
		{proposed && <div className="proposal">
			<b>{`${g.master} proposes: ${propMod?.icon || ''} ${g.proposal.summary}`}</b>
			<div className="row">
				{!g.agreed.includes(me.name) &&
					<button className="primary" onClick={() => send({ t: 'agree' })}>I'm ready</button>}
				{isMaster && <button onClick={() => send({ t: 'start' })}>Start anyway</button>}
			</div>
			<span className="muted">{`ready: ${g.agreed.join(', ')} (${g.agreed.length}/${uniqueNames})`}</span>
		</div>}
	</section>;
}

// ---------- play area (port of startRoundUI) ----------
function GameMount({ g, send }) {
	const rootRef = useRef(null);
	const [timerText, setTimerText] = useState('');
	const [status, setStatus] = useState({ text: '', tone: '' });
	const [helpOpen, setHelpOpen] = useState(false);

	useEffect(() => {
		const mod = GAMES[g.puzzle.game];
		const root = rootRef.current;
		root.innerHTML = '';
		setStatus({ text: '', tone: '' });

		// auto-open the help the first time you ever play each game
		const seen = JSON.parse(localStorage.getItem('gs-help-seen') || '{}');
		setHelpOpen(!seen[g.puzzle.game]);
		seen[g.puzzle.game] = true;
		localStorage.setItem('gs-help-seen', JSON.stringify(seen));

		let finished = false, nearSent = false, lastStuckEventAt = 0;
		let handle = null;
		const startTime = performance.now();
		const points = g.puzzle.scoreMode === 'points';
		const deadline = startTime + (g.puzzle.durationMs || mod?.durationMs || 0);
		setTimerText(points ? ((g.puzzle.durationMs || 0) / 1000).toFixed(0) + 's' : '0.0s');
		const timer = setInterval(() => {
			if (points) {	// points mode counts DOWN, then collects the score
				const left = Math.max(0, deadline - performance.now());
				setTimerText((left / 1000).toFixed(0) + 's');
				if (left <= 0 && !finished) {
					finished = true;
					clearInterval(timer);
					const result = handle?.endRound?.() || { points: 0 };
					send({ t: 'finish', points: result.points });
					setStatus({ text: `time! ${result.points} pts`, tone: 'won' });
				}
			} else if (!finished) {	// race mode counts up
				setTimerText(((performance.now() - startTime) / 1000).toFixed(1) + 's');
			}
		}, 100);

		if (!mod) {
			setStatus({ text: `unknown game "${g.puzzle.game}" — update your app?`, tone: 'bad' });
			return () => clearInterval(timer);
		}
		handle = mod.mount(root, {
			payload: g.puzzle.payload,
			options: {},
			finish() {
				if (finished) return;
				finished = true;
				clearInterval(timer);
				send({ t: 'finish', ms: Math.round(performance.now() - startTime) });
				celebrate();
			},
			progress(blob) {
				// a player crossing 80% is news the room enjoys
				if (blob && typeof blob.pct === 'number' && blob.pct >= 0.8 && !nearSent && !finished) {
					nearSent = true;
					send({ t: 'event', kind: 'near' });
				}
				send({ t: 'progress', data: blob });
			},
			setStatus(text, tone = '') { setStatus({ text: text || '', tone }); },
			sendStuck(stuck) {
				send({ t: 'stuck', stuck: !!stuck });
				if (stuck && Date.now() - lastStuckEventAt > 15000) {
					lastStuckEventAt = Date.now();
					send({ t: 'event', kind: 'stuck' });
				}
			},
			event(kind) { send({ t: 'event', kind }); },
		});
		return () => {
			clearInterval(timer);
			handle?.destroy?.();
			root.innerHTML = '';
		};
	}, [g.round]);	// fresh mount per round

	const mod = GAMES[g.puzzle.game];
	return <>
		<div className="game-frame">
			<div ref={rootRef} style={{ width: '100%', display: 'flex', justifyContent: 'center' }} />
		</div>
		<div className="statusbar">
			<span className="timer">{timerText}</span>
			<span className={'status' + (status.tone ? ' ' + status.tone : '')}>{status.text}</span>
		</div>
		<p className="round-label muted">{g.puzzle.summary || mod?.name || g.puzzle.game}</p>
		{HELP[g.puzzle.game] && <details className="help" open={helpOpen}
			onToggle={e => setHelpOpen(e.target.open)}>
			<summary>ⓘ how to play</summary>
			{HELP[g.puzzle.game]}
		</details>}
	</>;
}

// ---------- players ----------
function PMini({ gameKey, progress, payload }) {
	const ref = useRef(null);
	useEffect(() => {
		const el = ref.current;
		el.innerHTML = '';
		if (gameKey) GAMES[gameKey]?.renderMini(el, progress, payload);
	}, [gameKey, progress, payload]);
	return <div className="pmini" ref={ref} />;
}

function Players({ party, g }) {
	const { me, myId, isMaster, send } = party;
	const playing = g.phase === 'playing';
	const sorted = [...party.players].sort((a, b) => (g.scores[b.name] || 0) - (g.scores[a.name] || 0));

	const boot = p => {
		if (!confirm(`Remove ${p.name} from the party?`)) return;
		send({ t: 'kick', name: p.name, ban: confirm('Also block them from rejoining? OK = block, Cancel = just remove.') });
	};
	const endParty = () => {
		if (!confirm('End the party for everyone? Scores and chat are wiped.')) return;
		if (!confirm('Really end it? This cannot be undone.')) return;
		forgetParty(party.roomCode);
		send({ t: 'endParty' });
	};

	return <section className="panel col-side-1">
		<div className="score-head">
			<h2>Party scores</h2>
			<span className="muted">{g.round ? `round ${g.round}` : ''}</span>
		</div>
		{sorted.map(p => {
			// stuck flag shows on OTHER players only — half the fun is knowing
			// they're at a dead end when they might not know it themselves
			const stuck = playing && p.stuck && p.id !== myId && p.finishedMs == null;
			return <div key={p.id} className={'player' + (stuck ? ' stuck' : '')}>
				<PMini gameKey={g.puzzle?.game} progress={p.progress} payload={g.puzzle?.payload} />
				<span className="pname">{p.name + (p.id === myId ? ' (you)' : '')}</span>
				<span className="crown">{p.name === g.master ? '👑' : ''}</span>
				<span className="stuck-badge">{stuck ? '🚧 dead end' : ''}</span>
				<span className="ptime">{p.finishedMs != null ? (p.finishedMs / 1000).toFixed(1) + 's'
					: p.finishedPts != null ? p.finishedPts + ' pts' : ''}</span>
				<span className="pts">{g.scores[p.name] ?? 0}</span>
				{isMaster && p.name !== me.name &&
					<button className="boot" title="remove from party" onClick={() => boot(p)}>✕</button>}
			</div>;
		})}
		{isMaster && <>
			<div className="settings">
				<label>
					<input type="checkbox" checked={!!g.isPublic}
						onChange={e => send({ t: 'visibility', public: e.target.checked })} />
					{' discoverable — list this party on the landing page'}
				</label>
			</div>
			<div className="admin-row">
				{playing && <button onClick={() => send({ t: 'endRound' })}>End round</button>}
				<button onClick={() => send({ t: 'clearRound' })}>Clear round</button>
				<button onClick={() => { if (confirm('Reset all scores to zero?')) send({ t: 'resetScores' }); }}>Reset scores</button>
				<button className="danger" onClick={endParty}>End party</button>
			</div>
		</>}
	</section>;
}

// ---------- chat ----------
function Chat({ party, g }) {
	const { me, send } = party;
	const [text, setText] = useState('');
	const logRef = useRef(null);
	const chat = g.chat || [];

	useEffect(() => {
		logRef.current.scrollTop = logRef.current.scrollHeight;
	}, [chat.length]);

	const submit = ev => {
		ev.preventDefault();
		const t = text.trim();
		if (!t) return;
		send({ t: 'chat', text: t });
		setText('');
	};

	return <section className="panel col-side-2">
		<h2>Chat</h2>
		<div className="chat-log" ref={logRef}>
			{chat.map((m, i) => <div key={i} className={'chat-msg' + (m.name === me.name ? ' mine' : '')}>
				<b>{m.name}</b>{' '}
				{/* URLs become real links; everything else stays inert text */}
				{m.text.split(/(https?:\/\/[^\s]+)/g).map((part, j) =>
					/^https?:\/\//.test(part)
						? <a key={j} href={part} target="_blank" rel="noopener noreferrer">{part}</a>
						: part)}
			</div>)}
		</div>
		<form className="chat-row" onSubmit={submit}>
			<input value={text} maxLength={300} placeholder="say something…"
				onChange={e => setText(e.target.value)} />
			<button className="primary" type="submit">Send</button>
		</form>
	</section>;
}

// ---------- party root ----------
export default function Party({ party }) {
	const { me, game: g } = party;
	const playing = g?.phase === 'playing';
	const lastPhase = useRef(null);
	const autoCancelled = useRef(false);	// playlist auto-start "Wait" flag

	// phase transitions: reset the auto-start cancel each round; celebrate a
	// points-mode win when the podium lands (race wins celebrate in finish())
	useEffect(() => {
		if (!g) return;
		if (g.phase === 'playing' && lastPhase.current !== 'playing') autoCancelled.current = false;
		if (g.phase !== 'playing' && lastPhase.current === 'playing'
			&& g.lastResult?.winner === me.name && g.lastResult.order[0]?.points != null) celebrate();
		lastPhase.current = g.phase;
	}, [g?.phase]);

	if (!g) return null;	// waiting for the first state frame

	return <>
		<Strip party={party} g={g} />
		{g.phase === 'lobby' && g.lastResult?.winner &&
			<div className="banner span-all">
				{`🏆 ${g.lastResult.winner} wins round ${g.lastResult.round}${GAMES[g.lastResult.game] ? ` (${GAMES[g.lastResult.game].name})` : ''}! `
					+ g.lastResult.order.map(o =>
						`${o.name} ${o.ms != null ? (o.ms / 1000).toFixed(1) + 's' : (o.points || 0) + ' pts'} +${o.awarded ?? 0}`).join(' · ')}
			</div>}
		{playing
			? <div className="play col-main fade-in" data-skin={g.puzzle.game}>
				<GameMount g={g} send={party.send} />
			</div>
			: <Lobby party={party} g={g} autoCancelled={autoCancelled} />}
		<Players party={party} g={g} />
		<Chat party={party} g={g} />
	</>;
}
