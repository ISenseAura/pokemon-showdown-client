/**
 * TCG deck pack/unpack and client-side legality helpers.
 * packedTeam for TCG formats is a JSON array of card ids (server parseTcgDeck).
 *
 * Do not define a local `toID` — babel strips imports to globals, and a local
 * `toID` would overwrite Dex's and break PSIcon / getPokemonIcon.
 */

import { toID } from "./battle-dex";

export type TcgCardRow = {
	id: string,
	n: string,
	/** P / T / E */
	s: string,
	u: string[],
	t: string[],
	set: string,
	r: string,
	/** p = paper, k = pocket */
	k: string,
	i: string,
	std: number,
	pkt: number,
	b: number,
	be: number,
	ace: number,
	rad: number,
	prism: number,
};

export type TcgDeckFormat = 'standard' | 'pocket';

export type TcgDeckRules = {
	id: TcgDeckFormat,
	name: string,
	deckSize: number,
	copyLimit: number,
	energyZone: boolean,
	allowAceSpec: boolean,
	allowRadiant: boolean,
	/** Showdown format id prefix without gen */
	psFormat: string,
};

export const TCG_DECK_RULES: { [id in TcgDeckFormat]: TcgDeckRules } = {
	standard: {
		id: 'standard',
		name: 'Standard',
		deckSize: 60,
		copyLimit: 4,
		energyZone: false,
		allowAceSpec: true,
		allowRadiant: true,
		psFormat: 'tcgstandard',
	},
	pocket: {
		id: 'pocket',
		name: 'Pocket',
		deckSize: 20,
		copyLimit: 2,
		energyZone: true,
		allowAceSpec: false,
		allowRadiant: false,
		psFormat: 'tcgpocket',
	},
};

let cardIndex: TcgCardRow[] | null = null;
let byId: Map<string, TcgCardRow> | null = null;
let loadPromise: Promise<TcgCardRow[]> | null = null;

export function isTcgFormatId(format: string | undefined | null): boolean {
	const id = toID(format || '');
	return id.replace(/^gen\d/, '').startsWith('tcg');
}

export function isTcgRandomFormat(format: string | undefined | null): boolean {
	const id = toID(format || '');
	return id.includes('tcg') && id.includes('random');
}

/** Map a Showdown format id to Wave-style standard/pocket. */
export function tcgDeckFormatOf(format: string | undefined | null): TcgDeckFormat {
	const id = toID(format || '');
	if (id.includes('pocket')) return 'pocket';
	return 'standard';
}

export function showdownFormatFor(rules: TcgDeckFormat): string {
	const needle = TCG_DECK_RULES[rules].psFormat;
	const formats = typeof BattleFormats !== 'undefined' ? BattleFormats : null;
	if (formats) {
		const hit = Object.keys(formats).find(id => {
			const bare = id.replace(/^gen\d/, '');
			return bare === needle && !id.includes('random');
		});
		if (hit) return hit;
	}
	return needle;
}

export function packTcgDeck(ids: string[]): string {
	return JSON.stringify(ids.filter(Boolean));
}

export function unpackTcgDeck(packed: string | undefined | null): string[] {
	const s = String(packed || '').trim();
	if (!s) return [];
	if (s.startsWith('[')) {
		try {
			const v = JSON.parse(s) as unknown;
			if (!Array.isArray(v)) return [];
			return v.filter((x): x is string => typeof x === 'string' && !!x);
		} catch {
			return [];
		}
	}
	if (s.includes('|')) return [];
	return s.split(/[\s,]+/).filter(Boolean);
}

export function isTcgPacked(packed: string | undefined | null): boolean {
	const s = String(packed || '').trim();
	if (!s) return true; // empty TCG deck is valid storage
	if (s.startsWith('[')) {
		try {
			const v = JSON.parse(s);
			return Array.isArray(v);
		} catch {
			return false;
		}
	}
	// Pokemon VG packs always contain |
	return !s.includes('|');
}

