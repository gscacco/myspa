/** Configured Marked parser for Loom-specific inline syntax. */

import { Marked } from '../../node_modules/marked/lib/marked.esm.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ITEM_REFERENCE = /^\[\[item:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\]\]/i;

const parser = new Marked({ gfm: true });
parser.use({
  extensions: [{
    name: 'loomItemReference',
    level: 'inline',
    start(source) {
      const index = source.indexOf('[[item:');
      return index < 0 ? undefined : index;
    },
    tokenizer(source) {
      const match = ITEM_REFERENCE.exec(source);
      if (!match || !UUID.test(match[1])) return undefined;
      return { type: 'loomItemReference', raw: match[0], id: match[1] };
    },
  }],
});

export function lexMarkdown(source) {
  return parser.lexer(source);
}
