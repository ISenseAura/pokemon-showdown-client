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
	src?: string, label?: string,
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
	tie?: boolean,
};
type PkFx = { cls: string, dataFx?: string, tick?: number };
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
	if (!iid || !players) return null;
	for (const p of players) {
		if (p.active?.iid === iid) return p.active;
		for (const m of p.bench || []) if (m?.iid === iid) return m;
	}
	return null;
}
function monName(players: TcgPlayerView[] | undefined, iid?: string): string {
	return findMonView(players, iid)?.name || 'a Pokémon';
}
function cardLabel(id?: string): string {
	return id || 'a card';
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
function attackHits(events: TcgEvent[], i: number): FxHit[] {
	const start = events[i];
	if (!start || (start.type !== 'attack' && start.type !== 'ability')) return [];
	const src = start.type === 'ability' ? 'ability' : 'attack';
	const label = start.name || (src === 'ability' ? 'Ability' : 'Attack');
	const hits: FxHit[] = [];
	for (let j = i + 1; j < events.length; j++) {
		const n = events[j];
		if (!n) break;
		const t = String(n.type || '');
		if (t === 'request' || t === 'act' || t === 'coin') continue;
		if (t === 'damage') hits.push({ iid: n.iid, amount: n.amount, kind: 'damage', src, label });
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
	if (t === 'ko') return 3200;
	if (t === 'over') return 4200;
	if (t === 'prize' || t === 'prizeTake') return 3000;
	if (t === 'points') return 2400;
	if (t === 'find') return 2600;
	if (t === 'draw') return 2400; // effect draws override wait in playFx
	if (t === 'deal') return 2400;
	if (t === 'shuffleHand') return 2000;
	if (t === 'trainer' || t === 'stadium') return 3200;
	if (t === 'stadiumEnd') return 2400;
	if (t === 'energy' || t === 'tool') return 2400;
	if (t === 'place') return 1600;
	if (t === 'evolve') return 2800;
	if (t === 'discard') return 2000;
	return 2000;
}
function placeTalk(e: TcgEvent, players?: TcgPlayerView[]): { tag: string, extra: string, text: string } {
	const name = findMonView(players, e.iid)?.name || cardLabel(e.cardId);
	const actor = whoName(players, e.seat);
	const bench = e.slot !== 'active' && e.slot != null && e.slot !== '';
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

/** English battle chat from events (graphics.md / Unreal-Bot chatLine). */
export function chatEntryForEvent(ev: TcgEvent, players?: TcgPlayerView[]): TcgChatEntry | null {
	const w = (seat: number) => whoName(players, seat);
	const poke = (iid?: string) => monName(players, iid);
	const nm = (id?: string) => cardLabel(id);
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
			return { kind: 'draw', label: 'Search', text: `${w(seat)} is searching their deck.`, seat };
		}
		if (ev.kind === 'mulligan') {
			const seat = (ev.waiting && ev.waiting[0]) ?? 0;
			return { kind: 'draw', label: 'Mulligan', text: `${w(seat)} took a mulligan.`, seat };
		}
		return null;
	case 'start':
		return ev.formatId ? { kind: 'setup', label: 'Start', text: `Format: ${ev.formatId}` } : null;
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
		return { kind: 'coin', label: 'Coin', text: ev.heads ? 'Heads.' : 'Tails.' };
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
	case 'energy':
		return {
			kind: 'energy', label: 'Energy',
			text: `${w(ev.seat)} attached ${nm(ev.cardId)} to ${poke(ev.iid)}.`, seat: ev.seat,
		};
	case 'tool':
		return {
			kind: 'energy', label: 'Tool',
			text: `${w(ev.seat)} attached ${nm(ev.cardId)} to ${poke(ev.iid)}.`, seat: ev.seat,
		};
	case 'stadium':
		return { kind: 'trainer', label: 'Stadium', text: `${w(ev.seat)} played ${nm(ev.cardId)}.`, seat: ev.seat };
	case 'stadiumEnd':
		return { kind: 'trainer', label: 'Stadium', text: `${nm(ev.cardId)} is no longer in play.` };
	case 'damage':
		return { kind: 'damage', label: 'Damage', text: `${poke(ev.iid)} took ${ev.amount} damage.` };
	case 'heal':
		return { kind: 'heal', label: 'Heal', text: `${poke(ev.iid)} healed ${ev.amount}.` };
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
		return {
			kind: 'draw', label: 'Draw',
			text: n === 1 ? `${w(ev.seat)} drew a card.` : `${w(ev.seat)} drew ${n} cards.`,
			seat: ev.seat,
		};
	}
	case 'find': {
		const ids = Array.isArray(ev.ids) ? ev.ids.filter(Boolean) : [];
		const text = ids.length === 1 ?
			`${w(ev.seat)} put ${nm(ids[0])} into their hand.` :
			ids.length > 1 ?
				`${w(ev.seat)} put ${ids.map(nm).join(', ')} into their hand.` :
				`${w(ev.seat)} put ${(ev.ids && ev.ids.length) || 1} card(s) into their hand.`;
		return { kind: 'draw', label: 'Search', text, seat: ev.seat };
	}
	case 'prize':
		return {
			kind: 'prize', label: 'Prize',
			text: `${w(ev.seat)} takes ${ev.n} Prize card${ev.n === 1 ? '' : 's'}.`, seat: ev.seat,
		};
	case 'prizeTake':
		return { kind: 'prize', label: 'Prize', text: `${w(ev.seat)} took a Prize card.`, seat: ev.seat };
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
): FxBeat {
	if (!e) return { kind: '' };
	const who = (seat?: number) => actorLabel(players, seat, you);
	const yours = (seat?: number) => actorIsYou(seat, you);
	if (e.type === 'request' && e.kind === 'search') {
		const seat = (e.waiting && e.waiting[0] != null) ? e.waiting[0] : 0;
		return {
			kind: 'search', seat, n: 5,
			extra: 'Searching their deck',
			message: yours(seat) ? 'You are searching your deck' : `${who(seat)} is searching their deck`,
		};
	}
	if (e.type === 'request' && e.kind === 'mulligan') {
		const seat = (e.waiting && e.waiting[0] != null) ? e.waiting[0] : 0;
		return {
			kind: 'mulligan', seat, n: 7,
			extra: 'Took a mulligan',
			message: yours(seat) ? 'You took a mulligan' : `${who(seat)} took a mulligan`,
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
		return {
			kind: 'place', iid: e.iid || '', seat: e.seat, extra: talk.extra, tag: talk.tag,
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
			message: `${monName(players, e.iid)} healed ${e.amount || 0}`,
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
	};
}

function pkClass(kind: string): string {
	if (kind === 'damage') return 'fx-hit';
	if (kind === 'attack') return 'fx-lunge';
	if (kind === 'heal') return 'fx-heal';
	if (kind === 'ko') return 'fx-ko';
	if (kind === 'place') return 'fx-place';
	if (kind === 'evolve') return 'fx-evolve';
	if (kind === 'energy' || kind === 'tool') return 'fx-energy';
	if (kind === 'status') return 'fx-status';
	if (kind === 'ability') return 'fx-ability';
	return 'fx-pulse';
}

function buildPkFx(fx: FxBeat, tick = 0): { [iid: string]: PkFx } {
	const out: { [iid: string]: PkFx } = {};
	const put = (iid: string | undefined, cls: string, dataFx?: string) => {
		if (!iid) return;
		out[iid] = { cls, dataFx, tick };
	};
	if (fx.iid) {
		let dataFx = '';
		if (fx.kind === 'damage' && fx.amount) dataFx = `-${fx.amount}`;
		if (fx.kind === 'heal' && fx.amount) dataFx = `+${fx.amount}`;
		if (fx.kind === 'energy') dataFx = '⚡';
		if (fx.kind === 'evolve') dataFx = '✨';
		if (fx.kind === 'ko') dataFx = 'KO';
		put(fx.iid, `${pkClass(fx.kind)}${fx.src ? ` src-${fx.src}` : ''}`, dataFx || undefined);
	}
	if (fx.targetIid && fx.targetIid !== fx.iid) put(fx.targetIid, 'fx-hit');
	for (const h of fx.hits || []) {
		if (!h?.iid) continue;
		const dataFx = h.kind === 'damage' && h.amount ? `-${h.amount}` :
			h.kind === 'heal' && h.amount ? `+${h.amount}` : undefined;
		const src = h.src || fx.src;
		const cls = `${h.kind === 'heal' ? 'fx-heal' : h.kind === 'status' ? 'fx-status' : 'fx-hit'}${src ? ` src-${src}` : ''}`;
		put(h.iid, cls, dataFx);
	}
	return out;
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

class FxOverlay extends preact.Component<{ fx: FxBeat | null, you?: number | null }> {
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
			const side = fx.extra === 'Heads' ? 'HEADS' : 'TAILS';
			return wrap('coin', <>
				{cap('COIN', side)}
				<div class={`fx-coin ${fx.extra === 'Heads' ? 'heads' : 'tails'}`}><b>{side}</b></div>
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
			const face = art || <span class="fx-mini-card face"></span>;
			return wrap('place', <>
				<div class={`fx-place-fly ${seat}`} data-target={fx.iid || ''}>{face}</div>
			</>);
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
			return wrap('turn', <>
				<div class={`fx-turn-banner${isYours ? ' yours' : ' foe'}`}>
					<em>{isYours ? 'Your Turn' : "Opponent's Turn"}</em>
					{turnNo ? <strong>Turn {turnNo}</strong> : null}
				</div>
			</>);
		}
		if (k === 'first') return wrap('first', cap('FIRST', fx.extra));
		if (k === 'over') {
			const raw = String(fx.extra || '');
			const nameMatch = raw.match(/^(.+?)\s+wins?\.?$/i);
			if (fx.tie || /^draw$/i.test(raw)) {
				return wrap('over', <div class="fx-turn-banner fx-win-banner tie">
					<em>Draw</em>
				</div>);
			}
			if (nameMatch) {
				return wrap('over', <div class="fx-turn-banner fx-win-banner win">
					<em>{nameMatch[1]}</em>
					<strong>won</strong>
				</div>);
			}
			return wrap('over', <div class="fx-turn-banner fx-win-banner">
				<em>{raw || 'Game Over'}</em>
			</div>);
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

function scoredPoints(p: TcgPlayerView, need: number): number {
	return Math.max(0, need - pileCount(p.prizes));
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
		const zone = ps?.zone === 'discard' ? 'from your discard' :
			ps?.zone === 'prize' ? 'from Prizes' : 'from your deck';
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
}> {
	inspect = (ev: MouseEvent) => {
		const { cardId, image, name, back, onInspect } = this.props;
		if (back || !cardId || !onInspect) return;
		ev.preventDefault();
		ev.stopPropagation();
		onInspect({ cardId, image, name });
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
			pocket, onClick, onPointerDown, onInspect,
		} = this.props;
		const src = image || (cardId ? cardArt(cardId, pocket ? { pocket: true } : undefined) : '');
		const cls = [
			'tcg-card', `tcg-card-${size || 'md'}`,
			selected ? 'tcg-card-selected' : '',
			back ? 'tcg-card-back' : '',
			onClick || onPointerDown ? 'tcg-card-click' : '',
			playable ? 'tcg-card-playable' : '',
			dragging ? 'tcg-card-dragging' : '',
			fanCount ? 'tcg-card-fan' : '',
		].filter(Boolean).join(' ');
		const mid = fanCount ? (fanCount - 1) / 2 : 0;
		const style = fanCount != null && fanIndex != null ? {
			'--fan': String(fanIndex - mid),
			zIndex: selected ? 30 : fanIndex + 1,
		} as any : undefined;
		return <button
			type="button" class={cls} style={style}
			onClick={onClick ? ev => { ev.stopPropagation(); onClick(); } : undefined}
			onPointerDown={onPointerDown ? ev => { ev.stopPropagation(); onPointerDown(ev as any); } : undefined}
			onContextMenu={onInspect ? this.inspect : undefined}
			title={name || cardId || ''} aria-pressed={selected}
		>
			<span class="tcg-card-inner">
				{back || !src ?
					<CardBackFace /> :
					<img src={src} alt={name || cardId || ''} draggable={false} onError={this.onImgError} />}
			</span>
		</button>;
	}
}

class TcgMon extends preact.Component<{
	mon: TcgPokemonView | null, slot: TcgSlot, size?: CardSize, selected?: boolean,
	activeSpot?: boolean, legal?: boolean, foe?: boolean, pkFx?: PkFx | null,
	dropOk?: boolean, dropHot?: boolean, dropLabel?: string,
	onClick?: () => void, onInspect?: (p: Preview) => void,
}> {
	baseEl: HTMLElement | null = null;

	override componentDidUpdate(prev: this['props']) {
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
		const cls = [
			'tcg-mon', activeSpot ? 'active' : '', foe ? 'foe' : '',
			selected ? 'selected' : '', legal ? 'legal' : '',
			dropOk ? 'drop-ok' : '', dropHot ? 'drop-hot' : '',
			pkFx?.cls || '',
		].filter(Boolean).join(' ');
		return <div
			ref={el => { this.baseEl = el as HTMLElement | null; }}
			class={cls} onClick={onClick} data-iid={mon.iid}
			data-fx={pkFx?.dataFx || undefined}
			data-fx-tick={pkFx?.tick != null ? String(pkFx.tick) : undefined}
			data-drop-slot={String(this.props.slot)}
			data-drop-foe={foe ? '1' : '0'}
			data-drop-empty="0"
			onContextMenu={onInspect && mon ? (ev: any) => {
				ev.preventDefault();
				onInspect({ cardId: mon.cardId, image: mon.image, name: mon.name });
			} : undefined}
		>
			<TcgCardFace
				cardId={mon.cardId} image={mon.image} name={mon.name} size={cardSize}
				onClick={onClick} onInspect={onInspect}
			/>
			<div class={`tcg-hp ${hpTone}`} title={`${mon.hp} / ${mon.maxHp || mon.hp} HP`}>
				<span class="tcg-hp-val">{mon.hp}</span>
				<span class="tcg-hp-track" aria-hidden="true">
					<span class="tcg-hp-fill" style={{ width: `${pct}%` }}></span>
				</span>
			</div>
			<div class="tcg-energy-row">
				{(mon.energy || []).map((t, i) => pip(t, i))}
			</div>
			{(mon.status || mon.poisoned || mon.burned) &&
				<div class="tcg-status">{mon.status}{mon.poisoned ? ' PSN' : ''}{mon.burned ? ' BRN' : ''}</div>}
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
	waiting: boolean,
	ended?: boolean,
	/** Winner display name; `null`/empty with ended = tie or unknown. */
	winnerName?: string | null,
	onAct: (action: TcgAction) => void,
}> {
	override state = {
		selectedHand: null as number | null,
		energyPick: false,
		retreatPick: false,
		fx: null as FxBeat | null,
		pkFx: {} as { [iid: string]: PkFx },
		/** Kept in the vacated slot while KO FX plays (snapshot already removed the mon). */
		koGhost: null as KoGhost | null,
		inspect: null as Preview | null,
		menuSlot: null as TcgSlot | null,
		endTurnConfirm: false,
		drag: null as DragState | null,
	};
	timer: number | null = null;
	tableEl: HTMLElement | null = null;
	dragMoved = false;
	/** Last-seen board mons by iid — survives snapshot removal so KO can animate. */
	monMemory: { [iid: string]: KoGhost } = {};
	/** Pre-draw hand per seat — snapshot already has the new hand when shuffle FX runs. */
	handMemory: { [seat: number]: { ids: string[] | null, count: number } } = {};

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
		const curr = handIds(this.props.snapshot.players[seat]?.hand);
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
	override componentDidUpdate(prev: this['props'], prevState: this['state']) {
		if (this.props.fxKey !== prev.fxKey) {
			this.stashHands(prev.snapshot);
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
		this.setState({ fx: null, pkFx: {}, koGhost: null });
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
		if (live) return live;
		const g = this.state.koGhost;
		if (!g || g.seat !== seat) return null;
		if (g.slot !== slot && String(g.slot) !== String(slot)) return null;
		return {
			iid: g.iid,
			cardId: g.cardId,
			name: g.name,
			image: g.image,
			hp: g.hp ?? 0,
			maxHp: g.maxHp ?? g.hp ?? 0,
		};
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
		if (this.timer != null) window.clearTimeout(this.timer);
		if (!events?.length || PS.prefs.noanim) {
			this.clearFx();
			return;
		}
		const players = this.props.snapshot.players;
		const you = this.props.snapshot.you;
		let i = 0;
		let fxTick = 0;
		const HIT_MS = 1000;
		const WINDUP_MS = 800;

		const show = (fx: FxBeat, e?: TcgEvent) => {
			fxTick++;
			let koGhost: KoGhost | null = null;
			if (fx.kind === 'ko') {
				koGhost = e ? this.ghostForKo(fx, e) : (fx.iid ? this.monMemory[fx.iid] || null : null);
				if (koGhost && !fx.extra) fx.extra = koGhost.name;
				if (koGhost && (!fx.message || fx.message.includes('a Pokémon'))) {
					fx.message = `${koGhost.name} was Knocked Out`;
				}
			}
			this.setState({ fx, pkFx: buildPkFx(fx, fxTick), koGhost });
		};

		const step = () => {
			while (i < events.length && skipEvent(events, i)) i++;
			if (i >= events.length) {
				this.clearFx();
				return;
			}
			const e = events[i];
			let fx = fxFor(e, events, i, players, you);

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
					const wait = fx.kind === 'drawEffect' ? 3200 : Math.max(fxDuration(e), 400);
					this.timer = window.setTimeout(step, wait);
				}, 2000);
				return;
			}

			if (e.type === 'attack' || e.type === 'ability') {
				const hits = attackHits(events, i);
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
								this.timer = window.setTimeout(step, 120);
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
					this.timer = window.setTimeout(step, 120);
					return;
				}
				if (numbered.length > 1) {
					// Wind-up (lunge / ability) then each hit one-by-one.
					show({ ...fx, hits: [] });
					let hi = 0;
					const playHit = () => {
						if (hi >= hits.length) {
							i++;
							this.timer = window.setTimeout(step, 180);
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
			const wait = fx.kind === 'drawEffect' ? 3200 : Math.max(fxDuration(e), 400);
			i++;
			this.timer = window.setTimeout(step, wait);
		};
		step();
	}

	openInspect = (inspect: Preview) => {
		this.setState({ inspect });
	};
	closeInspect = () => {
		if (this.state.inspect) this.setState({ inspect: null });
	};

	choose = (a: TcgAction) => {
		this.setState({ selectedHand: null, energyPick: false, retreatPick: false, drag: null, menuSlot: null, endTurnConfirm: false });
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
		if (active) this.dragMoved = true;
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
		this.rememberMons(snap);
		const meIndex = snap.you != null ? snap.you : 0;
		const foeIndex = meIndex === 0 ? 1 : 0;
		const me = snap.players[meIndex];
		const foe = snap.players[foeIndex];
		if (!me || !foe) {
			return <div class="tcg-table"><p class="tcg-waiting">Waiting for TCG snapshot…</p></div>;
		}
		const benchSize = snap.format?.benchSize || Math.max(me.bench.length, foe.bench.length, 3);
		const myHand = handIds(me.hand);
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
		const isMyTurnSeat = turnSeat != null && turnSeat === meIndex;
		const turnWho = this.props.ended ? '' :
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
		const prizes = allActs.filter(a => a.type === 'takePrize');
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

		const hint = (dragging && drag!.hint) ||
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
			(snap.pendingPrize ? `Take ${snap.pendingPrize.n} Prize card${snap.pendingPrize.n === 1 ? '' : 's'}` : '') ||
			(prizes.length ? 'Take a Prize card' : '') ||
			(discards.length ? 'Drag a card to Discard' : '') ||
			(snap.status === 'setup' ? 'Drag Basics to Active / Bench, then Ready' : '') ||
			(yourTurn ? 'Drag cards to play · Tap your Pokémon to attack' : '');

		const waitingOpp = !this.props.ended && (
			this.props.waiting ||
			(!yourTurn && !allActs.length) ||
			(turnSeat != null && !isMyTurnSeat && !allActs.length)
		);
		const st = this.state;
		const winName = (this.props.winnerName != null && this.props.winnerName !== '') ?
			this.props.winnerName :
			(snap.winner != null ? snap.players[snap.winner]?.name : null);
		const showWinBanner = !!this.props.ended && !(st.fx && st.fx.kind === 'over');

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

		return <div class={tableClass} ref={el => { this.tableEl = el as HTMLElement | null; }}>
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
					<p class="tcg-inspect-hint">Right-click any card to inspect · Esc / click outside to close</p>
				</div>
			</div>}

			<header class="tcg-hud-top">
				<div class="tcg-player foe">
					<span class="tcg-avatar foe" aria-hidden="true">{(foe.name || '?').slice(0, 1).toUpperCase()}</span>
					<div class="tcg-player-meta">
						<span class="tcg-name">{foe.name}</span>
					</div>
				</div>
				<div class={`tcg-turn-badge${yourTurn || isMyTurnSeat ? ' yours' : ''}${this.props.ended ? ' over' : ''}${!isMyTurnSeat && turnSeat != null ? ' foe' : ''}`}>
					<span class="tcg-turn-num">{this.props.ended ? 'End' : snap.status === 'setup' ? 'Setup' : `Turn ${snap.turnNumber || 1}`}</span>
					{turnWho && <span class="tcg-turn-who">{turnWho}</span>}
				</div>
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
							<TcgPrizeRail remaining={pileCount(foe.prizes)} max={need} foe /> :
							<TcgPoints scored={scoredPoints(foe, need)} need={need} pocket />}
					</div>
					<div class="tcg-field">
						<div class="tcg-zone tcg-bench foe">
							{padBench(foe.bench).map((mon, i) => {
								const shown = this.displayMon(foeIndex, i, mon);
								const ghost = !mon && !!shown;
								return <TcgMon
									key={`fb${i}`} mon={shown} slot={i} foe size="sm"
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
								remaining={pileCount(me.prizes)} max={need}
								takeActs={prizes} onTake={a => this.choose(a)}
							/> :
							<>
								<TcgPoints scored={scoredPoints(me, need)} need={need} pocket />
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
				) : myHand ? myHand.map((id, i) => {
					const playable = allActs.some(a => actionTouchesHand(a, i));
					return <TcgCardFace
						key={`${id}-${i}`} cardId={id} size="md"
						pocket={pocket}
						selected={this.state.selectedHand === i}
						playable={playable}
						dragging={drag?.source === 'hand' && drag.hand === i && dragging}
						fanIndex={i} fanCount={myHand.length}
						onPointerDown={playable ? (ev: any) => this.startHandDrag(i, id, ev) : undefined}
						onInspect={this.openInspect}
					/>;
				}) : Array.from({ length: pileCount(me.hand) }, (_, i) =>
					<TcgCardFace key={i} back size="md" />
				)}
				</div>
			</div>

			{hint && <div class="tcg-float-hint">{hint}</div>}

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
				{this.props.ended && <p class="tcg-waiting">
					{winName ? `${winName} won.` : (snap.winReason || 'Battle ended.')}
				</p>}
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
				fx={st.fx} you={snap.you}
			/>
		</div>;
	}
}
