import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './app.css';
import { loadGames } from './state.js';

loadGames().then(() => {
	createRoot(document.getElementById('root')).render(<App />);
});
