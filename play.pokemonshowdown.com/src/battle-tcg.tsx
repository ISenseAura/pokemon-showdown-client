/**
 * Pokémon TCG board — Pocket / Live-style playmat for the Preact client.
 *
 * @license AGPLv3
 */

import preact from "../js/lib/preact";
import { PS } from "./client-main";

export function isTcgBattleId(id: string): boolean {
	const format = id.split('-')[1] || '';
	return format.startsWith('tcg');
}

export type TcgSlot = 'active' | number;
export type TcgAction = { type: string, [k: string]: any };
/** WaveTCG TcgEvent — animate in seq order (docs/graphics.md). */
export type TcgEvent = { seq: number, type: string, [k: string]: any };
/** @deprecated use TcgEvent */
export type TcgFxEvent = TcgEvent;

export interface TcgPokemonView {
	iid: string;
	cardId: string;
	name: string;
	hp: number;
	maxHp: number;
	types?: string[];
	energy?: string[];
	tools?: string[];
	attacks?: { name?: string, cost?: string[], damage?: string }[];
	abilities?: { name?: string }[];
	status?: string | null;
	poisoned?: boolean;
	burned?: boolean;
	image?: string;
	lastDelta?: number;
	/** Opponent's setup Pokémon: placed face down until both players are ready (client-side placeholder). */
	faceDown?: boolean;
}

export interface TcgPlayerView {
	id: string;
	name: string;
	active: TcgPokemonView | null;
	bench: TcgPokemonView[];
	hand: string[] | { count: number };
	deck: { count: number };
	discard: string[];
	prizes?: { count: number };
	stadium?: string | null;
	setup?: string;
	energyZone?: { type: string, next?: string, ready?: boolean };
	points?: number;
}

export interface TcgSnapshot {
	status?: string;
	winner?: number | null;
	winReason?: string;
	turn?: number;
	turnNumber?: number;
	you?: number | null;
	actions: TcgAction[];
	players: TcgPlayerView[];
	format?: { benchSize?: number, energyZone?: boolean, prizes?: number, name?: string };
	pendingSearch?: { kind?: string, left?: number, upTo?: boolean, zone?: string, dest?: string };
	pendingDiscard?: { need: number };
	pendingRetreatPay?: { need: number };
	pendingConfirm?: { title?: string, text?: string };
	pendingPromote?: number;
	pendingFirst?: number;
	pendingPrize?: { seat: number, n: number };
}

type Preview = { cardId: string, image?: string, name?: string };

/** One replay-player FX beat (Unreal-Bot graphics.js fxFor + hits). */
type FxHit = {
	iid: string, amount?: number, kind: 'damage' | 'heal' | 'status',
	src?: string, label?: string, element?: string,
};
type FxBeat = {
	kind: string,
	tag?: string,
	iid?: string,
	targetIid?: string,
	seat?: number,
	amount?: number,
	n?: number,
	extra?: string,
	/** Full board message, e.g. "Opponent is searching their deck". */
	message?: string,
	cardId?: string,
	fromCardId?: string,
	src?: string,
	onto?: string,
	ontoId?: string,
	ids?: string[],
	labels?: string[],
	hits?: FxHit[],
	/** Ordered heads/tails results for a coin beat (one or many flips). */
	coins?: boolean[],
	tie?: boolean,
	element?: string,
	slot?: TcgSlot,
	fromBench?: boolean,
};
type PkFx = { cls: string, dataFx?: string, tick?: number, element?: string };
type KoGhost = {
	iid: string,
	cardId: string,
	name: string,
	image?: string,
	hp?: number,
	maxHp?: number,
	seat: number,
	slot: TcgSlot,
};

function whoName(players: TcgPlayerView[] | undefined, seat: number | undefined): string {
	if (seat == null) return 'a player';
	return players?.[seat]?.name || `Player ${seat + 1}`;
}
/** "You" / "Opponent" / display name for board FX copy. */
function actorLabel(
	players: TcgPlayerView[] | undefined,
	seat: number | undefined,
	you?: number | null,
): string {
	if (seat == null) return 'A player';
	if (you != null && seat === you) return 'You';
	if (you != null) return 'Opponent';
	return whoName(players, seat);
}
function actorIsYou(seat: number | undefined, you?: number | null): boolean {
	return you != null && seat != null && seat === you;
}
function findMonView(players: TcgPlayerView[] | undefined, iid?: string): TcgPokemonView | null {
	return findMonSlot(players, iid)?.mon || null;
}
function findMonSlot(
	players: TcgPlayerView[] | undefined,
	iid?: string,
): { seat: number, slot: TcgSlot, mon: TcgPokemonView } | null {
	if (!iid || !players) return null;
	for (let seat = 0; seat < players.length; seat++) {
		const p = players[seat];
		if (!p) continue;
		if (p.active?.iid === iid) return { seat, slot: 'active', mon: p.active };
		const bench = p.bench || [];
		for (let i = 0; i < bench.length; i++) {
			if (bench[i]?.iid === iid) return { seat, slot: i, mon: bench[i]! };
		}
	}
	return null;
}
function placeSlotOf(e: TcgEvent): TcgSlot {
	if (e.slot === 'active' || e.slot == null || e.slot === '') return 'active';
	const n = Number(e.slot);
	return Number.isFinite(n) ? n : 'active';
}
/** Names from earlier boards, so a KO still has a name after the Pokémon leaves play. */
const seenMonNames = new Map<string, string>();
const seenCardNames = new Map<string, string>();
export function noteTcgMons(players: TcgPlayerView[] | undefined) {
	if (!players) return;
	for (const p of players) {
		const mons = [p?.active, ...(p?.bench || [])];
		for (const mon of mons) {
			if (mon?.iid && mon.name) seenMonNames.set(mon.iid, mon.name);
			if (mon?.cardId && mon.name && mon.name !== mon.cardId) seenCardNames.set(mon.cardId, mon.name);
		}
	}
}
function monName(players: TcgPlayerView[] | undefined, iid?: string): string {
	return findMonView(players, iid)?.name || (iid && seenMonNames.get(iid)) || 'a Pokémon';
}
const printedNames: { [id: string]: string } = {
	'base1-97': 'Grass Energy',
	'base1-98': 'Fire Energy',
	'base1-99': 'Water Energy',
	'base1-100': 'Lightning Energy',
	'base1-101': 'Psychic Energy',
	'base1-102': 'Fighting Energy',
	// Scarlet & Violet basic Energy (the Pocket Energy Zone attaches these ids).
	'sve-1': 'Grass Energy', 'sve-2': 'Fire Energy', 'sve-3': 'Water Energy', 'sve-4': 'Lightning Energy',
	'sve-5': 'Psychic Energy', 'sve-6': 'Fighting Energy', 'sve-7': 'Darkness Energy', 'sve-8': 'Metal Energy',
	'sve-9': 'Grass Energy', 'sve-10': 'Fire Energy', 'sve-11': 'Water Energy', 'sve-12': 'Lightning Energy',
	'sve-13': 'Psychic Energy', 'sve-14': 'Fighting Energy', 'sve-15': 'Darkness Energy', 'sve-16': 'Metal Energy',
};
const printedNamesLoaded: { [file: string]: boolean } = {};
function loadPrintedNames(file = '/tcg-names.json') {
	if (printedNamesLoaded[file] || typeof fetch !== 'function') return;
	printedNamesLoaded[file] = true;
	fetch(file).then(res => res.ok ? res.json() : null).then(data => {
		if (data) Object.assign(printedNames, data);
	}).catch(() => { /* keep board names and the basic-energy map */ });
}
loadPrintedNames();
/** The paper (Standard / Expanded / GLC) card index is ~20k entries; only pull it for a paper game. */
export function loadPaperNames() {
	loadPrintedNames('/tcg-names-paper.json');
}
function printedName(id?: string): string {
	if (!id) return '';
	if (printedNames[id]) return printedNames[id];
	const promo = /^P-([A-Za-z])-0*(\d+)$/.exec(id);
	if (promo) {
		const key = `PROMO-${promo[1].toUpperCase()}-${promo[2]}`;
		if (printedNames[key]) return printedNames[key];
	}
	const num = /^(.*)-0*(\d+)$/.exec(id);
	if (num && printedNames[`${num[1]}-${num[2]}`]) return printedNames[`${num[1]}-${num[2]}`];
	const energy = /^energy-([a-z]+)$/i.exec(id);
	if (energy) {
		const t = energy[1].toLowerCase();
		return t.charAt(0).toUpperCase() + t.slice(1) + ' Energy';
	}
	return '';
}
function cardName(players: TcgPlayerView[] | undefined, cardId?: string, iid?: string): string {
	const fromIid = findMonView(players, iid)?.name;
	if (fromIid && fromIid !== cardId) return fromIid;
	if (cardId && players) {
		for (let s = 0; s < players.length; s++) {
			const p = players[s];
			const mons = [p?.active, ...(p?.bench || [])];
			for (let i = 0; i < mons.length; i++) {
				const mon = mons[i];
				if (mon?.cardId === cardId && mon.name && mon.name !== cardId) return mon.name;
			}
		}
	}
	if (iid && seenMonNames.get(iid) && seenMonNames.get(iid) !== cardId) return seenMonNames.get(iid)!;
	if (cardId && seenCardNames.get(cardId)) return seenCardNames.get(cardId)!;
	return printedName(cardId);
}
/** Printed card name when the index knows it; falls back to the raw id so nothing is blank. */
function cardLabel(id?: string): string {
	if (!id) return 'a card';
	return seenCardNames.get(id) || printedName(id) || id;
}
function statusWord(s: string | null | undefined): string {
	const t = String(s || '').toLowerCase();
	if (t === 'asleep') return 'Asleep';
	if (t === 'burned') return 'Burned';
	if (t === 'confused') return 'Confused';
	if (t === 'paralyzed') return 'Paralyzed';
	if (t === 'poisoned') return 'Poisoned';
	return s || '';
}
function clusterSkip(t: string): boolean {
	return t === 'request' || t === 'act' || t === 'coin' || t === 'damage' || t === 'heal' || t === 'status';
}
function afterKind(events: TcgEvent[], i: number, kind: string): boolean {
	for (let j = i - 1; j >= 0; j--) {
		const p = events[j];
		if (!p) return false;
		const t = String(p.type || '');
		if (t === kind) return true;
		if (clusterSkip(t)) continue;
		return false;
	}
	return false;
}
/** Pocket energy names. "electric" and "steel" are accepted as aliases. */
function energyElement(raw?: string): string {
	const t = String(raw || '').toLowerCase();
	if (t === 'electric' || t === 'lightning') return 'lightning';
	if (t === 'steel' || t === 'metal') return 'metal';
	if (t === 'dark' || t === 'darkness') return 'darkness';
	if (t === 'normal' || t === 'colorless') return 'colorless';
	if ([
		'grass', 'fire', 'water', 'psychic', 'fighting', 'fairy', 'dragon',
	].includes(t)) return t;
	return '';
}
function attackElement(e: TcgEvent, players?: TcgPlayerView[]): string {
	const fromEvent = energyElement(e.element || e.energyType || e.attackType || e.dmgType);
	if (fromEvent) return fromEvent;
	const mon = findMonView(players, e.iid);
	const fromMon = energyElement(mon?.types?.[0]);
	if (fromMon) return fromMon;
	const named = mon?.attacks?.find(a => a.name && e.name && a.name === e.name);
	const paid = named?.cost?.map(energyElement).find(c => c && c !== 'colorless');
	return paid || 'colorless';
}
function attackHits(events: TcgEvent[], i: number, players?: TcgPlayerView[]): FxHit[] {
	const start = events[i];
	if (!start || (start.type !== 'attack' && start.type !== 'ability')) return [];
	const src = start.type === 'ability' ? 'ability' : 'attack';
	const label = start.name || (src === 'ability' ? 'Ability' : 'Attack');
	const element = src === 'attack' ? attackElement(start, players) : '';
	const hits: FxHit[] = [];
	for (let j = i + 1; j < events.length; j++) {
		const n = events[j];
		if (!n) break;
		const t = String(n.type || '');
		if (t === 'request' || t === 'act' || t === 'coin') continue;
		if (t === 'damage') hits.push({ iid: n.iid, amount: n.amount, kind: 'damage', src, label, element });
		else if (t === 'heal') hits.push({ iid: n.iid, amount: n.amount, kind: 'heal' });
		else if (t === 'status') hits.push({ iid: n.iid, kind: 'status' });
		else break;
	}
	return hits;
}
function precededByHandShuffle(events: TcgEvent[], i: number): boolean {
	const e = events[i];
	if (!e || e.type !== 'draw') return false;
	const n = e.n || 0;
	// shuffleHandIntoDeck thenDraw is typically 3–8; skip turn draws (usually 1)
	if (n < 3) return false;
	for (let j = i - 1; j >= 0; j--) {
		const p = events[j];
		if (!p) return false;
		const t = String(p.type || '');
		if (t === 'request' || t === 'act' || t === 'coin') continue;
		// Cynthia / Red Card / Devastating Wind etc. shuffle then draw
		return t === 'trainer' || t === 'attack' || t === 'ability';
	}
	return false;
}
/** Cause of a draw for Live-style left rail (trainer / attack / ability / …). Null = turn/opening draw. */
function drawCause(
	events: TcgEvent[],
	i: number,
	players?: TcgPlayerView[],
): { kind: string, name: string, cardId?: string } | null {
	const e = events[i];
	if (!e || e.type !== 'draw') return null;
	for (let j = i - 1; j >= 0; j--) {
		const p = events[j];
		if (!p) return null;
		const t = String(p.type || '');
		if (t === 'request' || t === 'act' || t === 'coin') continue;
		if (t === 'draw') continue;
		if (t === 'damage' || t === 'heal' || t === 'status' || t === 'ko' || t === 'place') continue;
		if (t === 'turn' || t === 'deal' || t === 'checkup' || t === 'first' || t === 'start' || t === 'over') {
			return null;
		}
		if (t === 'trainer' || t === 'stadium') {
			return { kind: t, name: cardLabel(p.cardId), cardId: p.cardId || undefined };
		}
		if (t === 'attack' || t === 'ability') {
			const mon = findMonView(players, p.iid);
			return {
				kind: t,
				name: p.name || (t === 'ability' ? 'Ability' : 'Attack'),
				cardId: mon?.cardId || undefined,
			};
		}
		if (t === 'energy' || t === 'tool') {
			return { kind: t, name: cardLabel(p.cardId), cardId: p.cardId || undefined };
		}
		return null;
	}
	return null;
}
function skipEvent(events: TcgEvent[], i: number): boolean {
	const e = events[i];
	if (!e) return true;
	if (e.type === 'request') return e.kind !== 'search' && e.kind !== 'mulligan';
	if (e.type === 'act') {
		const t = e.action?.type;
		return t !== 'discardPick' && t !== 'searchDone';
	}
	if ((e.type === 'damage' || e.type === 'heal' || e.type === 'status') &&
		(afterKind(events, i, 'attack') || afterKind(events, i, 'ability'))) return true;
	return false;
}
function fxDuration(e: TcgEvent): number {
	if (!e) return 1600;
	if (e.type === 'request' && (e.kind === 'search' || e.kind === 'mulligan')) return 2800;
	if (e.type === 'act' && e.action?.type === 'searchDone') return 2000;
	if (e.type === 'act' && e.action?.type === 'discardPick') return 2000;
	const t = e.type;
	if (t === 'request' || t === 'act') return 0;
	if (t === 'checkup') return 1400;
	if (t === 'start') return 1400;
	if (t === 'turn') return 2000;
	if (t === 'first') return 3200;
	if (t === 'coin') return 2600;
	if (t === 'attack' || t === 'ability') return 3000;
	if (t === 'damage' || t === 'heal') return 2600;
	if (t === 'ko') return 2800;
	if (t === 'over') return 4200;
	if (t === 'prize' || t === 'prizeTake') return 1200;
	if (t === 'points') return 2400;
	if (t === 'find') return 2600;
	if (t === 'draw') return 2400; // effect draws override wait in playFx
	if (t === 'deal') return 2400;
	if (t === 'shuffleHand') return 2000;
	if (t === 'trainer' || t === 'stadium') return 3200;
	if (t === 'stadiumEnd') return 2400;
	if (t === 'energy' || t === 'tool') return 2400;
	if (t === 'place') return 2200;
	if (t === 'evolve') return 2800;
	if (t === 'discard') return 2000;
	return 2000;
}
function placeTalk(e: TcgEvent, players?: TcgPlayerView[]): { tag: string, extra: string, text: string } {
	const actor = whoName(players, e.seat);
	const bench = e.slot !== 'active' && e.slot != null && e.slot !== '';
	if (e.faceDown) {
		// Setup: the opponent's Pokémon stay face down until both players are ready.
		return bench ?
			{ tag: 'BENCH', extra: 'Face down', text: `${actor} put a Pokémon face down on the Bench.` } :
			{ tag: 'ACTIVE', extra: 'Face down', text: `${actor} put a Pokémon face down in the Active Spot.` };
	}
	const name = cardName(players, e.cardId, e.iid) || cardLabel(e.cardId);
	// Live battles don't always include prior act; infer from slot.
	if (bench) return { tag: 'BENCH', extra: name, text: `${actor} benched ${name}.` };
	return { tag: 'ACTIVE', extra: name, text: `${name} came into the Active Spot.` };
}
function dmgSrc(events: TcgEvent[], i: number, players?: TcgPlayerView[]): { key: string, label: string } {
	const e = events[i];
	if (!e || e.type !== 'damage') return { key: 'effect', label: 'Damage' };
	for (let j = i - 1; j >= 0; j--) {
		const p = events[j];
		if (!p) break;
		const t = String(p.type || '');
		if (clusterSkip(t) && t !== 'damage' && t !== 'heal' && t !== 'status') continue;
		if (t === 'attack') return { key: 'attack', label: p.name || 'Attack' };
		if (t === 'ability') return { key: 'ability', label: p.name || 'Ability' };
		if (t === 'trainer') return { key: 'trainer', label: cardLabel(p.cardId) };
		if (t === 'checkup') {
			const mon = findMonView(players, e.iid);
			if (mon?.poisoned || mon?.status === 'poisoned') return { key: 'poison', label: 'Poison' };
			if (mon?.burned || mon?.status === 'burned') return { key: 'burn', label: 'Burn' };
			return { key: 'checkup', label: 'Pokémon Checkup' };
		}
		break;
	}
	return { key: 'effect', label: 'Damage' };
}

export type TcgChatEntry = { kind: string, label: string, text: string, turn?: number, seat?: number };

/**
 * "their deck" / "their discard pile" / "their Prize cards" for a search. The sim only tells the
 * searching seat which zone it is (snapshot.pendingSearch), so the other side gets a neutral phrase.
 */
function searchZoneText(snap: TcgSnapshot | null | undefined, seat: number | undefined, own: boolean): string {
	const whose = own ? 'your' : 'their';
	const zone = snap && snap.you != null && seat === snap.you ? snap.pendingSearch?.zone : undefined;
	if (zone === 'discard') return `${whose} discard pile`;
	if (zone === 'prizes' || zone === 'prize') return `${whose} Prize cards`;
	if (zone === 'deck') return `${whose} deck`;
	return 'for a card';
}

