import { emptyKnowledgeBase } from './model.js';

const base = emptyKnowledgeBase();
document.querySelector('#loom-status').textContent = `${base.items.length} items`;
document.querySelector('#loom-app').dataset.ready = 'true';
