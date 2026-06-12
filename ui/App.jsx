import React, { useEffect, useState } from 'react';
import { usePartyState } from './state.js';
import Header from './components/Header.jsx';
import Landing from './components/Landing.jsx';
import Party from './components/Party.jsx';
import { NameModal, Toasts } from './components/Bits.jsx';

export default function App() {
	const party = usePartyState();
	const [theme, setTheme] = useState(
		localStorage.getItem('gs-theme')
		|| (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

	useEffect(() => {
		document.documentElement.dataset.theme = theme;
		localStorage.setItem('gs-theme', theme);
	}, [theme]);

	return <>
		<Header party={party} theme={theme} setTheme={setTheme} />
		<main>
			{party.inParty ? <Party party={party} /> : <Landing party={party} />}
		</main>
		{party.needName && <NameModal onSubmit={party.submitName} />}
		<Toasts toasts={party.toasts} />
	</>;
}