/** English battle chat from events (graphics.md / Unreal-Bot chatLine). */
export function chatEntryForEvent(ev: TcgEvent, players?: TcgPlayerView[], snap?: TcgSnapshot | null): TcgChatEntry | null {
	const w = (seat: number) => whoName(players, seat);
	const poke = (iid?: string) => monName(players, iid);
	const nm = (id?: string) => cardName(players, id) || cardLabel(id);
	switch (ev.type) {
	case 'act':
		if (ev.action?.type === 'discardPick') {
			return { kind: 'trainer', label: 'Discard', text: `${w(ev.seat)} discarded a card.`, seat: ev.seat };
		}
		if (ev.action?.type === 'searchDone') {
			return { kind: 'draw', label: 'Search', text: `${w(ev.seat)} shuffled their deck.`, seat: ev.seat };
		}
		return null;
	case 'request':
		if (ev.kind === 'search') {
			const seat = (ev.waiting && ev.waiting[0]) ?? 0;
			return { kind: 'draw', label: 'Search', text: `${w(seat)} is searching ${searchZoneText(snap, seat, false)}.`, seat };
		}
		if (ev.kind === 'mulligan') {
			const seat = (ev.waiting && ev.waiting[0]) ?? 0;
			const other = seat === 0 ? 1 : 0;
			return {
				kind: 'draw', label: 'Mulligan',
				text: `${w(other)} took a mulligan. ${w(seat)} may bench Basics from their extra cards.`,
				seat,
			};
		}
		return null;
	case 'start':
		// The room header already prints the format's display name; the raw id adds nothing.
		return null;
	case 'first':
		return {
			kind: 'setup', label: 'First',
			text: ev.chooses ?
				`${w(ev.seat)} won the coin flip and chooses who goes first.` :
				`${w(ev.seat)} goes first.`,
			seat: ev.seat,
		};
	case 'deal':
		return { kind: 'setup', label: 'Deal', text: 'Each player drew 7 cards.' };
	case 'coin':
		return { kind: 'coin', label: 'Coin', text: ev.heads ? 'Coin flip: Heads.' : 'Coin flip: Tails.' };
	case 'place': {
		const talk = placeTalk(ev, players);
		return {
			kind: 'switch',
			label: talk.tag === 'BENCH' ? 'Bench' : talk.tag === 'RETREAT' ? 'Retreat' : 'Active',
			text: talk.text,
			seat: ev.seat,
		};
	}
	case 'evolve':
		return {
			kind: 'evolve', label: 'Evolve',
			text: ev.fromCardId ?
				`${nm(ev.fromCardId)} evolved into ${nm(ev.cardId)}.` :
				`Evolved into ${nm(ev.cardId)}.`,
			seat: ev.seat,
		};
	case 'attack':
		return { kind: 'attack', label: 'Attack', text: `${poke(ev.iid)} used ${ev.name}.` };
	case 'ability':
		return { kind: 'ability', label: 'Ability', text: `${poke(ev.iid)} used ${ev.name}.` };
	case 'trainer':
		return { kind: 'trainer', label: 'Play', text: `${w(ev.seat)} played ${nm(ev.cardId)}.`, seat: ev.seat };
	case 'energy': case 'tool': {
		// Attach events carry the Pokémon, not the seat; the owner of the Pokémon did it.
		const seat = ev.seat ?? findMonSlot(players, ev.iid)?.seat;
		return {
			kind: 'energy', label: ev.type === 'tool' ? 'Tool' : 'Energy',
			text: `${w(seat)} attached ${nm(ev.cardId)} to ${poke(ev.iid)}.`, seat,
		};
	}
	case 'stadium':
		return { kind: 'trainer', label: 'Stadium', text: `${w(ev.seat)} played ${nm(ev.cardId)}.`, seat: ev.seat };
	case 'stadiumEnd':
		return { kind: 'trainer', label: 'Stadium', text: `${nm(ev.cardId)} is no longer in play.` };
	case 'damage':
		return { kind: 'damage', label: 'Damage', text: `${poke(ev.iid)} took ${ev.amount} damage.` };
	case 'heal':
		return { kind: 'heal', label: 'Heal', text: `${poke(ev.iid)} healed ${ev.amount} damage.` };
	case 'status':
		return {
			kind: 'status', label: 'Status',
			text: ev.status ?
				`${poke(ev.iid)} is ${statusWord(ev.status)}.` :
				`${poke(ev.iid)} recovered from Special Conditions.`,
		};
	case 'ko':
		return { kind: 'ko', label: 'KO', text: `${poke(ev.iid)} was Knocked Out.`, seat: ev.seat };
	case 'draw': {
		const n = ev.n || 1;
		const ids = Array.isArray(ev.ids) ? ev.ids.filter(Boolean) : [];
		const named = ids.length && ids.length === n ? ids.map(nm).join(', ') : '';
		return {
			kind: 'draw', label: 'Draw',
			text: named ? `${w(ev.seat)} drew ${named}.` :
			n === 1 ? `${w(ev.seat)} drew a card.` : `${w(ev.seat)} drew ${n} cards.`,
			seat: ev.seat,
		};
	}
	case 'find': {
		const ids = Array.isArray(ev.ids) ? ev.ids.filter(Boolean) : [];
		const text = ids.length === 1 ?
			`${w(ev.seat)} put ${nm(ids[0])} into their hand.` :
			ids.length > 1 ?
				`${w(ev.seat)} put ${ids.map(nm).join(', ')} into their hand.` :
				((ev.ids && ev.ids.length) || ev.n || 1) === 1 ?
					`${w(ev.seat)} put a card into their hand.` :
					`${w(ev.seat)} put ${(ev.ids && ev.ids.length) || ev.n} cards into their hand.`;
		return { kind: 'draw', label: 'Search', text, seat: ev.seat };
	}
	case 'prize':
		return {
			kind: 'prize', label: 'Prize',
			text: `${w(ev.seat)} takes ${ev.n} Prize card${ev.n === 1 ? '' : 's'}.`, seat: ev.seat,
		};
	case 'prizeTake':
	{
		const ids = Array.isArray(ev.ids) ? ev.ids.filter(Boolean) : [];
		return {
			kind: 'prize', label: 'Prize',
			text: ids.length ? `${w(ev.seat)} took a Prize card: ${ids.map(nm).join(', ')}.` :
			`${w(ev.seat)} took a Prize card.`,
			seat: ev.seat,
		};
	}
	case 'points':
		return {
			kind: 'prize', label: 'Points',
			text: `${w(ev.seat)} scored ${ev.n} point${ev.n === 1 ? '' : 's'} (total ${ev.total}).`,
			seat: ev.seat,
		};
	case 'turn':
		return {
			kind: 'turn', label: 'Turn', text: `${w(ev.seat)}'s turn`,
			turn: ev.number, seat: ev.seat,
		};
	case 'checkup':
		return { kind: 'note', label: 'Checkup', text: 'Pokémon Checkup.' };
	case 'over':
		return {
			kind: 'win', label: 'End',
			text: ev.reason || (ev.winner == null ? 'The game is a draw.' : `${w(ev.winner)} wins.`),
			seat: ev.winner ?? undefined,
		};
	default:
		return null;
	}
}

export function chatLineForEvent(ev: TcgEvent, players?: TcgPlayerView[]): string | null {
	return chatEntryForEvent(ev, players)?.text || null;
}

export function chatHtmlForEntry(entry: TcgChatEntry): string {
	const esc = (s: string) => String(s || '')
		.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	return `<div class="chat tcg-log-line k-${esc(entry.kind)}">` +
		`<span class="tcg-log-tag">${esc(entry.label)}</span>` +
		`<span class="tcg-log-text">${esc(entry.text)}</span></div>`;
}

function fxFor(
	e: TcgEvent,
	events: TcgEvent[],
	i: number,
	players?: TcgPlayerView[],
	you?: number | null,
	snap?: TcgSnapshot | null,
): FxBeat {
	if (!e) return { kind: '' };
	const who = (seat?: number) => actorLabel(players, seat, you);
	const yours = (seat?: number) => actorIsYou(seat, you);
	if (e.type === 'request' && e.kind === 'search') {
		const seat = (e.waiting && e.waiting[0] != null) ? e.waiting[0] : 0;
		const zone = searchZoneText(snap, seat, yours(seat));
		return {
			kind: 'search', seat, n: 5,
			extra: `Searching ${zone}`,
			message: yours(seat) ? `You are searching ${zone}` : `${who(seat)} is searching ${zone}`,
		};
	}
	if (e.type === 'request' && e.kind === 'mulligan') {
		// The waiting seat is the one who gets to bench extra Basics; the *other* seat mulliganed.
		const seat = (e.waiting && e.waiting[0] != null) ? e.waiting[0] : 0;
		const other = seat === 0 ? 1 : 0;
		return {
			kind: 'mulligan', seat, n: 7,
			extra: `${who(other)} took a mulligan`,
			message: yours(seat) ?
				`${who(other)} took a mulligan — you may bench Basics from your extra cards` :
				`${who(other)} took a mulligan — ${who(seat)} may bench extra Basics`,
		};
	}
	if (e.type === 'act' && e.action?.type === 'searchDone') {
		return {
			kind: 'searchDone', seat: e.seat, n: 5,
			extra: 'Shuffled their deck',
			message: yours(e.seat) ? 'You shuffled your deck' : `${who(e.seat)} shuffled their deck`,
		};
	}
	if (e.type === 'find') {
		const ids = Array.isArray(e.ids) ? e.ids.filter(Boolean) as string[] : [];
		const names = ids.map(cardLabel);
		const found = names.length ? names.join(', ') : `${ids.length || 1} card(s)`;
		return {
			kind: 'find', seat: e.seat, n: ids.length || 1,
			extra: names.length ? names.join(', ') : 'Put into the hand',
			cardId: ids[0] || '', ids, labels: names,
			message: yours(e.seat) ?
				`You put ${found} into your hand` :
				`${who(e.seat)} put ${found} into their hand`,
		};
	}
	if (e.type === 'act' && e.action?.type === 'discardPick') {
		return {
			kind: 'discard', seat: e.seat, n: 1,
			extra: 'Discarded a card',
			message: yours(e.seat) ? 'You discarded a card' : `${who(e.seat)} discarded a card`,
		};
	}
	if (e.type === 'place') {
		const talk = placeTalk(e, players);
		const slot = placeSlotOf(e);
		return {
			kind: 'place', iid: e.iid || '', seat: e.seat, slot,
			extra: talk.extra, tag: talk.tag,
			cardId: e.cardId || '',
			message: talk.text,
		};
	}
	if (e.type === 'damage') {
		const src = dmgSrc(events, i, players);
		return {
			kind: 'damage', iid: e.iid || '', seat: e.seat, amount: e.amount,
			extra: src.label, src: src.key,
			message: `${monName(players, e.iid)} took ${e.amount} damage`,
		};
	}
	if (e.type === 'draw') {
		const n = e.n || (Array.isArray(e.ids) ? e.ids.length : 1) || 1;
		const ids = Array.isArray(e.ids) ? e.ids.filter(Boolean) as string[] : [];
		const cause = drawCause(events, i, players);
		const drawLabel = n === 1 ? 'Drew a card' : `Drew ${n} cards`;
		const whoDrew = yours(e.seat) ?
			(n === 1 ? 'You drew a card' : `You drew ${n} cards`) :
			(n === 1 ? `${who(e.seat)} drew a card` : `${who(e.seat)} drew ${n} cards`);
		if (cause) {
			return {
				kind: 'drawEffect',
				seat: e.seat,
				n,
				ids: ids.length ? ids : undefined,
				labels: ids.length ? ids.map(cardLabel) : undefined,
				cardId: cause.cardId || '',
				src: cause.kind,
				extra: cause.name,
				message: `${cause.name} — ${whoDrew}`,
			};
		}
		return {
			kind: 'draw', seat: e.seat, n,
			ids: ids.length ? ids : undefined,
			extra: drawLabel,
			message: whoDrew,
		};
	}
	if (e.type === 'shuffleHand') {
		return {
			kind: 'shuffleHand', seat: e.seat, n: e.n || 5,
			extra: 'Shuffled hand into the deck',
			message: yours(e.seat) ?
				'You shuffled your hand into the deck' :
				`${who(e.seat)} shuffled their hand into the deck`,
		};
	}
	if (e.type === 'deal') {
		return {
			kind: 'deal', n: 7,
			extra: 'Each player drew 7 cards',
			message: 'Each player drew 7 cards',
		};
	}
	if (e.type === 'prize' || e.type === 'prizeTake') {
		const n = e.n || 1;
		const multi = e.type === 'prize' && n > 1;
		return {
			kind: e.type, seat: e.seat, n,
			extra: multi ? `Took ${n} Prize cards` : 'Took a Prize card',
			message: yours(e.seat) ?
				(multi ? `You took ${n} Prize cards` : 'You took a Prize card') :
				(multi ? `${who(e.seat)} took ${n} Prize cards` : `${who(e.seat)} took a Prize card`),
		};
	}
	if (e.type === 'points') {
		const n = e.n || 1;
		return {
			kind: 'points', seat: e.seat, n,
			extra: `+${n}`,
			message: yours(e.seat) ?
				`You scored ${n} point${n === 1 ? '' : 's'}` :
				`${who(e.seat)} scored ${n} point${n === 1 ? '' : 's'}`,
		};
	}
	if (e.type === 'evolve') {
		let evoSeat = e.seat as number | undefined;
		if (evoSeat == null && e.iid) {
			const playersList = players || [];
			for (let s = 0; s < playersList.length; s++) {
				const p = playersList[s];
				if (p.active?.iid === e.iid || (p.bench || []).some(m => m?.iid === e.iid)) {
					evoSeat = s;
					break;
				}
			}
		}
		const into = cardLabel(e.cardId);
		return {
			kind: 'evolve',
			iid: e.iid || '',
			seat: evoSeat,
			extra: into,
			cardId: e.cardId || '',
			fromCardId: e.fromCardId || '',
			message: e.fromCardId ?
				`${cardLabel(e.fromCardId)} evolved into ${into}` :
				`Evolved into ${into}`,
		};
	}
	if (e.type === 'energy' || e.type === 'tool') {
		const mon = findMonView(players, e.iid);
		const label = cardLabel(e.cardId);
		return {
			kind: e.type, iid: e.iid || '', seat: e.seat,
			extra: label, onto: mon?.name || 'a Pokémon',
			ontoId: mon?.cardId || '', cardId: e.cardId || '',
			message: yours(e.seat) ?
				`You attached ${label} to ${mon?.name || 'a Pokémon'}` :
				`${who(e.seat)} attached ${label} to ${mon?.name || 'a Pokémon'}`,
		};
	}
	if (e.type === 'trainer') {
		const label = cardLabel(e.cardId);
		return {
			kind: 'trainer', seat: e.seat, extra: label, cardId: e.cardId || '',
			message: yours(e.seat) ? `You played ${label}` : `${who(e.seat)} played ${label}`,
		};
	}
	if (e.type === 'stadium') {
		const label = cardLabel(e.cardId);
		return {
			kind: 'stadium', seat: e.seat, extra: label, cardId: e.cardId || '',
			message: yours(e.seat) ? `You played ${label}` : `${who(e.seat)} played ${label}`,
		};
	}
	if (e.type === 'ko') {
		const memName = monName(players, e.iid);
		return {
			kind: 'ko', iid: e.iid || '', seat: e.seat,
			extra: memName !== 'a Pokémon' ? memName : '',
			message: `${memName} was Knocked Out`,
		};
	}
	if (e.type === 'heal') {
		return {
			kind: 'heal', iid: e.iid || '', seat: e.seat, amount: e.amount,
			extra: e.amount ? `+${e.amount}` : 'Healed',
			message: `${monName(players, e.iid)} healed ${e.amount || 0} damage`,
		};
	}
	if (e.type === 'attack') {
		return {
			kind: 'attack', iid: e.iid || '', seat: e.seat,
			extra: e.name || 'Attack',
			message: `${monName(players, e.iid)} used ${e.name || 'an attack'}`,
		};
	}
	if (e.type === 'ability') {
		return {
			kind: 'ability', iid: e.iid || '', seat: e.seat,
			extra: e.name || 'Ability',
			message: `${monName(players, e.iid)} used ${e.name || 'an Ability'}`,
		};
	}
	let seat = e.seat as number | undefined;
	if (seat == null && e.iid) {
		const playersList = players || [];
		for (let s = 0; s < playersList.length; s++) {
			const p = playersList[s];
			if (p.active?.iid === e.iid || (p.bench || []).some(m => m?.iid === e.iid)) {
				seat = s;
				break;
			}
		}
	}
	if (e.type === 'over') {
		const tie = !!(e.tie || (e.winner == null && !e.winnerName && !e.reason));
		const winName = e.winnerName ||
			(e.winner != null ? whoName(players, e.winner) : '') ||
			'';
		const reason = e.reason || (tie ? 'Draw' : (winName ? `${winName} won` : 'Battle ended'));
		return {
			kind: 'over',
			seat: e.winner ?? seat,
			extra: reason,
			message: reason,
			tie,
		};
	}
	if (e.type === 'checkup') {
		return { kind: 'checkup', extra: 'Pokémon Checkup', message: 'Pokémon Checkup' };
	}
	return {
		kind: e.type,
		iid: e.iid || '',
		targetIid: e.targetIid || '',
		seat,
		amount: e.amount,
		n: e.n,
		extra: e.type === 'coin' ? (e.heads ? 'Heads' : 'Tails') :
			e.type === 'turn' ? `Turn ${e.number} · ${whoName(players, e.seat)}` :
			e.type === 'first' ? (e.chooses ?
				`${whoName(players, e.seat)} chooses who goes first` :
				`${whoName(players, e.seat)} goes first`) :
			e.type === 'status' ? (e.status ? statusWord(e.status) : 'Recovered') :
			e.type === 'stadiumEnd' ? 'No longer in play' :
			(e.name || e.status || e.reason || ''),
		message: e.type === 'coin' ? (e.heads ? 'Heads!' : 'Tails!') :
			e.type === 'first' ? (e.chooses ?
				`${who(e.seat)} chooses who goes first` :
				`${who(e.seat)} goes first`) :
			e.type === 'status' ? (e.status ?
				`${monName(players, e.iid)} is ${statusWord(e.status)}` :
				`${monName(players, e.iid)} recovered`) :
			e.type === 'stadiumEnd' ? `${cardLabel(e.cardId)} is no longer in play` :
			undefined,
		cardId: e.cardId || '',
		coins: e.type === 'coin' ? [!!e.heads] : undefined,
	};
}

function pkClass(fx: FxBeat): string {
	const kind = fx.kind;
	if (kind === 'damage') return 'fx-hit';
	if (kind === 'attack') return 'fx-lunge';
	if (kind === 'heal') return 'fx-heal';
	if (kind === 'ko') return 'fx-ko';
	if (kind === 'place') return fx.fromBench ? 'fx-switch' : 'fx-place';
	if (kind === 'evolve') return 'fx-evolve';
	if (kind === 'energy' || kind === 'tool') return 'fx-energy';
	if (kind === 'status') return 'fx-status';
	if (kind === 'ability') return 'fx-ability';
	return 'fx-pulse';
}

