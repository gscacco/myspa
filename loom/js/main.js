import { createLoomApp } from './app.js';

let storage = null;
try { storage = window.localStorage; } catch { /* Local storage can be unavailable in restricted contexts. */ }

createLoomApp({ document, window, storage });
