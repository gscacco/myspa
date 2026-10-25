/** Configured Marked parser for Loom-specific inline syntax. */

import { Marked } from '../../node_modules/marked/lib/marked.esm.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ITEM_REFERENCE = /^\[\[item:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\]\]/i;
const ITEM_TRANSCLUSION = /^!\[\[item:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:#([a-z0-9-]+))?\]\]/i;
const ESCAPED_ITEM_TRANSCLUSION = /^\\!\[\[item:[^\]]+\]\]/;

const parser = new Marked({ gfm: true });
parser.use({
  extensions: [
    {
      name: 'loomItemTransclusion',
      level: 'block',
      start(source) {
        const index = source.search(/^ {0,3}!\[\[item:/m);
        return index < 0 ? undefined : index;
      },
      tokenizer(source) {
        const match = /^ {0,3}(!\[\[item:[^\]]+\]\])[ \t]*(?:\n+|$)/.exec(source);
        if (!match) return undefined;
        const target = ITEM_TRANSCLUSION.exec(match[1]);
        if (!target || !UUID.test(target[1])) return undefined;
        return { type: 'loomTransclusion', raw: match[0], id: target[1], section: target[2] || null };
      },
    },
    {
      name: 'loomInlineItemTransclusion',
      level: 'inline',
      start(source) {
        const escaped = source.indexOf('\\![[item:'), embedded = source.indexOf('![[item:');
        if (escaped >= 0 && (embedded < 0 || escaped < embedded)) return escaped;
        return embedded < 0 ? undefined : embedded;
      },
      tokenizer(source) {
        const escaped = ESCAPED_ITEM_TRANSCLUSION.exec(source);
        if (escaped) return { type: 'text', raw: escaped[0], text: escaped[0].slice(1) };
        const match = ITEM_TRANSCLUSION.exec(source);
        if (!match || !UUID.test(match[1])) return undefined;
        return { type: 'loomTransclusion', raw: match[0], id: match[1], section: match[2] || null };
      },
    },
    {
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
    },
  ],
});

export function lexMarkdown(source) {
  return parser.lexer(source);
}