function buildPkFx(fx: FxBeat, tick = 0): { [iid: string]: PkFx } {
	const out: { [iid: string]: PkFx } = {};
	const put = (iid: string | undefined, cls: string, dataFx?: string, element?: string) => {
		if (!iid) return;
		out[iid] = { cls, dataFx, tick, element };
	};
	if (fx.iid) {
		let dataFx = '';
		if (fx.kind === 'damage' && fx.amount) dataFx = `-${fx.amount}`;
		if (fx.kind === 'heal' && fx.amount) dataFx = `+${fx.amount}`;
		if (fx.kind === 'energy') dataFx = '⚡';
		if (fx.kind === 'evolve') dataFx = '✨';
		if (fx.kind === 'ko') dataFx = 'KO';
		put(fx.iid, `${pkClass(fx)}${fx.src ? ` src-${fx.src}` : ''}`, dataFx || undefined);
	}
	if (fx.targetIid && fx.targetIid !== fx.iid) put(fx.targetIid, 'fx-hit');
	for (const h of fx.hits || []) {
		if (!h?.iid) continue;
		const dataFx = h.kind === 'damage' && h.amount ? `-${h.amount}` :
			h.kind === 'heal' && h.amount ? `+${h.amount}` : undefined;
		const src = h.src || fx.src;
		const cls = `${h.kind === 'heal' ? 'fx-heal' : h.kind === 'status' ? 'fx-status' : 'fx-hit'}${src ? ` src-${src}` : ''}`;
		put(h.iid, cls, dataFx, h.kind === 'damage' ? (h.element || fx.element) : undefined);
	}
	return out;
}

function TypeHit(props: { type: string, tick?: number }) {
	// data-tick changes per hit so the CSS animation restarts via TcgMon's reflow.
	return <div class={`type-hit t-${props.type}`} data-tick={props.tick ?? 0} aria-hidden="true">
		<i class="core"></i>
		<i class="p p1"></i><i class="p p2"></i><i class="p p3"></i>
		<i class="p p4"></i><i class="p p5"></i><i class="p p6"></i>
	</div>;
}