export function loadTcgCardIndex(): Promise<TcgCardRow[]> {
	if (cardIndex) return Promise.resolve(cardIndex);
	if (loadPromise) return loadPromise;
	loadPromise = fetch('/tcg-cards-index.json')
		.then(r => {
			if (!r.ok) throw new Error(`tcg-cards-index.json ${r.status}`);
			return r.json();
		})
		.then((rows: TcgCardRow[]) => {
			cardIndex = rows;
			byId = new Map(rows.map(c => [c.id, c]));
			return rows;
		})
		.catch(err => {
			loadPromise = null;
			console.warn(err);
			cardIndex = [];
			byId = new Map();
			return cardIndex;
		});
	return loadPromise;
}

export function getTcgCard(id: string): TcgCardRow | undefined {
	return byId?.get(id);
}

export function allTcgCards(): TcgCardRow[] {
	return cardIndex || [];
}

export function cardLegalInFormat(card: TcgCardRow, format: TcgDeckFormat): boolean {
	return format === 'pocket' ? !!card.pkt : !!card.std;
}

export function copyMaxFor(card: TcgCardRow, format: TcgDeckFormat): number {
	if (card.be) return 99;
	const rules = TCG_DECK_RULES[format];
	let max = rules.copyLimit;
	if (card.ace || card.rad || card.prism) max = Math.min(max, 1);
	return max;
}

export type TcgDeckLine = { id: string, card: TcgCardRow | undefined, n: number };

/** Collapse a list of ids into qty lines, preserving first-seen order. */
export function groupDeck(ids: string[]): TcgDeckLine[] {
	const order: string[] = [];
	const counts = new Map<string, number>();
	for (const id of ids) {
		if (!counts.has(id)) order.push(id);
		counts.set(id, (counts.get(id) || 0) + 1);
	}
	return order.map(id => ({ id, card: getTcgCard(id), n: counts.get(id)! }));
}

export function deckProblemsClient(ids: string[], format: TcgDeckFormat): string[] {
	const rules = TCG_DECK_RULES[format];
	const errors: string[] = [];
	if (ids.length !== rules.deckSize) {
		errors.push(`${rules.name} decks must be ${rules.deckSize} cards (got ${ids.length}).`);
	}
	const named = new Map<string, number>();
	let ace = 0;
	let radiant = 0;
	let basics = 0;
	let energyCards = 0;
	const illegal: string[] = [];
	const over: string[] = [];

	for (const id of ids) {
		const c = getTcgCard(id);
		if (!c) {
			errors.push(`Unknown card ${id}.`);
			continue;
		}
		if (!cardLegalInFormat(c, format)) {
			illegal.push(`${c.n} (${c.id}${c.r ? `, ${c.r}` : ''})`);
		}
		if (c.b) basics++;
		if (c.ace) ace++;
		if (c.rad) radiant++;
		if (rules.energyZone && c.s === 'E') {
			energyCards++;
			continue;
		}
		if (c.be) continue;
		const n = (named.get(c.n) || 0) + 1;
		named.set(c.n, n);
		if (n === copyMaxFor(c, format) + 1) over.push(`${c.n} (max ${copyMaxFor(c, format)})`);
	}

	if (illegal.length) {
		errors.push(`Not legal in ${rules.name}: ${illegal.slice(0, 6).join(', ')}${illegal.length > 6 ? '…' : ''}`);
	}
	if (energyCards) errors.push(`${rules.name} decks do not include Energy cards (Energy Zone).`);
	if (over.length) errors.push(`Too many copies: ${over.slice(0, 6).join(', ')}${over.length > 6 ? '…' : ''}`);
	if (!rules.allowAceSpec && ace) errors.push(`${rules.name} does not allow ACE SPEC.`);
	else if (ace > 1) errors.push('Only 1 ACE SPEC card per deck.');
	if (!rules.allowRadiant && radiant) errors.push(`${rules.name} does not allow Radiant Pokemon.`);
	else if (radiant > 1) errors.push('Only 1 Radiant Pokemon per deck.');
	if (ids.length && !basics) errors.push('Deck needs at least one Basic Pokemon.');
	return errors;
}

/** Counts by supertype for the rail header. */
export function deckCounts(ids: string[]) {
	let pokemon = 0, trainer = 0, energy = 0;
	for (const id of ids) {
		const c = getTcgCard(id);
		if (!c) continue;
		if (c.s === 'P') pokemon++;
		else if (c.s === 'T') trainer++;
		else if (c.s === 'E') energy++;
	}
	return { pokemon, trainer, energy, total: ids.length };
}
