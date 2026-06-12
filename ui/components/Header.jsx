// App chrome: title, feedback, theme toggle, identity.
import React, { useState } from 'react';
import { FeedbackDialog } from './Bits.jsx';

export default function Header({ party, theme, setTheme }) {
	const [fbOpen, setFbOpen] = useState(false);
	const signIn = () => location.href = '/login?next=' + encodeURIComponent(location.pathname);
	const logOut = () => {
		localStorage.removeItem('gs-name');
		location.href = '/logout';
	};
	return <header className="header">
		<img className="logo" src="/icon.png" alt="" />
		<h1>Puzzle <em>Party</em></h1>
		<button className="ghost" title="report a problem / give feedback" onClick={() => setFbOpen(true)}>🐞</button>
		<button className="ghost" title="dark / light" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>◐</button>
		<div className="who">
			{party.me.name && <span>{party.me.name}{party.me.email ? '' : ' (guest)'}</span>}
			{!party.me.email && <button onClick={signIn}>sign in</button>}
			{(party.me.email || party.me.name) && <button className="ghost" onClick={logOut}>log out</button>}
		</div>
		<FeedbackDialog open={fbOpen} onClose={() => setFbOpen(false)} party={party} />
	</header>;
}