function FxCaption(props: { tag: string, title?: string }) {
	const slug = String(props.tag || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
	return <div class={`fx-caption k-${slug}`}>
		<b>{props.tag}</b>
		{props.title ? <span>{props.title}</span> : null}
	</div>;
}

/** Prominent mid-board status line for searches, prizes, draws, etc. */
function BoardMsg(props: { tag: string, text: string, yours?: boolean, tone?: string }) {
	const slug = String(props.tag || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
	const tone = props.tone || slug;
	return <div class={`fx-board-msg k-${tone}${props.yours ? ' yours' : ' foe'}`}>
		<b>{props.tag}</b>
		<span>{props.text}</span>
	</div>;
}

function fanCards(n: number) {
	const c = Math.min(Math.max(n || 5, 3), 7);
	const mid = (c - 1) / 2;
	return Array.from({ length: c }, (_, i) =>
		<span class="fx-mini-card back fan" style={{ '--t': String(i - mid) } as any}></span>
	);
}

function MiniArt(props: { cardId?: string, name?: string }) {
	const src = props.cardId ? cardArt(props.cardId) : '';
	if (!src) return <span class="fx-mini-card back"></span>;
	return <img src={src} alt={props.name || ''} draggable={false} />;
}

class FxOverlay extends preact.Component<{ fx: FxBeat | null, you?: number | null, names?: string[] }> {
	override render() {
		const fx = this.props.fx;
		if (!fx?.kind) return null;
		const you = this.props.you != null ? this.props.you : 0;
		const seat = fx.seat === you ? 'fx-p1' : 'fx-p2';
		const yours = actorIsYou(fx.seat, this.props.you);
		const art = fx.cardId ? <MiniArt cardId={fx.cardId} name={fx.extra} /> : null;
		const k = fx.kind;
		/** Mid-board copy only for pending waits (search / mulligan), not every FX beat. */
		const pendingMsg = (tag: string, fallback: string, tone?: string) =>
			<BoardMsg tag={tag} text={fx.message || fallback} yours={yours} tone={tone} />;
		const cap = (tag: string, title?: string) => <FxCaption tag={tag} title={title} />;
		const wrap = (kind: string, body: any, src?: string) => (
			<div class={`fx-layer kind-${kind}${src ? ` src-${src}` : ''}${yours ? ' yours' : ' foe'}`}>
				{body}
			</div>
		);

		if (k === 'coin') {
			const coins = (fx.coins && fx.coins.length) ? fx.coins :
				[fx.extra === 'Heads' || fx.extra === 'HEADS'];
			const shown = coins.slice(0, 8);
			const headsN = shown.filter(Boolean).length;
			const tailsN = shown.length - headsN;
			const forFirst = fx.extra === 'First';
			const side = forFirst ? (shown[0] ? 'HEADS' : 'TAILS') :
				shown.length === 1 ?
					(shown[0] ? 'HEADS' : 'TAILS') :
					`${headsN}H · ${tailsN}T`;
			const result = fx.message || (shown.length === 1 ?
				(shown[0] ? 'Heads!' : 'Tails!') :
				`${headsN} Heads · ${tailsN} Tails`);
			const lifeMs = (forFirst ? 2600 : 2100) + Math.max(0, shown.length - 1) * 200;
			return wrap('coin', <>
				{cap(forFirst ? 'FIRST' : 'COIN', side)}
				<div
					class={`fx-coin-row n-${shown.length}`}
					style={{ animationDuration: `${lifeMs}ms` }}
				>
					{shown.map((heads, idx) => (
						<div
							class="fx-coin-scene"
							key={`coin-${idx}-${heads ? 'h' : 't'}`}
							style={{ '--coin-delay': `${idx * 0.16}s` } as any}
						>
							<div class={`fx-coin-3d ${heads ? 'land-heads' : 'land-tails'}`}>
								<div class="fx-coin-face front">
									<span>H</span>
									<em>HEADS</em>
								</div>
								<div class="fx-coin-face back">
									<span>T</span>
									<em>TAILS</em>
								</div>
							</div>
						</div>
					))}
				</div>
				<div class="fx-coin-result" style={{ animationDuration: `${lifeMs}ms` }}>{result}</div>
			</>);
		}
		if (k === 'drawEffect') {
			const n = Math.max(fx.n || 0, fx.ids?.length || 0, 1);
			const ids = (fx.ids && fx.ids.length) ? fx.ids : [];
			const faces = ids.length > 0;
			const count = Math.min(faces ? ids.length : n, 8);
			const kindLabel = fx.src === 'attack' ? 'Attack' :
				fx.src === 'ability' ? 'Ability' :
				fx.src === 'trainer' ? 'Trainer' :
				fx.src === 'stadium' ? 'Stadium' :
				fx.src === 'energy' ? 'Energy' :
				fx.src === 'tool' ? 'Tool' : 'Effect';
			return wrap('drawEffect', <>
				<div class={`fx-draw-rail ${seat}${yours ? ' yours' : ' foe'}`}>
					<div class="fx-draw-source">
						{fx.cardId ?
							<span class="fx-draw-source-art"><MiniArt cardId={fx.cardId} name={fx.extra} /></span> :
							<span class="fx-draw-source-art back"><span class="fx-mini-card back"></span></span>}
						<div class="fx-draw-source-meta">
							<b>{kindLabel}</b>
							<em>{fx.extra || kindLabel}</em>
						</div>
					</div>
					<div class="fx-draw-stack">
						{Array.from({ length: count }, (_, i) =>
							faces ?
								<span class="fx-draw-card face" style={{ '--i': String(i) } as any} key={i}>
									<MiniArt cardId={ids[i]} name={(fx.labels && fx.labels[i]) || ''} />
								</span> :
								<span class="fx-draw-card back" style={{ '--i': String(i) } as any} key={i}>
									<span class="fx-mini-card back"></span>
								</span>
						)}
					</div>
					<div class="fx-draw-caption">
						{n === 1 ? 'Drew a card' : `Drew ${n} cards`}
					</div>
				</div>
			</>);
		}
		if (k === 'draw' || k === 'deal') {
			const n = fx.n || (k === 'deal' ? 7 : 1);
			const makeCards = () => Array.from({ length: Math.min(n, 5) }, (_, i) =>
				<span class="fx-mini-card back" style={{ '--d': `${i * 0.08}s` } as any}></span>
			);
			const paths = k === 'deal' ?
				<><div class="fx-pile-fly draw fx-p1">{makeCards()}</div><div class="fx-pile-fly draw fx-p2">{makeCards()}</div></> :
				<div class={`fx-pile-fly draw ${seat}`}>{makeCards()}</div>;
			return wrap('draw', paths);
		}
		if (k === 'shuffleHand') {
			// Motion lives on the real hand (`.is-shuffling`); layer only marks the beat for CSS.
			return wrap('shuffleHand', <></>);
		}
		if (k === 'search') {
			return wrap('search', <>
				{pendingMsg('SEARCH', 'Searching their deck', 'search')}
				<div class={`fx-search-fan ${seat}`}>{fanCards(5)}</div>
				<div class={`fx-search-glow ${seat}`}></div>
			</>);
		}
		if (k === 'searchDone') {
			return wrap('search', <>
				<div class={`fx-search-fan ${seat} close`}>{fanCards(5)}</div>
			</>);
		}
		if (k === 'mulligan') {
			return wrap('mulligan', <>
				{pendingMsg('MULLIGAN', 'Took a mulligan', 'mulligan')}
				<div class={`fx-search-fan ${seat}`}>{fanCards(7)}</div>
			</>);
		}
		if (k === 'find') {
			const ids = (fx.ids && fx.ids.length) ? fx.ids : (fx.cardId ? [fx.cardId] : []);
			const faces = ids.length ? ids.map((id, i) => {
				const name = (fx.labels && fx.labels[i]) || '';
				return <span class="fx-found-card" key={i}>
					<span class="fx-mini-card face"><MiniArt cardId={id} name={name} /></span>
					{name ? <em>{name}</em> : null}
				</span>;
			}) : <span class="fx-mini-card back"></span>;
			return wrap('find', <div class={`fx-found-row ${seat}`}>{faces}</div>);
		}
		if (k === 'discard') {
			return wrap('discard', <>
				<div class={`fx-pile-fly discard ${seat}`}><span class="fx-mini-card back"></span></div>
			</>);
		}
		if (k === 'trainer') {
			return wrap('trainer', <>
				<div class="fx-play-card reveal">{art}<div class="fx-play-name">{fx.extra || 'Trainer'}</div></div>
			</>);
		}
		if (k === 'prize' || k === 'prizeTake') {
			const n = fx.n || 1;
			return wrap('prize', <>
				<div class={`fx-pile-fly prize ${seat}`}>
					{Array.from({ length: Math.min(n, 3) }, (_, i) =>
						<span class="fx-mini-card prize-back" style={{ '--d': `${i * 0.12}s` } as any}></span>
					)}
				</div>
				<div class={`fx-prize-burst ${seat}`}></div>
			</>);
		}
		if (k === 'stadium' || k === 'stadiumEnd') {
			return wrap('stadium', <>
				<div class="fx-play-card reveal">{art}<div class="fx-play-name">{fx.extra || 'Stadium'}</div></div>
			</>);
		}
		if (k === 'energy' || k === 'tool') {
			const enName = fx.extra || (k === 'tool' ? 'Pokémon Tool' : 'Energy');
			const face = art || <span class={`fx-orb${k === 'tool' ? ' tool' : ''}`}></span>;
			return wrap(k, <>
				<div class="fx-en-fly" data-target={fx.iid || ''}>{face}<div class="fx-play-name">{enName}</div></div>
			</>);
		}
		if (k === 'place') {
			return wrap('place', cap(fx.tag || (fx.fromBench ? 'SWITCH' : 'INTO PLAY'), fx.extra));
		}
		if (k === 'evolve') {
			const fromArt = fx.fromCardId ? <MiniArt cardId={fx.fromCardId} /> : null;
			const toArt = art || <span class="fx-mini-card face"></span>;
			return wrap('evolve', <>
				<div class="fx-evolve-stage">
					<span class="fx-evolve-flash"></span>
					<span class="fx-evolve-ring r1"></span>
					<span class="fx-evolve-ring r2"></span>
					<span class="fx-evolve-spark s1"></span>
					<span class="fx-evolve-spark s2"></span>
					<span class="fx-evolve-spark s3"></span>
					<span class="fx-evolve-spark s4"></span>
					<span class="fx-evolve-spark s5"></span>
					<span class="fx-evolve-spark s6"></span>
					<div class="fx-evolve-morph">
						{fromArt ?
							<span class="fx-evolve-from">{fromArt}</span> :
							<span class="fx-evolve-from fx-mini-card face"></span>}
						<span class="fx-evolve-to">{toArt}</span>
					</div>
					{fx.extra ? <div class="fx-evolve-name">{fx.extra}</div> : null}
				</div>
			</>);
		}
		if (k === 'attack') {
			return wrap('attack', <>
				{cap('ATTACK', fx.extra || 'Attack')}
				<div class="fx-slash"></div><div class="fx-slash s2"></div>
				<div class="fx-impact"></div>
			</>, 'attack');
		}
		if (k === 'ability') {
			return wrap('ability', <>
				{cap('ABILITY', fx.extra || 'Ability')}
				<div class="fx-ring"></div>
			</>, 'ability');
		}
		if (k === 'turn') {
			const isYours = fx.seat != null && this.props.you != null && fx.seat === this.props.you;
			const turnNo = String(fx.extra || '').match(/Turn\s+(\d+)/i)?.[1];
			const seatName = fx.seat != null ? this.props.names?.[fx.seat] || '' : '';
			const whose = isYours ? 'Your Turn' :
				this.props.you != null || !seatName ? "Opponent's Turn" : `${seatName}'s Turn`;
			return wrap('turn', <>
				<div class={`fx-turn-banner${isYours ? ' yours' : ' foe'}`}>
					<em>{whose}</em>
					{turnNo ? <strong>Turn {turnNo}</strong> : null}
				</div>
			</>);
		}
		if (k === 'first') return wrap('first', cap('FIRST', fx.extra));
		if (k === 'over') {
			// The board banner is the one win message. Drawing it here too flashed "won" twice.
			return null;
		}
		if (k === 'points') return wrap('points', <div class="fx-points-burst">+{fx.n || 1}</div>);
		if (k === 'status') return wrap('status', cap('STATUS', fx.extra ? String(fx.extra) : 'Recovered'));
		if (k === 'checkup') return wrap('checkup', cap('CHECKUP', 'Pokémon Checkup'));
		if (k === 'ko') {
			return wrap('ko', <>
				{cap('KNOCKED OUT', fx.extra || undefined)}
			</>);
		}
		if (k === 'heal') {
			// Amount shows on the Pokémon (`data-fx`); skip the big mid-board number.
			return wrap('heal', <div class="fx-heal-aura"></div>);
		}
		if (k === 'damage') {
			// Amount shows on the Pokémon (`data-fx`); skip the big mid-board number.
			return wrap('damage', <></>, fx.src || 'effect');
		}
		return null;
	}
}

type CardSize = 'xs' | 'sm' | 'md' | 'lg';

const TYPE_COLOR: { [type: string]: string } = {
	grass: '#3dcc5a', fire: '#ff5a4a', water: '#3da9ff', lightning: '#f5d031',
	psychic: '#c45ae8', fighting: '#e86838', darkness: '#5b6ad6', metal: '#9aacb8',
	fairy: '#f472b6', dragon: '#8b6cff', colorless: '#e8eef2',
};

/** Pocket sets look like A1 / A2a / B1 / P-A; paper/Live sets look like sv3 / swsh7. */
export function isPocketCardId(cardId: string): boolean {
	if (!cardId) return false;
	// Promo-A prints: P-A-025 (hyphenated set code — must not use split('-')[0] === "P")
	if (/^P-A-\d+/i.test(cardId)) return true;
	const cut = cardId.lastIndexOf('-');
	const set = (cut >= 0 ? cardId.slice(0, cut) : cardId).trim();
	if (!set) return false;
	if (/^P-A$/i.test(set)) return true;
	// Main pocket sets: A1, A2b, B1, B2, A4a, …
	if (/^[A-Z]\d+[a-z]?$/i.test(set)) return true;
	return false;
}

/** Classic Basic Energy art (synthetic `energy-*` ids have no print images). */
const BASIC_ENERGY_ART: { [type: string]: string } = {
	grass: 'sve-1',
	fire: 'sve-2',
	water: 'sve-3',
	lightning: 'sve-4',
	psychic: 'sve-5',
	fighting: 'sve-6',
	darkness: 'sve-7',
	metal: 'sve-8',
	fairy: 'xy1-140',
	// No standalone colorless print — use Grass as a stand-in for the pip art
	colorless: 'sve-1',
	dragon: 'sve-1',
};

function paperTcgIoArt(cardId: string, large = false): string {
	const cut = cardId.lastIndexOf('-');
	if (cut < 0) return '';
	const set = cardId.slice(0, cut);
	const num = cardId.slice(cut + 1);
	if (!set || !num) return '';
	return `https://images.pokemontcg.io/${set}/${num}${large ? '_hires' : ''}.png`;
}

function scrydexArt(cardId: string, large = false): string {
	return `https://images.scrydex.com/pokemon/${encodeURIComponent(cardId)}/${large ? 'large' : 'small'}`;
}

export function pocketCardImage(cardId: string, large = false): string {
	return cardArt(cardId, { large, pocket: true });
}

export function cardArt(cardId: string, opts?: { large?: boolean, pocket?: boolean }): string {
	if (!cardId) return '';
	const large = !!opts?.large;
	const pocket = opts?.pocket ?? isPocketCardId(cardId);

	const energy = /^energy-(grass|fire|water|lightning|psychic|fighting|darkness|metal|fairy|dragon|colorless)$/i.exec(cardId);
	if (energy) {
		const printId = BASIC_ENERGY_ART[energy[1].toLowerCase()] || 'sve-1';
		return paperTcgIoArt(printId, large) || scrydexArt(printId, large);
	}

	if (pocket) {
		const cut = cardId.lastIndexOf('-');
		if (cut < 0) return '';
		const set = cardId.slice(0, cut);
		let num = cardId.slice(cut + 1);
		if (/^\d+$/.test(num)) {
			num = num.replace(/^0+/, '') || '0';
			while (num.length < 3) num = '0' + num;
		}
		const base = `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/pocket/${set}/${set}_${num}_EN`;
		return large ? `${base}.webp` : `${base}_SM.webp`;
	}

	// Scrydex covers recent Standard prints that 404 on images.pokemontcg.io
	return scrydexArt(cardId, large);
}

/** Official-style English TCG card back (face-down hand / deck / prizes). */
export function cardBackArt(): string {
	// Never use Dex.resourcePrefix — it points at play.pokemonshowdown.com, which
	// does not host our local sprites/tcg asset. Resolve against the current page.
	try {
		const base = (typeof document !== 'undefined' && document.baseURI) ||
			(typeof location !== 'undefined' ? location.href : '');
		if (base) return new URL('sprites/tcg/cardback.webp', base).href;
	} catch {}
	return 'sprites/tcg/cardback.webp';
}

const CARD_BACK_FALLBACK = 'https://archives.bulbagarden.net/media/upload/1/17/Cardback.jpg';

function CardBackFace() {
	return <img
		class="tcg-card-backface"
		src={cardBackArt()}
		alt=""
		draggable={false}
		onError={(ev: any) => {
			const img = ev?.currentTarget as HTMLImageElement | null;
			if (!img) return;
			if (img.dataset.fallback === '1') return;
			img.dataset.fallback = '1';
			img.src = CARD_BACK_FALLBACK;
		}}
	/>;
}

function pileCount(pile: string[] | { count: number } | undefined): number {
	if (!pile) return 0;
	return Array.isArray(pile) ? pile.length : pile.count;
}

function handIds(hand: string[] | { count: number } | undefined): string[] | null {
	return Array.isArray(hand) ? hand : null;
}

function sameSlot(a: TcgSlot | null, b: TcgSlot | undefined): boolean {
	if (a == null || b == null) return false;
	if (a === 'active' || b === 'active') return a === b;
	return Number(a) === Number(b);
}

function actionTouchesHand(a: TcgAction, hand: number): boolean {
	return a.hand === hand;
}

function actionTouchesSlot(a: TcgAction, slot: TcgSlot): boolean {
	return sameSlot(slot, a.slot) || sameSlot(slot, a.foeSlot) || sameSlot(slot, a.targetSlot) ||
		(typeof slot === 'number' && a.bench === slot);
}

function hasBoardTarget(a: TcgAction): boolean {
	return a.slot != null || a.bench != null || a.targetSlot != null || a.foeSlot != null;
}

type DropKind = 'slot' | 'play' | 'stadium' | 'discard';
type DropTarget = {
	kind: DropKind,
	slot?: TcgSlot,
	foe?: boolean,
	empty?: boolean,
};
type DragSource = {
	source: 'hand' | 'zone',
	hand?: number,
	cardId?: string,
	image?: string,
	name?: string,
};
type DragState = DragSource & {
	x: number,
	y: number,
	active: boolean,
	originX: number,
	originY: number,
	over: DropTarget | null,
	hint: string,
};

function dropVerb(a: TcgAction): string {
	switch (a.type) {
	case 'setActive': return 'Set Active';
	case 'setBench': case 'playBasic': case 'mulliganBench': return 'Bench';
	case 'evolve': return 'Evolve';
	case 'attachEnergy': case 'attachZone': return 'Attach Energy';
	case 'attachTool': return 'Attach Tool';
	case 'playTrainer': return 'Play';
	case 'playStadium': return 'Play Stadium';
	case 'discardPick': return 'Discard';
	case 'promote': return 'Promote';
	case 'retreat': return 'Retreat here';
	case 'pickSlot': return 'Choose';
	default: return 'Play';
	}
}

function actionsForDrop(acts: TcgAction[], drag: DragSource, drop: DropTarget): TcgAction[] {
	if (drag.source === 'zone') {
		if (drop.kind !== 'slot' || drop.foe) return [];
		return acts.filter(a => a.type === 'attachZone' && actionTouchesSlot(a, drop.slot!));
	}
	const hand = drag.hand;
	if (hand == null) return [];
	const mine = acts.filter(a => actionTouchesHand(a, hand));
	if (drop.kind === 'play') {
		return mine.filter(a =>
			a.type === 'playStadium' ||
			(a.type === 'playTrainer' && !hasBoardTarget(a))
		);
	}
	if (drop.kind === 'stadium') {
		return mine.filter(a => a.type === 'playStadium');
	}
	if (drop.kind === 'discard') {
		return mine.filter(a => a.type === 'discardPick');
	}
	if (drop.kind === 'slot') {
		if (drop.foe) {
			return mine.filter(a =>
				sameSlot(drop.slot!, a.foeSlot) ||
				(a.type === 'pickSlot' && actionTouchesSlot(a, drop.slot!)) ||
				(a.type === 'playTrainer' && sameSlot(drop.slot!, a.foeSlot))
			);
		}
		if (drop.empty) {
			if (drop.slot === 'active') {
				return mine.filter(a => a.type === 'setActive');
			}
			return mine.filter(a =>
				a.type === 'playBasic' || a.type === 'setBench' || a.type === 'mulliganBench'
			);
		}
		return mine.filter(a => actionTouchesSlot(a, drop.slot!));
	}
	return [];
}

function canDropAnywhere(acts: TcgAction[], drag: DragSource, drop: DropTarget): boolean {
	return actionsForDrop(acts, drag, drop).length > 0;
}

function sameDrop(a: DropTarget | null, b: DropTarget | null): boolean {
	if (!a || !b) return a === b;
	if (a.kind !== b.kind) return false;
	if (a.kind === 'slot') {
		return a.foe === b.foe && sameSlot(a.slot!, b.slot) && !!a.empty === !!b.empty;
	}
	return true;
}

/**
 * Prize cards still face down. The opening replay snapshot is taken before prizes are set
 * out (count 0), so during setup report the full set rather than "all taken".
 */
function prizesLeft(p: TcgPlayerView, need: number, status?: string): number {
	const n = pileCount(p.prizes);
	return status === 'setup' && !n ? need : n;
}
function scoredPoints(p: TcgPlayerView, need: number, status?: string): number {
	return Math.max(0, need - prizesLeft(p, need, status));
}

function pip(type: string, key?: string | number) {
	return <span
		key={key} class="tcg-pip" title={type}
		style={{ background: TYPE_COLOR[type] || '#9aa' }}
	></span>;
}


function promptHeading(snap: TcgSnapshot, kind: string): { title: string, sub?: string } {
	if (kind === 'confirm') {
		return {
			title: snap.pendingConfirm?.title || 'Confirm',
			sub: snap.pendingConfirm?.text,
		};
	}
	if (kind === 'first') return { title: 'Who goes first?' };
	if (kind === 'search') {
		const ps = snap.pendingSearch;
		const left = ps?.left != null ? ` · ${ps.left} left` : '';
		const dest = ps?.dest === 'bench' ? ' to the Bench' :
			ps?.dest === 'active' ? ' to Active' :
			ps?.dest === 'hand' ? ' to your hand' : '';
		const zone = ps?.zone === 'discard' ? 'from your discard pile' :
			ps?.zone === 'prizes' || ps?.zone === 'prize' ? 'from your Prize cards' : 'from your deck';
		return { title: `Choose a card${dest}`, sub: `${zone}${left}` };
	}
	if (kind === 'pay') return { title: 'Discard Energy to retreat', sub: snap.pendingRetreatPay?.need != null ? `Choose ${snap.pendingRetreatPay.need}` : undefined };
	if (kind === 'mulligan') return { title: 'Mulligan', sub: 'Place Basics on the Bench, or keep your hand' };
	if (kind === 'endTurn') return { title: 'End your turn?', sub: 'You still have actions available' };
	if (kind === 'prize') return { title: 'Take a Prize card', sub: 'Select a Prize from your prize row' };
	return { title: 'Choose' };
}

export function describeAction(a: TcgAction, snap: TcgSnapshot): string {
	const me = snap.players[snap.you ?? 0];
	const handId = (i?: number) => (Array.isArray(me?.hand) && i != null ? me.hand[i] : '') || '';
	const cardAt = (i?: number) => cardLabel(handId(i));
	const slotName = (s?: TcgSlot) => s === 'active' ? 'Active' : s == null ? '' : `Bench ${Number(s) + 1}`;
	const monAt = (s?: TcgSlot) => {
		if (!me || s == null) return '';
		if (s === 'active') return me.active?.name || 'Active';
		return me.bench?.[Number(s)]?.name || slotName(s);
	};
	switch (a.type) {
	case 'setupDone': return 'Ready';
	case 'endTurn': return 'End Turn';
	case 'setActive': return `Active: ${cardAt(a.hand)}`;
	case 'setBench': return `Bench: ${cardAt(a.hand)}`;
	case 'playBasic': return `Bench ${cardAt(a.hand)}`;
	case 'evolve': return `Evolve ${monAt(a.slot)} → ${cardAt(a.hand)}`;
	case 'attachEnergy': return `Attach ${cardAt(a.hand)} to ${monAt(a.slot)}`;
	case 'attachTool': return `Tool ${cardAt(a.hand)} → ${monAt(a.slot)}`;
	case 'playTrainer': return `Play ${cardAt(a.hand)}`;
	case 'playStadium': return `Stadium ${cardAt(a.hand)}`;
	case 'useStadium': return 'Use Stadium';
	case 'ability': {
		const mon = a.slot === 'active' ? me?.active : me?.bench?.[Number(a.slot)];
		const ab = mon?.abilities?.[a.index];
		return ab?.name || `Ability ${slotName(a.slot)}`;
	}
	case 'retreat': return `Retreat → ${monAt(a.bench)}`;
	case 'payEnergy': return 'Discard Energy';
	case 'attack': {
		const atk = me?.active?.attacks?.[a.index];
		return atk?.name || `Attack ${(a.index ?? 0) + 1}`;
	}
	case 'searchPick': return `Take ${cardLabel(a.pick)}`;
	case 'searchDone': return 'Done searching';
	case 'discardPick': return `Discard ${cardAt(a.hand)}`;
	case 'confirmYes': return 'Yes';
	case 'confirmNo': return 'No';
	case 'promote': return `Promote ${monAt(a.bench)}`;
	case 'chooseFirst': return a.goFirst ? 'Go first' : 'Go second';
	case 'mulliganBench': return `Bench ${cardAt(a.hand)}`;
	case 'mulliganDone': return 'Keep hand';
	case 'takePrize': return `Take Prize ${Number(a.index) + 1}`;
	case 'attachZone': return `Attach Energy → ${monAt(a.slot)}`;
	case 'pickSlot': return `Choose ${monAt(a.slot) || slotName(a.slot)}`;
	case 'playVunion': return `Play ${a.name || 'V-UNION'}`;
	default: return a.type;
	}
}

class TcgCardFace extends preact.Component<{
	cardId?: string, image?: string, name?: string, size?: CardSize, selected?: boolean,
	back?: boolean, playable?: boolean, fanIndex?: number, fanCount?: number,
	dragging?: boolean, pocket?: boolean,
	onClick?: () => void,
	onInspect?: (p: Preview) => void,
	onPointerDown?: (e: PointerEvent) => void,
	/** Long-press opened the preview; cancel a play that pointer-up would send. */
	onHold?: () => void,
}> {
	holdTimer: number | null = null;
	held = false;
	holdX = 0;
	holdY = 0;
	clearHold() {
		if (this.holdTimer != null) window.clearTimeout(this.holdTimer);
		this.holdTimer = null;
	}
	inspect = (ev?: Event) => {
		const { cardId, image, name, back, onInspect } = this.props;
		if (back || !cardId || !onInspect) return;
		ev?.preventDefault();
		ev?.stopPropagation();
		onInspect({ cardId, image, name });
	};
	onPointerDown = (ev: PointerEvent) => {
		if (ev.button != null && ev.button !== 0) return;
		ev.stopPropagation();
		this.held = false;
		this.holdX = ev.clientX;
		this.holdY = ev.clientY;
		this.props.onPointerDown?.(ev);
		if (!this.props.onInspect || this.props.back || !this.props.cardId) return;
		this.clearHold();
		this.holdTimer = window.setTimeout(() => {
			this.holdTimer = null;
			this.held = true;
			this.props.onHold?.();
			this.inspect();
		}, 420);
	};
	onPointerUp = () => {
		this.clearHold();
	};
	onPointerMove = (ev: PointerEvent) => {
		if (this.holdTimer == null) return;
		if (Math.hypot(ev.clientX - this.holdX, ev.clientY - this.holdY) > 8) this.clearHold();
	};
	onClick = (ev: MouseEvent) => {
		ev.stopPropagation();
		if (this.held) {
			this.held = false;
			ev.preventDefault();
			return;
		}
		this.props.onClick?.();
	};
	onImgError = (ev: Event) => {
		const img = ev.currentTarget as HTMLImageElement | null;
		const cardId = this.props.cardId;
		if (!img || !cardId) return;
		const step = Number(img.dataset.fallback || '0');
		const forcePocket = !!this.props.pocket || isPocketCardId(cardId);

		if (forcePocket) {
			// 1) Limitless SM → 2) Limitless full → stop (keep broken rather than paper CDN)
			if (step < 1) {
				img.dataset.fallback = '1';
				img.src = cardArt(cardId, { pocket: true, large: false });
				return;
			}
			if (step < 2) {
				img.dataset.fallback = '2';
				img.src = cardArt(cardId, { pocket: true, large: true });
				return;
			}
			return;
		}

		// Paper / Standard: Scrydex (primary) → pokemontcg.io → hires → Scrydex large
		if (step < 1) {
			img.dataset.fallback = '1';
			img.src = paperTcgIoArt(cardId, false);
			return;
		}
		if (step < 2) {
			img.dataset.fallback = '2';
			img.src = paperTcgIoArt(cardId, true);
			return;
		}
		if (step < 3) {
			img.dataset.fallback = '3';
			img.src = scrydexArt(cardId, true);
			return;
		}
	};
	override render() {
		const {
			cardId, image, name, size, selected, back, playable, fanIndex, fanCount, dragging,
			pocket, onInspect,
		} = this.props;
		const src = image || (cardId ? cardArt(cardId, pocket ? { pocket: true } : undefined) : '');
		const cls = [
			'tcg-card', `tcg-card-${size || 'md'}`,
			selected ? 'tcg-card-selected' : '',
			back ? 'tcg-card-back' : '',
			this.props.onClick || this.props.onPointerDown || onInspect ? 'tcg-card-click' : '',
			playable ? 'tcg-card-playable' : '',
			dragging ? 'tcg-card-dragging' : '',
			fanCount ? 'tcg-card-fan' : '',
		].filter(Boolean).join(' ');
		const label = name || (cardId ? cardLabel(cardId) : '');
		const mid = fanCount ? (fanCount - 1) / 2 : 0;
		const style = fanCount != null && fanIndex != null ? {
			'--fan': String(fanIndex - mid),
			zIndex: selected ? 30 : fanIndex + 1,
		} as any : undefined;
		return <button
			type="button" class={cls} style={style}
			onClick={onInspect || this.props.onClick ? this.onClick : undefined}
			onPointerDown={onInspect || this.props.onPointerDown ? this.onPointerDown : undefined}
			onPointerUp={this.onPointerUp}
			onPointerCancel={this.onPointerUp}
			onPointerMove={this.onPointerMove}
			onContextMenu={onInspect ? this.inspect : ev => ev.preventDefault()}
			title={label} aria-pressed={selected}
		>
			<span class="tcg-card-inner">
				{back || !src ?
					<CardBackFace /> :
					<img src={src} alt={label} draggable={false} onError={this.onImgError} />}
			</span>
		</button>;
	}
}

class TcgMon extends preact.Component<{
	mon: TcgPokemonView | null, slot: TcgSlot, size?: CardSize, selected?: boolean,
	activeSpot?: boolean, legal?: boolean, foe?: boolean, pkFx?: PkFx | null,
	dropOk?: boolean, dropHot?: boolean, dropLabel?: string,
	/** Just flipped face up (end of setup). */
	reveal?: boolean,
	onClick?: () => void, onInspect?: (p: Preview) => void,
}> {
	baseEl: HTMLElement | null = null;
	holdTimer: number | null = null;
	held = false;
	clearHold() {
		if (this.holdTimer != null) window.clearTimeout(this.holdTimer);
		this.holdTimer = null;
	}
	onPointerDown = (ev: PointerEvent) => {
		const mon = this.props.mon;
		if (!mon || !this.props.onInspect) return;
		if (ev.button != null && ev.button !== 0) return;
		this.held = false;
		this.clearHold();
		this.holdTimer = window.setTimeout(() => {
			this.holdTimer = null;
			this.held = true;
			this.props.onInspect?.({ cardId: mon.cardId, image: mon.image, name: mon.name });
		}, 420);
	};
	onPointerUp = () => {
		this.clearHold();
	};
	onClick = (ev: MouseEvent) => {
		if (this.held) {
			this.held = false;
			ev.preventDefault();
			ev.stopPropagation();
			return;
		}
		this.props.onClick?.();
	};

	hpEl: HTMLElement | null = null;
	hpRaf: number | null = null;
	/** Tick the HP number from the old value to the new one instead of snapping (TCG Live style). */
	tweenHp(from: number, to: number) {
		const el = this.hpEl;
		if (!el || from === to || PS.prefs.noanim) return;
		if (this.hpRaf != null) cancelAnimationFrame(this.hpRaf);
		const start = performance.now();
		const dur = 650;
		el.classList.add(to < from ? 'hp-dropping' : 'hp-rising');
		el.textContent = String(from); // preact already wrote `to`; start from the old value
		const tick = (now: number) => {
			const t = Math.min(1, (now - start) / dur);
			const e = 1 - (1 - t) ** 3;
			el.textContent = String(Math.round(from + (to - from) * e));
			if (t < 1) {
				this.hpRaf = requestAnimationFrame(tick);
			} else {
				this.hpRaf = null;
				el.textContent = String(to);
				el.classList.remove('hp-dropping', 'hp-rising');
			}
		};
		this.hpRaf = requestAnimationFrame(tick);
	}
	override componentWillUnmount() {
		if (this.hpRaf != null) cancelAnimationFrame(this.hpRaf);
		this.clearHold();
	}
	override componentDidUpdate(prev: this['props']) {
		if (prev.mon?.iid !== this.props.mon?.iid && this.hpRaf != null) {
			// A different Pokémon now sits here: do not finish the old one's tick on its number.
			cancelAnimationFrame(this.hpRaf);
			this.hpRaf = null;
			this.hpEl?.classList.remove('hp-dropping', 'hp-rising');
		}
		if (prev.mon && this.props.mon && prev.mon.iid === this.props.mon.iid && prev.mon.hp !== this.props.mon.hp) {
			this.tweenHp(prev.mon.hp, this.props.mon.hp);
		} else if (this.props.mon && this.hpEl && this.hpRaf == null && this.hpEl.textContent !== String(this.props.mon.hp)) {
			// The tween writes the text node directly; preact skips a rewrite when the
			// vnode text did not change, so make sure the final number is the real one.
			this.hpEl.textContent = String(this.props.mon.hp);
		}
		const cur = this.props.pkFx;
		const was = prev.pkFx;
		if (!cur?.cls || !this.baseEl) return;
		if (cur.tick == null || cur.tick === was?.tick) return;
		// Restart hit/heal CSS when the same mon takes another sequential hit.
		const el = this.baseEl;
		const parts = cur.cls.split(/\s+/).filter(Boolean);
		for (const c of parts) el.classList.remove(c);
		el.removeAttribute('data-fx');
		// force reflow
		void el.offsetWidth;
		for (const c of parts) el.classList.add(c);
		if (cur.dataFx) el.setAttribute('data-fx', cur.dataFx);
	}

	override render() {
		const {
			mon, selected, activeSpot, legal, foe, pkFx,
			dropOk, dropHot, dropLabel,
			onClick, onInspect, size,
		} = this.props;
		const cardSize: CardSize = size || (activeSpot ? 'lg' : 'sm');
		if (!mon) {
			return <div
				class={`tcg-mon empty ${activeSpot ? 'active' : ''} ${legal ? 'legal' : ''} ${selected ? 'selected' : ''} ${dropOk ? 'drop-ok' : ''} ${dropHot ? 'drop-hot' : ''}`}
				onClick={onClick}
				data-drop-slot={String(this.props.slot)}
				data-drop-foe={foe ? '1' : '0'}
				data-drop-empty="1"
			>
				<span>{activeSpot ? 'Active' : 'Bench'}</span>
				{dropHot && dropLabel && <em class="tcg-drop-tag">{dropLabel}</em>}
			</div>;
		}
		const pct = mon.maxHp ? Math.max(0, Math.min(100, (mon.hp / mon.maxHp) * 100)) : 0;
		const hpTone = pct > 50 ? 'ok' : pct > 25 ? 'mid' : 'low';
		if (mon.faceDown) {
			return <div
				ref={el => { this.baseEl = el as HTMLElement | null; }}
				class={`tcg-mon face-down ${activeSpot ? 'active' : ''} ${foe ? 'foe' : ''} ${pkFx?.cls || ''}`}
				data-iid={mon.iid}
				data-drop-slot={String(this.props.slot)}
				data-drop-foe={foe ? '1' : '0'}
				data-drop-empty="0"
				title="Face-down Pokémon"
				onContextMenu={ev => ev.preventDefault()}
			>
				<TcgCardFace cardId="" name="Face-down Pokémon" size={cardSize} back />
			</div>;
		}
		const cls = [
			'tcg-mon', activeSpot ? 'active' : '', foe ? 'foe' : '',
			selected ? 'selected' : '', legal ? 'legal' : '',
			dropOk ? 'drop-ok' : '', dropHot ? 'drop-hot' : '',
			pkFx?.cls || '',
			this.props.reveal ? 'fx-reveal' : '',
		].filter(Boolean).join(' ');
		return <div
			ref={el => { this.baseEl = el as HTMLElement | null; }}
			class={cls}
			onClick={this.onClick}
			onPointerDown={this.onPointerDown}
			onPointerUp={this.onPointerUp}
			onPointerCancel={this.onPointerUp}
			onContextMenu={ev => {
				ev.preventDefault();
				if (mon) this.props.onInspect?.({ cardId: mon.cardId, image: mon.image, name: mon.name });
			}}
			data-iid={mon.iid}
			data-fx={pkFx?.dataFx || undefined}
			data-fx-tick={pkFx?.tick != null ? String(pkFx.tick) : undefined}
			data-el={pkFx?.element || undefined}
			data-drop-slot={String(this.props.slot)}
			data-drop-foe={foe ? '1' : '0'}
			data-drop-empty="0"
		>
			<TcgCardFace
				cardId={mon.cardId} image={mon.image} name={mon.name} size={cardSize}
				onClick={onClick} onInspect={onInspect}
			/>
			<div class={`tcg-hp ${hpTone}`} title={`${mon.hp} / ${mon.maxHp || mon.hp} HP`}>
				<span class="tcg-hp-val" ref={el => { this.hpEl = el as HTMLElement | null; }}>{mon.hp}</span>
				<span class="tcg-hp-track" aria-hidden="true">
					<span class="tcg-hp-fill" style={{ width: `${pct}%` }}></span>
				</span>
			</div>
			<div class="tcg-energy-row">
				{(mon.energy || []).map((t, i) => pip(t, i))}
			</div>
			{(mon.status || mon.poisoned || mon.burned) &&
				<div class="tcg-status">{mon.status}{mon.poisoned ? ' PSN' : ''}{mon.burned ? ' BRN' : ''}</div>}
			{pkFx?.element && <TypeHit type={pkFx.element} tick={pkFx.tick} />}
			{dropHot && dropLabel && <em class="tcg-drop-tag">{dropLabel}</em>}
		</div>;
	}
}

class TcgPoints extends preact.Component<{ scored: number, need: number, pocket: boolean }> {
	override render() {
		const { scored, need, pocket } = this.props;
		const n = Math.max(need, 1);
		return <div
			class={`tcg-points ${pocket ? 'as-points' : 'as-prizes'}`}
			title={pocket ? `${scored} / ${n} points` : `${n - scored} prizes left`}
		>
			{Array.from({ length: n }, (_, i) =>
				<span class={`tcg-point ${i < scored ? 'on' : ''}`}></span>
			)}
			<small>{pocket ? `${scored}/${n}` : `${n - scored}`}</small>
		</div>;
	}
}

/** Face-down prize column — Live style (left rail). */
class TcgPrizeRail extends preact.Component<{
	remaining: number, max: number, foe?: boolean,
	takeActs?: TcgAction[], onTake?: (a: TcgAction) => void,
}> {
	override render() {
		const { remaining, max, foe, takeActs, onTake } = this.props;
		const n = Math.max(max, 1);
		const left = Math.max(0, Math.min(n, remaining));
		return <div class={`tcg-prizes ${foe ? 'foe' : 'me'}`} title={`${left} Prize card${left === 1 ? '' : 's'}`}>
			<strong class="tcg-prize-count">{left}</strong>
			<div class="tcg-prize-stack">
				{Array.from({ length: n }, (_, i) => {
					const alive = i < left;
					const act = (!foe && alive && takeActs) ?
						(takeActs.find(a => a.index === i) || takeActs.find(a => a.index == null) || takeActs[0]) : null;
					return <button
						type="button"
						key={i}
						class={`tcg-prize ${alive ? 'up' : 'taken'} ${act ? 'takeable' : ''}`}
						disabled={!act}
						onClick={act && onTake ? () => onTake(act) : undefined}
						aria-label={alive ? `Prize ${i + 1}` : 'Taken'}
					>
						<CardBackFace />
					</button>;
				})}
			</div>
		</div>;
	}
}

export class TcgBoard extends preact.Component<{
	snapshot: TcgSnapshot,
	events: TcgEvent[],
	fxKey: number,
	/** Bumps when playback is cancelled (skip / replay) so the current beat stops. */
	halt?: number,
	/** Board after this beat. Display keeps `snapshot` until the beat finishes. */
	fxSnapshot?: TcgSnapshot | null,
	waiting: boolean,
	ended?: boolean,
	/** Winner display name; `null`/empty with ended = tie or unknown. */
	winnerName?: string | null,
	onAct: (action: TcgAction) => void,
	/** Fired when a beat starts, including events that share that beat. */
	onEvent?: (ev: TcgEvent) => void,
	onFxDone?: () => boolean,
	paused?: boolean,
	onTogglePause?: () => void,
	onReplay?: () => void,
	onSkip?: () => void,
	/** When false, post-game Play/Replay/Skip chrome is omitted (parent control strip owns it). */
	showReplayControls?: boolean,
}> {
	override state = {
		selectedHand: null as number | null,
		energyPick: false,
		retreatPick: false,
		fx: null as FxBeat | null,
		pkFx: {} as { [iid: string]: PkFx },
		/** Kept in the vacated slot while KO FX plays (snapshot already removed the mon). */
		koGhost: null as KoGhost | null,
		/** iids that have already fainted this payload — stay hidden after the KO beat. */
		koHide: {} as { [iid: string]: true },
		/** Incoming Pokémon shown in its destination slot during a place / switch-in beat. */
		placeIn: null as { seat: number, slot: TcgSlot, mon: TcgPokemonView } | null,
		/**
		 * Effects of beats that have already played in this batch, applied on top of the
		 * pre-batch snapshot so the board reacts at the beat instead of at commit:
		 * cards leave your hand as they are played, HP drops with each hit, energy lands.
		 */
		live: { hand: {}, hp: {}, energy: {} } as {
			hand: { [cardId: string]: number },
			hp: { [iid: string]: number },
			energy: { [iid: string]: string[] },
		},
		/** fxKey the live overlay was built for; an overlay from an earlier batch is ignored. */
		liveKey: -1,
		inspect: null as Preview | null,
		menuSlot: null as TcgSlot | null,
		endTurnConfirm: false,
		/**
		 * takePrize clicks already sent while the board still shows the pre-pick snapshot.
		 * Used so the prize prompt closes as soon as enough picks are in, not after FX.
		 */
		prizeTakenLocal: 0,
		drag: null as DragState | null,
	};
	timer: number | null = null;
	tableEl: HTMLElement | null = null;
	dragMoved = false;
	/** Set when a long-press opened the preview, so pointer-up does not play the card. */
	holdConsumed = false;
	/** Last-seen board mons by iid — survives snapshot removal so KO can animate. */
	monMemory: { [iid: string]: KoGhost } = {};
	/** Mons removed on the latest snapshot, held until their KO (or the next unrelated beat). */
	freshOut: { [iid: string]: true } = {};
	lastSnap: TcgSnapshot | null = null;
	/** Opponent setup placeholders seen face down, and the ones flipping up on this snapshot. */
	faceDownSeen: { [iid: string]: true } = {};
	revealing: { [iid: string]: true } = {};
	/** Pre-draw hand per seat — snapshot already has the new hand when shuffle FX runs. */
	handMemory: { [seat: number]: { ids: string[] | null, count: number } } = {};
	/** Events that arrived while a beat was still playing. */
	fxPending: TcgEvent[] = [];
	fxBusy = false;

	stashHands(snap: TcgSnapshot | null | undefined) {
		if (!snap?.players) return;
		snap.players.forEach((p, seat) => {
			if (!p) return;
			this.handMemory[seat] = { ids: handIds(p.hand), count: pileCount(p.hand) };
		});
	}

	/** Cards that appeared in hand since the last stash (for draw FX when event.ids missing). */
	inferDrawnIds(seat: number, n: number): string[] | null {
		const prev = this.handMemory[seat]?.ids;
		const curr = handIds((this.props.fxSnapshot || this.props.snapshot).players[seat]?.hand);
		if (!curr?.length) return null;
		if (!prev?.length) return curr.slice(Math.max(0, curr.length - n));
		const left = curr.slice();
		for (const id of prev) {
			const ix = left.indexOf(id);
			if (ix >= 0) left.splice(ix, 1);
		}
		if (left.length) return left;
		return curr.slice(Math.max(0, curr.length - n));
	}

	override componentDidMount() {
		this.stashHands(this.props.snapshot);
		this.playFx(this.props.events);
		window.addEventListener('pointermove', this.onDragMove);
		window.addEventListener('pointerup', this.onDragEnd);
		window.addEventListener('pointercancel', this.onDragEnd);
		window.addEventListener('keydown', this.onKeyDown);
	}
	/** Where every on-board Pokémon was before this render (FLIP "first"). */
	flipRects: { [iid: string]: { left: number, top: number, width: number, height: number } } = {};
	/** Layout box relative to the table, ignoring any transform mid-animation (lunge, shake, hover). */
	layoutBox(el: HTMLElement) {
		let left = 0;
		let top = 0;
		let node: HTMLElement | null = el;
		while (node && node !== this.tableEl) {
			left += node.offsetLeft;
			top += node.offsetTop;
			node = node.offsetParent as HTMLElement | null;
		}
		return { left, top, width: el.offsetWidth, height: el.offsetHeight };
	}
	override componentWillUpdate() {
		this.flipRects = {};
		const root = this.tableEl;
		if (!root || PS.prefs.noanim) return;
		root.querySelectorAll<HTMLElement>('.tcg-mon[data-iid]').forEach(el => {
			const iid = el.dataset.iid;
			if (iid) this.flipRects[iid] = this.layoutBox(el);
		});
	}
	/** Glide any Pokémon whose slot changed from its old box to the new one (FLIP "last/invert/play"). */
	flipMoved() {
		const root = this.tableEl;
		const first = this.flipRects;
		this.flipRects = {};
		if (!root || typeof (root as any).animate !== 'function') return;
		root.querySelectorAll<HTMLElement>('.tcg-mon[data-iid]').forEach(el => {
			const iid = el.dataset.iid;
			const was = iid && first[iid];
			if (!was) return;
			// Beats with their own entrance/exit motion keep it.
			// (A switch-in keeps its glow but glides from its real bench spot instead of the canned offset.)
			if (/\bfx-(place|ko|reveal|lunge|hit)\b/.test(el.className)) return;
			const now = this.layoutBox(el);
			const dx = was.left - now.left;
			const dy = was.top - now.top;
			if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
			const sx = was.width && now.width ? was.width / now.width : 1;
			const sy = was.height && now.height ? was.height / now.height : 1;
			el.classList.add('is-flipping');
			const anim = el.animate([
				{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, filter: 'drop-shadow(0 10px 10px rgba(0,0,0,0.35))' },
				{ transform: `translate(${dx * 0.4}px, ${dy * 0.4}px) scale(${1 + (sx - 1) * 0.4}, ${1 + (sy - 1) * 0.4})`, filter: 'drop-shadow(0 14px 14px rgba(0,0,0,0.4))', offset: 0.5 },
				{ transform: 'translate(0, 0) scale(1, 1)', filter: 'drop-shadow(0 0 0 rgba(0,0,0,0))' },
			], { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'none' });
			const done = () => el.classList.remove('is-flipping');
			anim.onfinish = done;
			anim.oncancel = done;
		});
	}
	override componentDidUpdate(prev: this['props'], prevState: this['state']) {
		this.flipMoved();
		if (this.props.halt !== prev.halt) {
			this.fxPending = [];
			this.fxBusy = false;
			if (this.timer != null) window.clearTimeout(this.timer);
			this.timer = null;
			this.clearFx();
		}
		// Server caught up to our prize picks — drop the optimistic counter.
		const prevPrize = prev.snapshot?.pendingPrize;
		const nextPrize = this.props.snapshot?.pendingPrize;
		if (
			this.state.prizeTakenLocal &&
			(prevPrize?.n !== nextPrize?.n || prevPrize?.seat !== nextPrize?.seat || !nextPrize)
		) {
			this.setState({ prizeTakenLocal: 0 });
		}
		if (this.props.fxKey !== prev.fxKey) {
			this.stashHands(prev.fxSnapshot || prev.snapshot);
			this.playFx(this.props.events);
		} else if (this.state.fx !== prevState.fx) {
			requestAnimationFrame(() => this.aimFlyers());
			if (prevState.fx?.kind === 'shuffleHand' && this.state.fx?.kind !== 'shuffleHand') {
				this.stashHands(this.props.snapshot);
			}
		} else if (this.props.snapshot !== prev.snapshot && this.state.fx?.kind !== 'shuffleHand') {
			this.stashHands(this.props.snapshot);
		}
	}
	override componentWillUnmount() {
		this.fxPending = [];
		this.fxBusy = false;
		if (this.timer != null) window.clearTimeout(this.timer);
		window.removeEventListener('pointermove', this.onDragMove);
		window.removeEventListener('pointerup', this.onDragEnd);
		window.removeEventListener('pointercancel', this.onDragEnd);
		window.removeEventListener('keydown', this.onKeyDown);
	}

	onKeyDown = (e: KeyboardEvent) => {
		if (e.key === 'Escape') this.closeInspect();
	};

	clearFx() {
		if (this.state.fx?.kind === 'ko' && this.state.fx.iid) delete this.freshOut[this.state.fx.iid];
		this.liveNow = { hand: {}, hp: {}, energy: {} };
		this.setState({ fx: null, pkFx: {}, koGhost: null, koHide: {}, placeIn: null, live: this.liveNow });
	}

	/**
	 * Synchronous copy of state.live. Each batch starts from an empty overlay: its
	 * snapshot already includes everything earlier batches animated, so carrying the
	 * old overlay over would subtract that damage (or remove that hand card) twice.
	 */
	liveNow: TcgBoard['state']['live'] = { hand: {}, hp: {}, energy: {} };
	static readonly NO_LIVE: TcgBoard['state']['live'] = { hand: {}, hp: {}, energy: {} };
	/** The overlay to render with: only while a beat of the current batch is on screen. */
	liveOverlay() {
		if (!this.state.fx || this.state.liveKey !== this.props.fxKey) return TcgBoard.NO_LIVE;
		return this.state.live;
	}
	/** Fold a beat that is now playing into the live overlay (see state.live). */
	applyLive(fx: FxBeat, you: number | null | undefined) {
		const live = {
			hand: { ...this.liveNow.hand },
			hp: { ...this.liveNow.hp },
			energy: { ...this.liveNow.energy },
		};
		const oldPlayers = this.props.snapshot.players;
		const finalPlayers = this.props.fxSnapshot?.players || oldPlayers;
		const fromHand = fx.kind === 'energy' || fx.kind === 'tool' || fx.kind === 'trainer' ||
			fx.kind === 'stadium' || fx.kind === 'evolve' || (fx.kind === 'place' && !fx.fromBench);
		// Attach events carry the target Pokémon, not always the seat; the owner of the target played it.
		const seat = fx.seat ?? (fx.iid ? findMonSlot(oldPlayers, fx.iid)?.seat : undefined);
		if (fromHand && fx.cardId && actorIsYou(seat, you)) {
			live.hand[fx.cardId] = (live.hand[fx.cardId] || 0) + 1;
		}
		const hits = fx.hits?.length ? fx.hits : (fx.kind === 'damage' || fx.kind === 'heal') && fx.iid ?
			[{ iid: fx.iid, amount: fx.amount, kind: fx.kind }] : [];
		hits.forEach(h => {
			if (h.kind !== 'damage' && h.kind !== 'heal') return;
			const mon = findMonView(oldPlayers, h.iid);
			if (!mon || !h.amount) return;
			const cur = live.hp[h.iid] ?? mon.hp;
			live.hp[h.iid] = h.kind === 'damage' ?
				Math.max(0, cur - h.amount) :
				Math.min(mon.maxHp || cur + h.amount, cur + h.amount);
		});
		if ((fx.kind === 'energy' || fx.kind === 'tool') && fx.iid) {
			const after = findMonView(finalPlayers, fx.iid);
			if (after?.energy) live.energy[fx.iid] = after.energy;
		}
		this.liveNow = live;
		return live;
	}

	noteRemovals(snap: TcgSnapshot) {
		if (this.lastSnap && this.lastSnap !== snap) {
			const prev = this.lastSnap;
			Object.keys(this.monMemory).forEach(iid => {
				if (findMonView(prev.players, iid) && !findMonView(snap.players, iid)) {
					this.freshOut[iid] = true;
				}
			});
			// Setup placeholders that just turned face up get one flip animation.
			this.revealing = {};
			Object.keys(this.faceDownSeen).forEach(iid => {
				const now = findMonView(snap.players, iid);
				if (now && !now.faceDown) {
					this.revealing[iid] = true;
					delete this.faceDownSeen[iid];
				} else if (!now) {
					delete this.faceDownSeen[iid];
				}
			});
		}
		snap.players.forEach(p => {
			if (p?.active?.faceDown) this.faceDownSeen[p.active.iid] = true;
			(p?.bench || []).forEach(m => { if (m?.faceDown) this.faceDownSeen[m.iid] = true; });
		});
		this.lastSnap = snap;
	}

	rememberMons(snap: TcgSnapshot) {
		snap.players.forEach((p, seat) => {
			if (p.active) {
				this.monMemory[p.active.iid] = {
					iid: p.active.iid,
					cardId: p.active.cardId,
					name: p.active.name,
					image: p.active.image,
					hp: p.active.hp,
					maxHp: p.active.maxHp,
					seat,
					slot: 'active',
				};
			}
			(p.bench || []).forEach((m, i) => {
				if (!m) return;
				this.monMemory[m.iid] = {
					iid: m.iid,
					cardId: m.cardId,
					name: m.name,
					image: m.image,
					hp: m.hp,
					maxHp: m.maxHp,
					seat,
					slot: i,
				};
			});
		});
	}

	ghostForKo(fx: FxBeat, e: TcgEvent): KoGhost | null {
		if (!fx.iid) return null;
		const mem = this.monMemory[fx.iid];
		if (mem) return mem;
		const seat = fx.seat ?? e.seat ?? 0;
		const slot: TcgSlot = e.bench ? 0 : 'active';
		return {
			iid: fx.iid,
			cardId: fx.cardId || e.cardId || '',
			name: fx.extra || e.name || 'Pokémon',
			seat,
			slot,
		};
	}

	displayMon(seat: number, slot: TcgSlot, live: TcgPokemonView | null): TcgPokemonView | null {
		const placed = this.state.placeIn;
		if (placed && placed.seat === seat && sameSlot(placed.slot, slot)) return placed.mon;
		// Keep the real card through the KO. Swapping it for a copy made it vanish and pop back.
		if (live && this.state.koHide[live.iid]) return null;
		if (live && placed && live.iid === placed.mon.iid) return null;
		if (live) {
			const overlay = this.liveOverlay();
			const hp = overlay.hp[live.iid];
			const energy = overlay.energy[live.iid];
			if (hp == null && !energy) return live;
			return { ...live, hp: hp ?? live.hp, energy: energy || live.energy };
		}
		const g = this.state.koGhost;
		if (g && g.seat === seat && sameSlot(g.slot, slot)) {
			return {
				iid: g.iid,
				cardId: g.cardId,
				name: g.name,
				image: g.image,
				hp: g.hp ?? 0,
				maxHp: g.maxHp ?? g.hp ?? 0,
			};
		}
		const fx = this.state.fx;
		const events = this.props.events || [];
		let held: TcgPokemonView | null = null;
		Object.keys(this.monMemory).forEach(iid => {
			if (held) return;
			const mem = this.monMemory[iid];
			if (!mem || mem.seat !== seat || !sameSlot(mem.slot, slot)) return;
			if (findMonView(this.props.snapshot.players, iid)) return;
			const knocking = (fx?.kind === 'ko' && fx.iid === iid) ||
				events.some(e => e.type === 'ko' && e.iid === iid) ||
				!!this.freshOut[iid];
			if (!knocking) return;
			held = {
				iid: mem.iid,
				cardId: mem.cardId,
				name: mem.name,
				image: mem.image,
				hp: mem.hp ?? 0,
				maxHp: mem.maxHp ?? mem.hp ?? 0,
			};
		});
		return held;
	}

	aimFlyers() {
		const root = this.tableEl;
		if (!root) return;
		const s = root.getBoundingClientRect();
		const aim = (fly: HTMLElement, fallbackSel: string, fromHand: boolean) => {
			const iid = fly.getAttribute('data-target');
			const target = (iid && root.querySelector(`.tcg-mon[data-iid="${CSS.escape(iid)}"]`)) as HTMLElement | null
				|| root.querySelector(fallbackSel) as HTMLElement | null;
			if (!target) {
				fly.classList.add('stay');
				return;
			}
			const t = target.getBoundingClientRect();
			const startX = fromHand ? (s.left + s.width / 2) : (s.left + s.width / 2);
			const startY = fromHand ? (s.top + s.height * 0.88) : (s.top + s.height / 2);
			const endX = t.left + t.width / 2;
			const endY = t.top + t.height / 2;
			fly.style.setProperty('--tx', `${Math.round(endX - startX)}px`);
			fly.style.setProperty('--ty', `${Math.round(endY - startY)}px`);
			fly.style.setProperty('--end-scale', String(Math.max(0.22, Math.min(0.55, t.width / 140))));
			fly.classList.add('go');
		};
		const en = root.querySelector('.fx-en-fly') as HTMLElement | null;
		if (en) aim(en, '.tcg-mon.fx-energy', false);
		const place = root.querySelector('.fx-place-fly') as HTMLElement | null;
		if (place) aim(place, '.tcg-mon.fx-place', true);
	}

	playFx(events: TcgEvent[]) {
		if (!events?.length || PS.prefs.noanim) {
			if (!this.fxBusy) this.clearFx();
			return;
		}
		// A fast CPU can deliver the next action before this one finishes.
		// Keep playing the current beat, then the new events, each for a fixed time.
		if (this.fxBusy) {
			this.fxPending.push(...events);
			return;
		}
		this.fxBusy = true;
		this.runFx(events);
	}

	finishFx() {
		if (this.fxPending.length) {
			const next = this.fxPending;
			this.fxPending = [];
			this.runFx(next);
			return;
		}
		this.fxBusy = false;
		const more = this.props.onFxDone?.() ?? false;
		if (!more) this.clearFx();
	}

	runFx(events: TcgEvent[]) {
		if (this.timer != null) window.clearTimeout(this.timer);
		// New batch, new baseline: props.snapshot now already reflects the previous batch.
		this.liveNow = { hand: {}, hp: {}, energy: {} };
		const shown = this.props.fxSnapshot || this.props.snapshot;
		const players = shown.players;
		const you = shown.you;
		let i = 0;
		let fxTick = 0;
		const HIT_MS = 1600;
		const WINDUP_MS = 1200;
		const BEAT_MS = 1600;

		const show = (fx: FxBeat, e?: TcgEvent) => {
			fxTick++;
			let koGhost: KoGhost | null = null;
			let placeIn: TcgBoard['state']['placeIn'] = null;
			const koHide = { ...this.state.koHide };
			const koStillQueued = (this.props.events || []).some(ev => ev.type === 'ko' && ev.iid && this.freshOut[ev.iid]);
			if (!koStillQueued && fx.kind !== 'ko' && fx.kind !== 'damage' && fx.kind !== 'attack' && fx.kind !== 'ability') {
				this.freshOut = {};
			}
			if (this.state.fx?.kind === 'ko' && this.state.fx.iid && fx.kind !== 'ko') {
				delete this.freshOut[this.state.fx.iid];
			}
			if (fx.kind === 'ko') {
				koGhost = e ? this.ghostForKo(fx, e) : (fx.iid ? this.monMemory[fx.iid] || null : null);
				if (koGhost && !fx.extra) fx.extra = koGhost.name;
				if (koGhost && (!fx.message || fx.message.includes('a Pokémon'))) {
					fx.message = `${koGhost.name} was Knocked Out`;
				}
			}
			if (fx.kind === 'place' && fx.iid) {
				const nextPlayers = this.props.fxSnapshot?.players || this.props.snapshot.players;
				const incoming = findMonView(nextPlayers, fx.iid) ||
					(fx.cardId ? {
						iid: fx.iid,
						cardId: fx.cardId,
						name: fx.extra || cardLabel(fx.cardId),
						hp: 0,
						maxHp: 0,
						image: this.monMemory[fx.iid]?.image,
					} : null);
				const dest = findMonSlot(nextPlayers, fx.iid);
				const seat = dest?.seat ?? fx.seat ?? 0;
				const slot = dest?.slot ?? fx.slot ?? 'active';
				const fromOld = findMonSlot(this.props.snapshot.players, fx.iid);
				fx.fromBench = !!(fromOld && fromOld.slot !== 'active' && slot === 'active');
				if (incoming) placeIn = { seat, slot, mon: incoming };
			}
			this.setState({
				fx, pkFx: buildPkFx(fx, fxTick), koGhost, koHide, placeIn,
				live: this.applyLive(fx, you), liveKey: this.props.fxKey,
			});
		};

		const step = () => {
			while (i < events.length && skipEvent(events, i)) {
				this.props.onEvent?.(events[i]);
				i++;
			}
			if (i >= events.length) {
				this.finishFx();
				return;
			}
			const e = events[i];
			this.props.onEvent?.(e);
			let fx = fxFor(e, events, i, players, you, shown);

			// Prefer private draw ids from the event; otherwise infer from hand delta for your seat.
			if ((fx.kind === 'draw' || fx.kind === 'drawEffect') && e.type === 'draw') {
				if ((!fx.ids || !fx.ids.length) && actorIsYou(e.seat, you) && e.seat != null) {
					const inferred = this.inferDrawnIds(e.seat, e.n || fx.n || 1);
					if (inferred?.length) {
						fx = { ...fx, ids: inferred, labels: inferred.map(cardLabel), n: inferred.length };
					}
				}
			}

			// Hand → deck shuffle (Cynthia / Red Card / etc.) has no dedicated event;
			// infer it when a multi-card draw follows a play, then animate before the draw.
			if (e.type === 'draw' && precededByHandShuffle(events, i)) {
				const mem = e.seat != null ? this.handMemory[e.seat] : undefined;
				const n = Math.max(mem?.count || 0, e.n || 5, 3);
				const shuffleFx: FxBeat = {
					kind: 'shuffleHand',
					seat: e.seat,
					n,
					ids: mem?.ids || undefined,
					extra: 'Shuffled hand into the deck',
					message: actorIsYou(e.seat, you) ?
						'You shuffled your hand into the deck' :
						`${actorLabel(players, e.seat, you)} shuffled their hand into the deck`,
				};
				show(shuffleFx);
				this.timer = window.setTimeout(() => {
					// Keep pre-draw hand memory until after this beat so inferDrawnIds still works
					// if ids were stripped — then refresh for later FX.
					show(fx, e);
					this.stashHands(this.props.snapshot);
					i++;
					const wait = Math.max(fx.kind === 'drawEffect' ? 3200 : fxDuration(e), BEAT_MS);
					this.timer = window.setTimeout(step, wait);
				}, 2000);
				return;
			}

			// Consecutive coin events → one staggered multi-coin beat.
			// Opening flip often arrives as coin + first; fold the announce into the coin beat.
			if (e.type === 'coin' || e.type === 'first') {
				const results: boolean[] = [];
				let j = i;
				if (e.type === 'coin') {
					results.push(!!e.heads);
					j = i + 1;
					while (j < events.length && events[j]?.type === 'coin') {
						this.props.onEvent?.(events[j]);
						results.push(!!events[j].heads);
						j++;
					}
				}
				let firstEv: TcgEvent | null = null;
				if (e.type === 'first') {
					firstEv = e;
					j = i + 1;
					// No coin event (older server): invent a face so the opening flip still animates.
					// Seat 0 won → Heads, seat 1 → Tails (matches engine mapping).
					results.push(e.seat === 0);
				} else if (events[j]?.type === 'first') {
					this.props.onEvent?.(events[j]);
					firstEv = events[j];
					j++;
				}
				const headsN = results.filter(Boolean).length;
				const tailsN = results.length - headsN;
				const whoFirst = firstEv?.seat != null ?
					actorLabel(players, firstEv.seat, you) : '';
				const youWonFirst = firstEv ? actorIsYou(firstEv.seat, you) : false;
				const coinFx: FxBeat = {
					kind: 'coin',
					coins: results,
					n: results.length,
					seat: firstEv?.seat ?? e.seat,
					extra: firstEv ? 'First' :
						(results.length === 1 ?
							(results[0] ? 'Heads' : 'Tails') :
							`${results.length} flips`),
					message: firstEv ?
						(firstEv.chooses ?
							(youWonFirst ?
								'You won the coin flip and choose who goes first' :
								`${whoFirst} won the coin flip and chooses who goes first`) :
							(youWonFirst ?
								'You won the coin flip and go first' :
								`${whoFirst} won the coin flip and goes first`)) :
						(results.length === 1 ?
							(results[0] ? 'Heads!' : 'Tails!') :
							`${headsN} Heads · ${tailsN} Tails`),
				};
				show(coinFx);
				// Flip (~1.55s) + stagger + hold; linger a bit longer for the first-player announce.
				const wait = (firstEv ? 2600 : 2100) + Math.max(0, results.length - 1) * 200;
				i = j;
				this.timer = window.setTimeout(step, wait);
				return;
			}

			if (e.type === 'attack' || e.type === 'ability') {
				const hits = attackHits(events, i, players);
				if (!fx.extra) fx.extra = e.name || (e.type === 'ability' ? 'Ability' : 'Attack');
				if (!fx.message) fx.message = `${monName(players, e.iid)} used ${fx.extra}`;

				const numbered = hits.filter(h =>
					(h.kind === 'damage' || h.kind === 'heal') && (h.amount || 0) > 0
				);
				// Non-damaging moves: no lunge / slash / damage badge.
				if (!numbered.length) {
					const statusHits = hits.filter(h => h.kind === 'status');
					if (statusHits.length) {
						let hi = 0;
						const playStatus = () => {
							if (hi >= statusHits.length) {
								i++;
								this.timer = window.setTimeout(step, BEAT_MS);
								return;
							}
							const h = statusHits[hi++];
							show({
								kind: 'status',
								iid: h.iid,
								src: h.src || (e.type === 'ability' ? 'ability' : 'attack'),
								extra: h.label || fx.extra,
							});
							this.timer = window.setTimeout(playStatus, HIT_MS);
						};
						playStatus();
						return;
					}
					i++;
					this.timer = window.setTimeout(step, BEAT_MS);
					return;
				}
				if (numbered.length > 1) {
					// Wind-up (lunge / ability) then each hit one-by-one.
					show({ ...fx, hits: [] });
					let hi = 0;
					const playHit = () => {
						if (hi >= hits.length) {
							i++;
							this.timer = window.setTimeout(step, BEAT_MS);
							return;
						}
						const h = hits[hi++];
						// Skip zero-amount damage/heal noise between real hits.
						if ((h.kind === 'damage' || h.kind === 'heal') && !(h.amount || 0)) {
							this.timer = window.setTimeout(playHit, 0);
							return;
						}
						const hitFx: FxBeat = h.kind === 'status' ? {
							kind: 'status',
							iid: h.iid,
							src: h.src || (e.type === 'ability' ? 'ability' : 'attack'),
							extra: h.label || fx.extra,
						} : {
							kind: h.kind,
							iid: h.iid,
							amount: h.amount,
							src: h.src || (e.type === 'ability' ? 'ability' : 'attack'),
							extra: h.label || fx.extra,
							element: h.element,
							hits: [h],
						};
						show(hitFx);
						this.timer = window.setTimeout(playHit, HIT_MS);
					};
					this.timer = window.setTimeout(playHit, WINDUP_MS);
					return;
				}
				fx.hits = hits.filter(h =>
					h.kind === 'status' || ((h.kind === 'damage' || h.kind === 'heal') && (h.amount || 0) > 0)
				);
			}

			show(fx, e);
			let wait = Math.max(fx.kind === 'drawEffect' ? 3200 : fxDuration(e), BEAT_MS);
			// Knockout should follow the hit, not sit through a pause that lets the card vanish.
			if (e.type === 'attack' || e.type === 'ability') {
				let koFollows = false;
				for (let j = i + 1; j < events.length; j++) {
					const n = events[j];
					if (!n) break;
					const t = String(n.type || '');
					if (t === 'damage' || t === 'heal' || t === 'status' || t === 'request' || t === 'act' || t === 'coin') {
						continue;
					}
					koFollows = t === 'ko';
					break;
				}
				if (koFollows) wait = HIT_MS + 400;
			}
			i++;
			this.timer = window.setTimeout(step, wait);
		};
		step();
	}

	openInspect = (inspect: Preview) => {
		this.setState({ inspect });
	};
	/** Finger stayed down long enough to preview; drop the in-progress drag so it is not a play. */
	onCardHold = () => {
		this.holdConsumed = true;
		this.dragMoved = true;
		if (this.state.drag) this.setState({ drag: null });
	};
	closeInspect = () => {
		if (this.state.inspect) this.setState({ inspect: null });
	};

	choose = (a: TcgAction) => {
		const prizeTakenLocal = a.type === 'takePrize' ?
			this.state.prizeTakenLocal + 1 :
			0;
		this.setState({
			selectedHand: null, energyPick: false, retreatPick: false, drag: null,
			menuSlot: null, endTurnConfirm: false, prizeTakenLocal,
		});
		this.props.onAct(a);
	};

	acts(): TcgAction[] {
		return this.props.snapshot.actions || [];
	}

	zoneActs(): TcgAction[] {
		return this.acts().filter(a => a.type === 'attachZone');
	}

	startHandDrag = (i: number, cardId: string, e: PointerEvent) => {
		if (e.button != null && e.button !== 0) return;
		const hits = this.acts().filter(a => actionTouchesHand(a, i));
		if (!hits.length) {
			this.clickHand(i);
			return;
		}
		e.preventDefault();
		this.dragMoved = false;
		this.holdConsumed = false;
		this.setState({
			selectedHand: null,
			energyPick: false,
			retreatPick: false,
			drag: {
				source: 'hand', hand: i, cardId,
				name: cardId, image: cardArt(cardId, { large: true }),
				x: e.clientX, y: e.clientY,
				originX: e.clientX, originY: e.clientY,
				active: false, over: null, hint: '',
			},
		});
		(e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
	};

	startZoneDrag = (e: PointerEvent) => {
		if (e.button != null && e.button !== 0) return;
		const hits = this.zoneActs();
		if (!hits.length) return;
		e.preventDefault();
		this.dragMoved = false;
		const zone = this.props.snapshot.players[this.props.snapshot.you ?? 0]?.energyZone;
		this.setState({
			selectedHand: null,
			energyPick: false,
			retreatPick: false,
			drag: {
				source: 'zone',
				cardId: zone?.type || 'energy',
				name: `${zone?.type || 'Energy'} Energy`,
				x: e.clientX, y: e.clientY,
				originX: e.clientX, originY: e.clientY,
				active: false, over: null, hint: 'Drag onto a Pokémon',
			},
		});
	};

	hitDrop(x: number, y: number): DropTarget | null {
		const el = document.elementFromPoint(x, y) as HTMLElement | null;
		if (!el) return null;
		const mon = el.closest('.tcg-mon') as HTMLElement | null;
		if (mon) {
			const slotRaw = mon.getAttribute('data-drop-slot');
			if (slotRaw == null) return null;
			const slot: TcgSlot = slotRaw === 'active' ? 'active' : Number(slotRaw);
			return {
				kind: 'slot',
				slot,
				foe: mon.getAttribute('data-drop-foe') === '1',
				empty: mon.getAttribute('data-drop-empty') === '1',
			};
		}
		if (el.closest('[data-drop="play"]')) return { kind: 'play' };
		if (el.closest('[data-drop="stadium"]')) return { kind: 'stadium' };
		if (el.closest('[data-drop="discard"]')) return { kind: 'discard' };
		return null;
	}

	onDragMove = (e: PointerEvent) => {
		const drag = this.state.drag;
		if (!drag) return;
		const dx = e.clientX - drag.originX;
		const dy = e.clientY - drag.originY;
		const active = drag.active || Math.hypot(dx, dy) > 8;
		if (active) {
			this.dragMoved = true;
			this.holdConsumed = false;
		}
		const over = active ? this.hitDrop(e.clientX, e.clientY) : null;
		let hint = drag.hint;
		if (active && over) {
			const hits = actionsForDrop(this.acts(), drag, over);
			hint = hits.length ? dropVerb(hits[0]) : '';
		} else if (active) {
			hint = drag.source === 'zone' ? 'Drop on a Pokémon' : 'Drop on a valid target';
		}
		if (
			active === drag.active &&
			e.clientX === drag.x && e.clientY === drag.y &&
			sameDrop(over, drag.over) && hint === drag.hint
		) return;
		this.setState({
			drag: { ...drag, x: e.clientX, y: e.clientY, active, over, hint },
		});
	};

	onDragEnd = (e: PointerEvent) => {
		const drag = this.state.drag;
		if (this.holdConsumed) {
			this.holdConsumed = false;
			if (drag) this.setState({ drag: null });
			return;
		}
		if (!drag) return;
		const over = drag.active ? this.hitDrop(e.clientX, e.clientY) : null;
		const hits = over ? actionsForDrop(this.acts(), drag, over) : [];
		if (drag.active && hits.length === 1) {
			this.choose(hits[0]);
			return;
		}
		if (drag.active && hits.length > 1) {
			// Prefer the most specific action; otherwise keep selection for click confirm.
			this.choose(hits[0]);
			return;
		}
		if (!drag.active && drag.source === 'hand' && drag.hand != null) {
			this.setState({ drag: null });
			this.clickHand(drag.hand);
			return;
		}
		if (!drag.active && drag.source === 'zone') {
			this.setState({ drag: null });
			this.clickEnergy();
			return;
		}
		this.setState({ drag: null, inspect: null });
	};

	clickHand = (i: number) => {
		const hits = this.acts().filter(a => actionTouchesHand(a, i));
		if (hits.length === 1 && !hasBoardTarget(hits[0])) {
			this.choose(hits[0]);
			return;
		}
		this.setState({
			selectedHand: this.state.selectedHand === i ? null : i,
			energyPick: false,
			retreatPick: false,
			menuSlot: null,
		});
	};

	menuActs(slot: TcgSlot): TcgAction[] {
		const acts = this.acts();
		if (slot === 'active') {
			return acts.filter(a =>
				a.type === 'attack' ||
				a.type === 'retreat' ||
				(a.type === 'ability' && (a.slot == null || a.slot === 'active' || sameSlot(a.slot, 'active')))
			);
		}
		return acts.filter(a =>
			(a.type === 'ability' && actionTouchesSlot(a, slot)) ||
			(a.type === 'promote' && typeof slot === 'number' && a.bench === slot)
		);
	}

	slotActionable(slot: TcgSlot, foe = false): boolean {
		if (foe) return this.slotLegal(slot, true);
		if (this.menuActs(slot).length) return true;
		return this.slotLegal(slot, false);
	}

	clickSlot = (slot: TcgSlot, foe = false) => {
		if (this.state.drag?.active) return;
		const acts = this.acts();
		const { selectedHand, energyPick, retreatPick, menuSlot } = this.state;
		if (selectedHand != null) {
			const me = this.props.snapshot.players[this.props.snapshot.you ?? 0];
			const opp = this.props.snapshot.players[this.props.snapshot.you === 0 ? 1 : 0];
			const side = foe ? opp : me;
			const empty = !(slot === 'active' ? side?.active : side?.bench?.[Number(slot)]);
			const drop: DropTarget = { kind: 'slot', slot, foe, empty };
			const hits = actionsForDrop(acts, { source: 'hand', hand: selectedHand }, drop);
			if (hits.length === 1) return this.choose(hits[0]);
			const legacy = acts.filter(a => actionTouchesHand(a, selectedHand) && actionTouchesSlot(a, slot));
			if (legacy.length === 1) return this.choose(legacy[0]);
		}
		if (!foe && energyPick) {
			const hits = this.zoneActs().filter(a => actionTouchesSlot(a, slot));
			if (hits.length === 1) return this.choose(hits[0]);
		}
		if (retreatPick) {
			const hits = acts.filter(a => a.type === 'retreat' && typeof slot === 'number' && a.bench === slot);
			if (hits.length === 1) return this.choose(hits[0]);
			return;
		}
		const promo = acts.filter(a => a.type === 'promote' && typeof slot === 'number' && a.bench === slot);
		if (promo.length === 1 && !this.menuActs(slot).some(a => a.type === 'ability')) {
			return this.choose(promo[0]);
		}
		const pick = acts.filter(a => a.type === 'pickSlot' && actionTouchesSlot(a, slot));
		if (pick.length === 1) return this.choose(pick[0]);
		if (foe) {
			const hits = acts.filter(a => actionTouchesSlot(a, slot) && (a.foeSlot != null || a.targetSlot != null));
			if (hits.length === 1) return this.choose(hits[0]);
			return;
		}
		// Live-style: tap your Pokémon to open its action menu.
		const menu = this.menuActs(slot);
		if (menu.length) {
			this.setState({
				menuSlot: menuSlot === slot ? null : slot,
				selectedHand: null,
				energyPick: false,
			});
			return;
		}
		this.setState({ menuSlot: null });
	};

	pickMenuAction = (a: TcgAction) => {
		if (a.type === 'retreat') {
			const retreats = this.acts().filter(x => x.type === 'retreat');
			if (retreats.length === 1) return this.choose(retreats[0]);
			this.setState({ retreatPick: true, menuSlot: null, selectedHand: null, energyPick: false });
			return;
		}
		this.choose(a);
	};

	clickEnergy = () => {
		const hits = this.zoneActs();
		if (!hits.length) return;
		if (hits.length === 1) {
			this.choose(hits[0]);
			return;
		}
		this.setState({ energyPick: true, selectedHand: null, retreatPick: false, menuSlot: null });
	};

	clickPlayZone = () => {
		const { selectedHand, drag } = this.state;
		if (drag?.active) return;
		if (selectedHand == null) return;
		const hits = actionsForDrop(this.acts(), { source: 'hand', hand: selectedHand }, { kind: 'play' });
		if (hits.length === 1) this.choose(hits[0]);
	};

	slotDropMeta(slot: TcgSlot, foe: boolean, empty: boolean): { dropOk: boolean, dropHot: boolean, dropLabel: string } {
		const drag = this.state.drag;
		if (!drag?.active) {
			return { dropOk: this.slotLegal(slot, foe), dropHot: false, dropLabel: '' };
		}
		const drop: DropTarget = { kind: 'slot', slot, foe, empty };
		const hits = actionsForDrop(this.acts(), drag, drop);
		const hot = sameDrop(drag.over, drop);
		return {
			dropOk: hits.length > 0,
			dropHot: hot && hits.length > 0,
			dropLabel: hits.length ? dropVerb(hits[0]) : '',
		};
	}

	slotLegal(slot: TcgSlot, foe = false): boolean {
		const acts = this.acts();
		const { selectedHand, energyPick, retreatPick, drag } = this.state;
		if (drag?.active) {
			const empty = true; // refined in slotDropMeta
			return canDropAnywhere(acts, drag, { kind: 'slot', slot, foe, empty }) ||
				canDropAnywhere(acts, drag, { kind: 'slot', slot, foe, empty: false });
		}
		if (selectedHand != null) {
			const forEmpty = actionsForDrop(acts, { source: 'hand', hand: selectedHand }, {
				kind: 'slot', slot, foe, empty: true,
			});
			const forOcc = actionsForDrop(acts, { source: 'hand', hand: selectedHand }, {
				kind: 'slot', slot, foe, empty: false,
			});
			if (forEmpty.length || forOcc.length) return true;
			return acts.some(a => actionTouchesHand(a, selectedHand) && actionTouchesSlot(a, slot));
		}
		if (!foe && (energyPick || !retreatPick) && this.zoneActs().some(a => actionTouchesSlot(a, slot))) {
			return true;
		}
		if (retreatPick) return typeof slot === 'number' && acts.some(a => a.type === 'retreat' && a.bench === slot);
		if (acts.some(a => a.type === 'promote' && typeof slot === 'number' && a.bench === slot)) return true;
		if (acts.some(a => a.type === 'pickSlot' && actionTouchesSlot(a, slot))) return true;
		if (foe) return acts.some(a => actionTouchesSlot(a, slot) && (a.foeSlot != null || a.targetSlot != null));
		return false;
	}

	clearSel = () => this.setState({ selectedHand: null, energyPick: false, retreatPick: false, drag: null, inspect: null, menuSlot: null, endTurnConfirm: false });

	override render() {
		const snap = this.props.snapshot;
		this.noteRemovals(snap);
		this.rememberMons(snap);
		this.rememberMons(this.props.fxSnapshot || snap);
		const meIndex = snap.you != null ? snap.you : 0;
		const foeIndex = meIndex === 0 ? 1 : 0;
		const me = snap.players[meIndex];
		const foe = snap.players[foeIndex];
		if (!me || !foe) {
			return <div class="tcg-table"><p class="tcg-waiting">Waiting for TCG snapshot…</p></div>;
		}
		const benchSize = snap.format?.benchSize || Math.max(me.bench.length, foe.bench.length, 3);
		const myHandAll = handIds(me.hand);
		// Cards whose play beat has already run leave the fan now, not when the batch commits.
		const spent = { ...this.liveOverlay().hand };
		const myHand = myHandAll && myHandAll
			.map((id, i) => ({ id, i }))
			.filter(c => {
				if (!spent[c.id]) return true;
				spent[c.id]--;
				return false;
			});
		const shuffleFx = this.state.fx?.kind === 'shuffleHand' ? this.state.fx : null;
		const shufflingMine = !!(shuffleFx && actorIsYou(shuffleFx.seat, snap.you));
		const shufflingFoe = !!(shuffleFx && !actorIsYou(shuffleFx.seat, snap.you));
		const shuffleHandIds = shufflingMine ? (shuffleFx?.ids || null) : null;
		const shuffleHandCount = shufflingMine ?
			Math.max(shuffleHandIds?.length || 0, shuffleFx?.n || 0, 3) :
			0;
		const allActs = this.acts();
		const yourTurn = !this.props.ended && !this.props.waiting && allActs.length > 0;
		const turnSeat = typeof snap.turn === 'number' ? snap.turn : null;
		const turnOwner = turnSeat != null ? snap.players[turnSeat] : null;
		// A spectator sits behind seat 0 for layout, but it is never "their" turn.
		const isMyTurnSeat = snap.you != null && turnSeat != null && turnSeat === meIndex;
		// After the game, a replay re-shows earlier snapshots: label those by turn, not "End".
		const replaying = !!this.props.ended && snap.status !== 'over';
		const turnWho = this.props.ended && !replaying ? '' :
			snap.status === 'setup' ? 'Setup phase' :
			isMyTurnSeat ? 'Your turn' :
			turnOwner ? `${turnOwner.name}'s turn` : '';
		const pocket = !!(me.energyZone || snap.format?.energyZone);
		const need = snap.format?.prizes || (pocket ? 3 : 6);
		const inspect = this.state.inspect;
		const inspectSrc = inspect ?
			(inspect.image ? inspect.image.replace('_SM.webp', '.webp') : cardArt(inspect.cardId, { large: true })) : '';

		const padBench = (list: TcgPokemonView[]) => {
			const out: (TcgPokemonView | null)[] = list.slice();
			while (out.length < benchSize) out.push(null);
			return out;
		};

		const endTurn = allActs.find(a => a.type === 'endTurn');
		const startBattle = allActs.find(a => a.type === 'setupDone');
		const confirms = allActs.filter(a => a.type === 'confirmYes' || a.type === 'confirmNo');
		const firsts = allActs.filter(a => a.type === 'chooseFirst');
		const searches = allActs.filter(a => a.type === 'searchPick' || a.type === 'searchDone');
		const discards = allActs.filter(a => a.type === 'discardPick');
		const pays = allActs.filter(a => a.type === 'payEnergy');
		const prizeActs = allActs.filter(a => a.type === 'takePrize');
		const prizeNeed = snap.pendingPrize?.n || 0;
		// Snapshot (and takePrize actions) lag until prize FX commits — hide as soon as enough picks are sent.
		const prizes = (prizeNeed > 0 && this.state.prizeTakenLocal >= prizeNeed) ? [] : prizeActs;
		const mulligans = allActs.filter(a => a.type === 'mulliganBench' || a.type === 'mulliganDone');
		const useStadium = allActs.find(a => a.type === 'useStadium');
		const selectedHand = this.state.selectedHand;
		const selectedHandActs = selectedHand != null ?
			allActs.filter(a => actionTouchesHand(a, selectedHand)) : [];
		const selectedHandNeedTarget = selectedHandActs.filter(a => hasBoardTarget(a));
		const orphanActs = allActs.filter(a => {
			if (['attack', 'ability', 'endTurn', 'setupDone', 'attachZone', 'retreat',
				'confirmYes', 'confirmNo', 'chooseFirst', 'searchPick', 'searchDone',
				'discardPick', 'payEnergy', 'takePrize', 'mulliganBench', 'mulliganDone',
				'useStadium', 'playBasic', 'setActive', 'setBench', 'evolve', 'attachEnergy',
				'attachTool', 'playTrainer', 'playStadium', 'promote', 'pickSlot',
				'playVunion'].includes(a.type)) return false;
			return true;
		});

		const drag = this.state.drag;
		const dragging = !!(drag && drag.active);
		const playDropHits = drag?.active ?
			actionsForDrop(allActs, drag, { kind: 'play' }) :
			(selectedHand != null ? actionsForDrop(allActs, { source: 'hand', hand: selectedHand }, { kind: 'play' }) : []);
		const stadiumDropHits = drag?.active ?
			actionsForDrop(allActs, drag, { kind: 'stadium' }) :
			(selectedHand != null ? actionsForDrop(allActs, { source: 'hand', hand: selectedHand }, { kind: 'stadium' }) : []);
		const discardDropHits = drag?.active ?
			actionsForDrop(allActs, drag, { kind: 'discard' }) :
			(selectedHand != null ? actionsForDrop(allActs, { source: 'hand', hand: selectedHand }, { kind: 'discard' }) : []);
		const playHot = dragging && drag!.over?.kind === 'play' && playDropHits.length > 0;
		const stadiumHot = dragging && drag!.over?.kind === 'stadium' && stadiumDropHits.length > 0;
		const discardHot = dragging && drag!.over?.kind === 'discard' && discardDropHits.length > 0;

		// No coaching once the game is over (replays re-show setup-phase snapshots).
		const hint = this.props.ended ? '' : (dragging && drag!.hint) ||
			snap.pendingConfirm?.text ||
			(this.state.energyPick ? 'Choose a Pokémon for Energy' : '') ||
			(this.state.retreatPick ? 'Choose a Benched Pokémon to switch in' : '') ||
			(this.state.menuSlot != null ? 'Choose an action' : '') ||
			(selectedHand != null && selectedHandNeedTarget.length ?
				`Drag or tap a Pokémon for ${describeAction(selectedHandNeedTarget[0], snap)}` : '') ||
			(selectedHand != null ? 'Drag onto a target or the play area' : '') ||
			(snap.pendingSearch ? 'Choose a card from the search' : '') ||
			(snap.pendingDiscard ? `Drag ${snap.pendingDiscard.need} card${snap.pendingDiscard.need === 1 ? '' : 's'} to Discard` : '') ||
			(snap.pendingRetreatPay ? `Discard ${snap.pendingRetreatPay.need} Energy to retreat` : '') ||
			(snap.pendingPromote != null ? 'Choose a Benched Pokémon to promote' : '') ||
			(prizes.length && snap.pendingPrize ?
				`Take ${Math.max(1, snap.pendingPrize.n - this.state.prizeTakenLocal)} Prize card${
					snap.pendingPrize.n - this.state.prizeTakenLocal === 1 ? '' : 's'
				}` :
				prizes.length ? 'Take a Prize card' : '') ||
			(discards.length ? 'Drag a card to Discard' : '') ||
			(snap.status === 'setup' ? 'Drag Basics to Active / Bench, then Ready' : '') ||
			(yourTurn ? 'Drag cards to play · Tap your Pokémon to attack' : '');

		// Only call it "waiting for opponent" when the opponent actually holds the
		// turn (or still has setup to finish); a server round-trip during our own
		// turn is not their fault and the banner would just flash on every click.
		const foeHoldsTurn = snap.status === 'setup' ?
			me.setup === 'done' && foe.setup !== 'done' :
			turnSeat != null && !isMyTurnSeat;
		const waitingOpp = !this.props.ended && snap.you != null && !allActs.length && foeHoldsTurn &&
			(this.props.waiting || !yourTurn);
		const st = this.state;
		let winName = (this.props.winnerName != null && this.props.winnerName !== '') ?
			this.props.winnerName :
			(snap.winner != null ? snap.players[snap.winner]?.name : null);
		if (st.fx?.kind === 'over') {
			if (st.fx.tie) winName = null;
			else {
				const fromFx = String(st.fx.extra || '').match(/^(.+?)\s+wins?\.?$/i)?.[1];
				if (fromFx && !/^draw$/i.test(fromFx)) winName = fromFx;
			}
		}
		// Same node from the ending beat through the result, so the fade-in does not replay.
		// Hidden while scrubbing/replaying an earlier turn so the board at that turn is readable.
		const showWinBanner = st.fx?.kind === 'over' || (!!this.props.ended && !st.fx && !replaying);

		const tableClass = [
			'tcg-table', pocket ? 'pocket' : 'live',
			yourTurn || isMyTurnSeat ? 'tcg-your-turn' : '',
			dragging ? 'is-dragging' : '',
			st.fx ? `kind-${st.fx.kind}` : '',
		].filter(Boolean).join(' ');
		const monFx = (mon: TcgPokemonView | null) => mon ? ({
			pkFx: st.pkFx[mon.iid] || null,
		}) : {};
		const foeActive = this.displayMon(foeIndex, 'active', foe.active);
		const meActive = this.displayMon(meIndex, 'active', me.active);

		const stadiumId = foe.stadium || me.stadium || '';
		const canAttach = allActs.some(a => a.type === 'attachZone');
		const zone = me.energyZone;

		return <div
			class={tableClass}
			ref={el => { this.tableEl = el as HTMLElement | null; }}
			onContextMenu={ev => ev.preventDefault()}
		>
			<div class="tcg-felt"></div>
			{waitingOpp && !(st.fx && (st.fx.kind === 'turn' || st.fx.kind === 'search' || st.fx.kind === 'mulligan')) &&
				<div class="tcg-wait-banner" aria-live="polite">
					<em>Waiting</em>
					<strong>for opponent</strong>
				</div>}
			{showWinBanner &&
				<div class={`tcg-win-banner${winName ? '' : ' tie'}`} aria-live="polite">
					{winName ?
						<><em>{winName}</em><strong>won</strong></> :
						<em>Draw</em>}
				</div>}
			{inspect && <div class="tcg-inspect" onClick={this.closeInspect} role="dialog" aria-label="Card inspection">
				<div class="tcg-inspect-card" onClick={ev => ev.stopPropagation()}>
					{inspectSrc ? <img src={inspectSrc} alt={inspect.name || inspect.cardId} /> : null}
					<button type="button" class="tcg-inspect-close" onClick={this.closeInspect}>Close</button>
					<p class="tcg-inspect-hint">Hold a card to preview · tap outside to close</p>
				</div>
			</div>}

			<header class="tcg-hud-top">
				<div class="tcg-player foe">
					<span class="tcg-avatar foe" aria-hidden="true">{(foe.name || '?').slice(0, 1).toUpperCase()}</span>
					<div class="tcg-player-meta">
						<span class="tcg-name">{foe.name}</span>
						<span class="tcg-hand-count" title={`${pileCount(foe.hand)} in hand`}>{pileCount(foe.hand)}</span>
					</div>
				</div>
				<div class={`tcg-turn-badge${yourTurn || isMyTurnSeat ? ' yours' : ''}${this.props.ended && !replaying ? ' over' : ''}${!isMyTurnSeat && turnSeat != null ? ' foe' : ''}`}>
					<span class="tcg-turn-num">
						{this.props.ended && !replaying ? 'End' : snap.status === 'setup' ? 'Setup' : `Turn ${snap.turnNumber || 1}`}
					</span>
					{turnWho && <span class="tcg-turn-who">{turnWho}</span>}
				</div>
				{/* Balances the grid so the turn badge stays centered; chrome (Timer) docks here. */}
				<div class="tcg-hud-tools" aria-hidden="true"></div>
			</header>

			<div class="tcg-dock-foe" title={`${pileCount(foe.hand)} in hand`}>
				<div class={`tcg-hand tcg-hand-foe${shufflingFoe ? ' is-shuffling' : ''}`}>
					{(shufflingFoe ?
						Array.from({ length: Math.max(shuffleFx?.n || pileCount(foe.hand), 3) }, (_, i) => i) :
						Array.from({ length: pileCount(foe.hand) }, (_, i) => i)
					).map(i => {
						const count = shufflingFoe ?
							Math.max(shuffleFx?.n || pileCount(foe.hand), 3) :
							Math.max(1, pileCount(foe.hand));
						return <TcgCardFace
							key={`fh${i}`} back size="sm"
							fanIndex={i} fanCount={count}
						/>;
					})}
				</div>
			</div>

			<div class={`tcg-arena${pocket ? ' is-pocket' : ' is-live'}`}>
				{/* Opponent half: bench (top) → Active (toward center); prizes left, deck right */}
				<section class="tcg-half foe">
					<div class="tcg-side left">
						{!pocket ?
							<TcgPrizeRail remaining={prizesLeft(foe, need, snap.status)} max={need} foe /> :
							<TcgPoints scored={scoredPoints(foe, need, snap.status)} need={need} pocket />}
					</div>
					<div class="tcg-field">
						<div class="tcg-zone tcg-bench foe">
							{padBench(foe.bench).map((mon, i) => {
								const shown = this.displayMon(foeIndex, i, mon);
								const ghost = !mon && !!shown;
								return <TcgMon
									key={`fb${i}`} mon={shown} slot={i} foe size="sm"
									reveal={!!shown && !!this.revealing[shown.iid]}
									legal={!ghost && this.slotActionable(i, true)}
									{...this.slotDropMeta(i, true, !mon)}
									{...monFx(shown)}
									onClick={ghost ? undefined : () => this.clickSlot(i, true)} onInspect={this.openInspect}
								/>;
							})}
						</div>
						<div class="tcg-zone tcg-active-spot foe">
							<TcgMon
								mon={foeActive} slot="active" activeSpot foe size="lg"
								reveal={!!foeActive && !!this.revealing[foeActive.iid]}
								legal={!foe.active && foeActive ? false : this.slotActionable('active', true)}
								{...this.slotDropMeta('active', true, !foe.active)}
								{...monFx(foeActive)}
								onClick={!foe.active && foeActive ? undefined : () => this.clickSlot('active', true)}
								onInspect={this.openInspect}
							/>
						</div>
					</div>
					<div class="tcg-side right">
						<div class={`tcg-pile deck foe`} title={`Opponent deck: ${pileCount(foe.deck)}`}>
							<div class="tcg-pile-stack">
								<span></span><span></span>
								<div class="tcg-card tcg-card-sm tcg-card-back">
									<span class="tcg-card-inner"><CardBackFace /></span>
								</div>
							</div>
							<strong class="tcg-pile-count">{pileCount(foe.deck)}</strong>
							<em class="tcg-pile-label">Deck</em>
						</div>
						<div class="tcg-pile discard foe" title="Opponent discard">
							<div class="tcg-pile-stack">
								<span></span><span></span>
								{foe.discard?.length ?
									<TcgCardFace
										cardId={foe.discard[foe.discard.length - 1]} size="sm" onInspect={this.openInspect}
									/> :
									<div class="tcg-card tcg-card-sm tcg-card-back">
										<span class="tcg-card-inner"><CardBackFace /></span>
									</div>}
							</div>
							<strong class="tcg-pile-count">{foe.discard?.length || 0}</strong>
							<em class="tcg-pile-label">Discard</em>
						</div>
					</div>
				</section>

				{/* Stadium — floats mid-board on the left (use side-right to flip) */}
				<div
					class={`tcg-stadium-row side-left${playDropHits.length || stadiumDropHits.length ? ' drop-ok' : ''}${playHot || stadiumHot ? ' drop-hot' : ''}`}
					data-drop="play"
					onClick={this.clickPlayZone}
				>
					<div
						class={`tcg-stadium${useStadium ? ' usable' : ''}${stadiumDropHits.length ? ' drop-ok' : ''}${stadiumHot ? ' drop-hot' : ''}`}
						data-drop="stadium"
					>
						{stadiumId ?
							<TcgCardFace
								cardId={stadiumId} name="Stadium" size="sm"
								onClick={useStadium ? () => this.choose(useStadium) : undefined}
								onInspect={this.openInspect}
							/> :
							<div class="tcg-stadium-empty"><span>Stadium</span></div>}
					</div>
					{(playHot || (!dragging && playDropHits.length > 0 && selectedHand != null)) &&
						<em class="tcg-drop-tag">{playHot || stadiumHot ? dropVerb((playDropHits[0] || stadiumDropHits[0])) : 'Play'}</em>}
				</div>

				{/* Your half: Active → bench; prizes/energy left, deck+discard right */}
				<section class="tcg-half me">
					<div class="tcg-side left">
						{!pocket ?
							<TcgPrizeRail
								remaining={prizesLeft(me, need, snap.status)} max={need}
								takeActs={prizes} onTake={a => this.choose(a)}
							/> :
							<>
								<TcgPoints scored={scoredPoints(me, need, snap.status)} need={need} pocket />
								{(zone || pocket) && <button
									type="button"
									class={`tcg-ezone ${canAttach ? 'ready' : 'off'} ${this.state.energyPick ? 'pick' : ''} ${drag?.source === 'zone' && dragging ? 'dragging' : ''}`}
									onPointerDown={canAttach ? (ev: any) => this.startZoneDrag(ev) : undefined}
									title={canAttach ? 'Drag onto a Pokémon to attach' : 'Energy Zone'}
								>
									<span
										class="tcg-ezone-now"
										style={{ background: TYPE_COLOR[zone?.type || 'colorless'] || '#888' }}
									></span>
									{zone?.next && <span
										class="tcg-ezone-next"
										style={{ background: TYPE_COLOR[zone.next] || '#888' }}
									></span>}
								</button>}
							</>}
					</div>
					<div class="tcg-field">
						<div class="tcg-zone tcg-active-spot me">
							<TcgMon
								mon={meActive} slot="active" activeSpot size="lg"
								reveal={!!meActive && !!this.revealing[meActive.iid]}
								legal={!me.active && meActive ? false : this.slotActionable('active')}
								{...this.slotDropMeta('active', false, !me.active)}
								{...monFx(meActive)}
								selected={this.state.menuSlot === 'active'}
								onClick={!me.active && meActive ? undefined : () => this.clickSlot('active')}
								onInspect={this.openInspect}
							/>
						</div>
						<div class="tcg-zone tcg-bench me">
							{padBench(me.bench).map((mon, i) => {
								const shown = this.displayMon(meIndex, i, mon);
								const ghost = !mon && !!shown;
								return <TcgMon
									key={`mb${i}`} mon={shown} slot={i} size="sm"
									reveal={!!shown && !!this.revealing[shown.iid]}
									legal={!ghost && this.slotActionable(i)}
									{...this.slotDropMeta(i, false, !mon)}
									{...monFx(shown)}
									selected={!ghost && this.state.menuSlot === i}
									onClick={ghost ? undefined : () => this.clickSlot(i)} onInspect={this.openInspect}
								/>;
							})}
						</div>
					</div>
					<div class="tcg-side right">
						<div class="tcg-pile deck me" title={`Deck: ${pileCount(me.deck)}`}>
							<div class="tcg-pile-stack">
								<span></span><span></span>
								<div class="tcg-card tcg-card-sm tcg-card-back">
									<span class="tcg-card-inner"><CardBackFace /></span>
								</div>
							</div>
							<strong class="tcg-pile-count">{pileCount(me.deck)}</strong>
							<em class="tcg-pile-label">Deck</em>
						</div>
						<div
							class={`tcg-pile discard me${discardDropHits.length ? ' drop-ok' : ''}${discardHot ? ' drop-hot' : ''}`}
							title="Discard"
							data-drop="discard"
						>
							<div class="tcg-pile-stack">
								<span></span><span></span>
								{me.discard?.length ?
									<TcgCardFace
										cardId={me.discard[me.discard.length - 1]} size="sm" onInspect={this.openInspect}
									/> :
									<div class="tcg-card tcg-card-sm tcg-card-back">
										<span class="tcg-card-inner"><CardBackFace /></span>
									</div>}
							</div>
							<strong class="tcg-pile-count">{me.discard?.length || 0}</strong>
							<em class="tcg-pile-label">Discard</em>
							{discardHot && <em class="tcg-drop-tag">Discard</em>}
						</div>
					</div>
				</section>
			</div>

			<div class="tcg-dock">
				<div class={`tcg-hand tcg-hand-mine${shufflingMine ? ' is-shuffling' : ''}`}>
				{shufflingMine ? (
					shuffleHandIds?.length ?
						shuffleHandIds.map((id, i) =>
							<TcgCardFace
								key={`sh-${id}-${i}`} cardId={id} size="md"
								pocket={pocket}
								fanIndex={i} fanCount={shuffleHandIds.length}
							/>
						) :
						Array.from({ length: shuffleHandCount }, (_, i) =>
							<TcgCardFace
								key={`shb${i}`} back size="md"
								fanIndex={i} fanCount={shuffleHandCount}
							/>
						)
				) : myHand ? myHand.map(({ id, i }, fan) => {
					const playable = allActs.some(a => actionTouchesHand(a, i));
					// Key by "nth copy of this card", not by index, so playing one card lets the
					// rest glide over instead of remounting every card to its right.
					let nth = 0;
					for (let j = 0; j < fan; j++) if (myHand[j].id === id) nth++;
					return <TcgCardFace
						key={`${id}#${nth}`} cardId={id} size="md"
						pocket={pocket}
						selected={this.state.selectedHand === i}
						playable={playable}
						dragging={drag?.source === 'hand' && drag.hand === i && dragging}
						fanIndex={fan} fanCount={myHand.length}
						onPointerDown={playable ? (ev: any) => this.startHandDrag(i, id, ev) : undefined}
						onHold={this.onCardHold}
						onInspect={this.openInspect}
					/>;
				}) : Array.from({ length: pileCount(me.hand) }, (_, i) =>
					<TcgCardFace key={i} back size="md" />
				)}
				</div>
			</div>

			{hint && <div class="tcg-float-hint">{hint}</div>}

			{this.props.ended && this.props.showReplayControls !== false && <div class="tcg-replay-controls">
				<button type="button" class="button" onClick={this.props.onTogglePause}>
					<i class={`fa fa-${this.props.paused ? 'play' : 'pause'}`} aria-hidden></i> {this.props.paused ? 'Play' : 'Pause'}
				</button>
				<button type="button" class="button" onClick={this.props.onReplay}>
					<i class="fa fa-undo" aria-hidden></i> Replay
				</button>
				<button type="button" class="button" onClick={this.props.onSkip}>
					<i class="fa fa-fast-forward" aria-hidden></i> Skip to end
				</button>
			</div>}
			<div class="tcg-live-controls">
				{(this.state.selectedHand != null || this.state.energyPick || this.state.retreatPick || this.state.menuSlot != null) &&
					<button type="button" class="tcg-cancel" onClick={this.clearSel}>Cancel</button>}
				{orphanActs.map((a, i) =>
					<button type="button" key={`o${i}`} class="tcg-atk quiet" onClick={() => this.choose(a)}>
						{describeAction(a, snap)}
					</button>
				)}
				{startBattle && <button type="button" class="tcg-start" onClick={() => this.choose(startBattle)}>
					Ready
				</button>}
				{endTurn && <button type="button" class="tcg-endturn" onClick={() => {
					const busy = allActs.some(a =>
						a.type === 'attack' || a.type === 'ability' || a.type === 'attachZone' ||
						a.type === 'playBasic' || a.type === 'playTrainer' || a.type === 'playStadium' ||
						a.type === 'evolve' || a.type === 'attachEnergy' || a.type === 'attachTool' ||
						a.type === 'retreat' || a.type === 'useStadium'
					);
					if (busy) this.setState({ endTurnConfirm: true, menuSlot: null });
					else this.choose(endTurn);
				}}>
					End<br />Turn
				</button>}
			</div>

			{this.state.menuSlot != null && (() => {
				const slot = this.state.menuSlot!;
				const menu = this.menuActs(slot);
				const mon = slot === 'active' ? me.active : me.bench[Number(slot)];
				return <div class="tcg-action-menu" onClick={this.clearSel}>
					<div class={`tcg-action-sheet ${slot === 'active' ? 'active' : 'bench'}`} onClick={ev => ev.stopPropagation()}>
						<header>
							<strong>{mon?.name || 'Pokémon'}</strong>
							<button type="button" class="tcg-cancel" onClick={this.clearSel}>✕</button>
						</header>
						<div class="tcg-action-list">
							{menu.map((a, i) => {
								if (a.type === 'attack') {
									const atk = me.active?.attacks?.[a.index];
									return <button type="button" key={i} class="tcg-atk" onClick={() => this.pickMenuAction(a)}>
										<span class="tcg-atk-cost">{(atk?.cost || []).map((t, j) => pip(t, j))}</span>
										<span class="tcg-atk-name">{atk?.name || `Attack ${(a.index ?? 0) + 1}`}</span>
										{atk?.damage && <span class="tcg-atk-dmg">{atk.damage}</span>}
									</button>;
								}
								if (a.type === 'ability') {
									return <button type="button" key={i} class="tcg-atk ability" onClick={() => this.pickMenuAction(a)}>
										<span class="tcg-atk-kind">Ability</span>
										<span class="tcg-atk-name">{describeAction(a, snap)}</span>
									</button>;
								}
								if (a.type === 'retreat') {
									return <button type="button" key={i} class="tcg-atk quiet" onClick={() => this.pickMenuAction(a)}>
										Retreat
									</button>;
								}
								return <button type="button" key={i} class="tcg-atk quiet" onClick={() => this.pickMenuAction(a)}>
									{describeAction(a, snap)}
								</button>;
							})}
						</div>
					</div>
				</div>;
			})()}

			{(() => {
				const searchPicks = searches.filter(a => a.type === 'searchPick');
				const searchDone = searches.find(a => a.type === 'searchDone');
				const mulliganPlaces = mulligans.filter(a => a.type === 'mulliganBench');
				const mulliganKeep = mulligans.find(a => a.type === 'mulliganDone');
				const yes = confirms.find(a => a.type === 'confirmYes');
				const no = confirms.find(a => a.type === 'confirmNo');
				const goFirst = firsts.find(a => a.goFirst);
				const goSecond = firsts.find(a => !a.goFirst);
				const kind =
					this.state.endTurnConfirm && endTurn ? 'endTurn' :
					confirms.length ? 'confirm' :
					firsts.length ? 'first' :
					searchPicks.length || searchDone ? 'search' :
					pays.length ? 'pay' :
					mulligans.length ? 'mulligan' :
					prizes.length ? 'prize' : '';
				if (!kind) return null;
				const head = promptHeading(snap, kind);
				return <div class={`tcg-prompt kind-${kind}`}>
					<div class="tcg-prompt-veil"></div>
					<div class="tcg-prompt-panel">
						<div class="tcg-prompt-banner">
							<strong>{head.title}</strong>
							{head.sub && <span>{head.sub}</span>}
						</div>

						{kind === 'confirm' && <div class="tcg-prompt-dialog">
							{snap.pendingConfirm?.text && <p>{snap.pendingConfirm.text}</p>}
							<div class="tcg-prompt-acts">
								{no && <button type="button" class="tcg-btn danger" onClick={() => this.choose(no)}>No</button>}
								{yes && <button type="button" class="tcg-btn primary" onClick={() => this.choose(yes)}>Yes</button>}
							</div>
						</div>}

						{kind === 'endTurn' && endTurn && <div class="tcg-prompt-dialog">
							<p>You still have actions available. End turn anyway?</p>
							<div class="tcg-prompt-acts">
								<button type="button" class="tcg-btn quiet" onClick={() => this.setState({ endTurnConfirm: false })}>Cancel</button>
								<button type="button" class="tcg-btn primary" onClick={() => this.choose(endTurn)}>End Turn</button>
							</div>
						</div>}

						{kind === 'first' && <div class="tcg-prompt-dialog">
							<div class="tcg-prompt-acts wide">
								{goFirst && <button type="button" class="tcg-btn primary" onClick={() => this.choose(goFirst)}>Go First</button>}
								{goSecond && <button type="button" class="tcg-btn quiet" onClick={() => this.choose(goSecond)}>Go Second</button>}
							</div>
						</div>}

						{kind === 'search' && <div class="tcg-prompt-select">
							<div class="tcg-prompt-rail">
								{searchPicks.map((a, i) =>
									<div key={`${a.pick}-${i}`} class="tcg-prompt-card">
										<TcgCardFace
											cardId={a.pick} size="md"
											onClick={() => this.choose(a)}
											onInspect={this.openInspect}
										/>
										<em>{cardLabel(a.pick)}</em>
									</div>
								)}
							</div>
							{searchDone && <button type="button" class="tcg-btn quiet" onClick={() => this.choose(searchDone)}>Done</button>}
						</div>}

						{kind === 'pay' && <div class="tcg-prompt-select">
							<p class="tcg-prompt-note">Select Energy attached to your Active Pokémon</p>
							<div class="tcg-prompt-energy">
								{pays.map((a, i) => {
									const t = me.active?.energy?.[a.index] || 'colorless';
									return <button
										type="button" key={i} class="tcg-prompt-orb"
										style={{ background: TYPE_COLOR[t] || '#888' }}
										title={t}
										onClick={() => this.choose(a)}
									></button>;
								})}
							</div>
						</div>}

						{kind === 'mulligan' && <div class="tcg-prompt-select">
							<div class="tcg-prompt-rail">
								{mulliganPlaces.map((a, i) =>
									<div key={i} class="tcg-prompt-card">
										<TcgCardFace
											cardId={Array.isArray(me.hand) ? me.hand[a.hand] : ''}
											size="md"
											onClick={() => this.choose(a)}
											onInspect={this.openInspect}
										/>
										<em>Bench</em>
									</div>
								)}
							</div>
							{mulliganKeep && <button type="button" class="tcg-btn primary" onClick={() => this.choose(mulliganKeep)}>Keep Hand</button>}
						</div>}

						{kind === 'prize' && <div class="tcg-prompt-dialog">
							<p>Click a face-down Prize on your prize row.</p>
							<div class="tcg-prompt-acts">
								{prizes.map((a, i) =>
									<button type="button" key={i} class="tcg-btn quiet" onClick={() => this.choose(a)}>
										Prize {Number(a.index) + 1}
									</button>
								)}
							</div>
						</div>}
					</div>
				</div>;
			})()}

			{dragging && drag && <div
				class="tcg-drag-ghost"
				style={{ left: `${drag.x}px`, top: `${drag.y}px` }}
			>
				{drag.source === 'zone' ?
					<span
						class="tcg-drag-orb"
						style={{ background: TYPE_COLOR[String(drag.cardId || 'colorless')] || '#888' }}
					></span> :
					(drag.cardId ?
						<img
							src={drag.image || cardArt(drag.cardId)}
							alt={drag.name || ''}
							draggable={false}
							onError={(ev: any) => {
								const img = ev?.currentTarget as HTMLImageElement | null;
								if (!img || !drag.cardId) return;
								const step = Number(img.dataset.fallback || '0');
								if (isPocketCardId(drag.cardId)) {
									if (step < 1) {
										img.dataset.fallback = '1';
										img.src = cardArt(drag.cardId, { pocket: true, large: true });
									}
									return;
								}
								if (step < 1) {
									img.dataset.fallback = '1';
									img.src = paperTcgIoArt(drag.cardId, true);
									return;
								}
								if (step < 2) {
									img.dataset.fallback = '2';
									img.src = scrydexArt(drag.cardId, true);
								}
							}}
						/> :
						<CardBackFace />)}
				{drag.hint && <em>{drag.hint}</em>}
			</div>}
			<FxOverlay
				key={st.fx ? `${st.fx.kind}-${st.fx.iid || ''}-${st.fx.amount || ''}-${Object.values(st.pkFx)[0]?.tick || 0}` : 'fx'}
				fx={st.fx} you={snap.you} names={snap.players.map(p => p?.name || '')}
			/>
		</div>;
	}
}
