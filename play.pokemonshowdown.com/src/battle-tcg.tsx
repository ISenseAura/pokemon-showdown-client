/**
 * Pokémon TCG board — Pocket / Live-style playmat for the Preact client.
 *
 * @license AGPLv3
 */

import preact from "../js/lib/preact";
import { PS } from "./client-main";
import { Net } from "./client-connection";
import { getTcgCard, loadTcgCardIndex } from "./battle-tcg-deck";

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
	energyCards?: string[];
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
	lostZone?: { count: number };
	stadium?: string | null;
	setup?: string;
	energyZone?: { type: string, next?: string, ready?: boolean };
	points?: number;
	attachedEnergyThisTurn?: boolean;
	playedSupporterThisTurn?: boolean;
	playedStadiumThisTurn?: boolean;
	retreatedThisTurn?: boolean;
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
	format?: { id?: string, benchSize?: number, energyZone?: boolean, prizes?: number, name?: string };
	pendingSearch?: { kind?: string, left?: number, upTo?: boolean, zone?: string, dest?: string };
	pendingDiscard?: { need: number };
	pendingRetreatPay?: { need: number };
	pendingConfirm?: { title?: string, text?: string };
	pendingPromote?: number;
	pendingFirst?: number;
	pendingPrize?: { seat: number, n: number };
}

function cloneTcgSnapshot(snap: TcgSnapshot): TcgSnapshot {
	return JSON.parse(JSON.stringify(snap)) as TcgSnapshot;
}

const ENERGY_NAME_MAP: { [k: string]: string } = {
	grass: 'grass', fire: 'fire', water: 'water', lightning: 'lightning', electric: 'lightning',
	psychic: 'psychic', fighting: 'fighting', darkness: 'darkness', dark: 'darkness',
	metal: 'metal', steel: 'metal', fairy: 'fairy', dragon: 'dragon', colorless: 'colorless',
};

function namedEnergyType(raw?: string): string {
	const k = String(raw || '').toLowerCase().replace(/[^a-z]/g, '');
	if (ENERGY_NAME_MAP[k]) return ENERGY_NAME_MAP[k];
	const stripped = k.replace(/^special/, '').replace(/^basic/, '').replace(/energy$/, '');
	return ENERGY_NAME_MAP[stripped] || '';
}

function energyTypeFromCardId(cardId?: string, types?: string[]): string {
	if (types) {
		for (const t of types) {
			const n = namedEnergyType(t);
			if (n && n !== 'colorless') return n;
		}
		const first = namedEnergyType(types[0]);
		if (first) return first;
	}
	if (!cardId) return 'colorless';
	const id = cardId.toLowerCase();
	const listed = /^(?:energy|zone-energy)-(grass|fire|water|lightning|psychic|fighting|darkness|metal|fairy|dragon|colorless)$/i.exec(id);
	if (listed) return listed[1].toLowerCase();
	const sve = /^sve-(\d+)$/.exec(id);
	if (sve) {
		const cycle = ['grass', 'fire', 'water', 'lightning', 'psychic', 'fighting', 'darkness', 'metal'];
		const n = Number(sve[1]);
		if (n >= 1 && n <= 16) return cycle[(n - 1) % 8];
	}
	const classic: { [k: string]: string } = {
		'base1-97': 'grass', 'base1-98': 'fire', 'base1-99': 'water',
		'base1-100': 'lightning', 'base1-101': 'psychic', 'base1-102': 'fighting',
	};
	if (classic[id]) return classic[id];
	const fromName = /(grass|fire|water|lightning|electric|psychic|fighting|darkness|metal|fairy|dragon|colorless)/i.exec(id);
	if (fromName) return namedEnergyType(fromName[1]) || 'colorless';
	return 'colorless';
}

function energyPipsFromEvent(e: TcgEvent): string[] {
	const listed = (e.types || (e.energyType ? [e.energyType] : [])) as string[];
	const fromTypes = listed.map(t => namedEnergyType(t) || energyTypeFromCardId(undefined, [t])).filter(Boolean);
	const useful = fromTypes.filter(t => t !== 'colorless');
	if (useful.length) return useful;
	if (fromTypes.length) return fromTypes;
	return [energyTypeFromCardId(e.cardId)];
}

function normalizeMonEnergy(mon: TcgPokemonView | null | undefined) {
	if (!mon) return;
	const cards = mon.energyCards || [];
	const pips = (mon.energy || []).map(t => namedEnergyType(t) || energyTypeFromCardId(undefined, [t]));
	if (cards.length && (!pips.length || pips.every(t => t === 'colorless'))) {
		mon.energy = cards.map(id => energyTypeFromCardId(id));
	} else if (pips.length) {
		mon.energy = pips;
	}
}

export function normalizeTcgEnergy(snap: TcgSnapshot | null | undefined) {
	if (!snap?.players) return snap;
	for (const p of snap.players) {
		if (!p) continue;
		normalizeMonEnergy(p.active);
		for (const mon of p.bench || []) normalizeMonEnergy(mon);
	}
	return snap;
}

function handAsIds(hand: TcgPlayerView['hand']): string[] | null {
	return Array.isArray(hand) ? hand.slice() : null;
}

/**
 * Pre-batch hand indexes stay clickable. Cards that arrived during this batch are shown
 * with i -1 so a click cannot target a hand the server has not committed yet.
 */
function handFan(
	committed: string[] | null,
	viewHand: TcgPlayerView['hand'] | undefined
): { id: string, i: number, arrive: boolean }[] | null {
	const viewIds = handAsIds(viewHand ?? null);
	if (!committed) {
		return viewIds?.length ? viewIds.map(id => ({ id, i: -1, arrive: true })) : null;
	}
	if (!viewIds) return committed.map((id, i) => ({ id, i, arrive: false }));
	const pool = viewIds.slice();
	const kept: { id: string, i: number, arrive: boolean }[] = [];
	for (let i = 0; i < committed.length; i++) {
		const at = pool.indexOf(committed[i]);
		if (at < 0) continue;
		pool.splice(at, 1);
		kept.push({ id: committed[i], i, arrive: false });
	}
	const gained = pool.map(id => ({ id, i: -1, arrive: true }));
	const fan = kept.concat(gained);
	return fan.length ? fan : null;
}

function setHand(p: TcgPlayerView, hand: string[] | { count: number }) {
	p.hand = hand;
}

function removeHandIndex(p: TcgPlayerView, index: number) {
	const ids = handAsIds(p.hand);
	if (ids && index >= 0 && index < ids.length) {
		ids.splice(index, 1);
		setHand(p, ids);
		return;
	}
	if (!Array.isArray(p.hand) && p.hand && typeof p.hand.count === 'number' && p.hand.count > 0) {
		p.hand = { count: p.hand.count - 1 };
	}
}

function bumpPile(pile: { count: number } | undefined, delta: number): { count: number } {
	return { count: Math.max(0, (pile?.count || 0) + delta) };
}

function takeIds(list: string[] | undefined, ids: string[]): string[] {
	const left = (list || []).slice();
	for (const id of ids) {
		const at = left.indexOf(id);
		if (at >= 0) left.splice(at, 1);
	}
	return left;
}

function removeHandIds(p: TcgPlayerView, ids: string[]) {
	const hand = handAsIds(p.hand);
	if (hand) {
		setHand(p, takeIds(hand, ids));
		return;
	}
	if (p.hand && typeof p.hand.count === 'number') p.hand = bumpPile(p.hand, -ids.length);
}

function detachPlayedCards(mon: TcgPokemonView, ids: string[]) {
	if (mon.energyCards?.length) {
		mon.energyCards = takeIds(mon.energyCards, ids);
		mon.energy = mon.energyCards.map(id => energyTypeFromCardId(id));
	}
	if (mon.tools?.length) mon.tools = takeIds(mon.tools, ids);
}

function stubMon(e: TcgEvent): TcgPokemonView {
	const hp = e.hp != null ? Number(e.hp) : 0;
	return {
		iid: e.iid,
		cardId: e.cardId || '',
		name: e.name || e.cardId || 'Pokémon',
		hp,
		maxHp: e.maxHp != null ? Number(e.maxHp) : hp,
		energy: [],
		tools: [],
		faceDown: !!e.faceDown,
	};
}

function applyPlace(p: TcgPlayerView, slot: TcgSlot, mon: TcgPokemonView) {
	const fromBench = (p.bench || []).findIndex(m => m && m.iid === mon.iid);
	const oldActive = p.active && p.active.iid !== mon.iid ? p.active : null;
	dropMonByIid(p, mon.iid);
	if (slot === 'active') {
		p.active = mon;
		if (oldActive) {
			if (fromBench >= 0) p.bench.splice(fromBench, 0, oldActive);
			else p.bench.push(oldActive);
		}
		return;
	}
	const i = Number(slot);
	if (!Number.isFinite(i) || i < 0 || i >= p.bench.length) p.bench.push(mon);
	else p.bench.splice(i, 0, mon);
}

function dropMonByIid(p: TcgPlayerView, iid: string) {
	if (p.active?.iid === iid) p.active = null;
	const next: TcgPokemonView[] = [];
	for (const mon of p.bench || []) {
		if (mon && mon.iid !== iid) next.push(mon);
	}
	p.bench = next;
}

function payEnergyAt(p: TcgPlayerView, index: number) {
	if (!p.active?.energy || index < 0) return;
	const next: string[] = [];
	for (let j = 0; j < p.active.energy.length; j++) {
		if (j !== index) next.push(p.active.energy[j]);
	}
	p.active.energy = next;
}

function clearPending(snap: TcgSnapshot) {
	delete snap.pendingSearch;
	delete snap.pendingDiscard;
	delete snap.pendingRetreatPay;
	delete snap.pendingConfirm;
	delete snap.pendingPromote;
	delete snap.pendingFirst;
	delete snap.pendingPrize;
}

/**
 * Apply a TcgEvent batch onto a prior snapshot when the server omitted a full board.
 */
function laterCoversDiscard(events: TcgEvent[], index: number, ids: string[], iid?: string): boolean {
	const want: { [id: string]: 1 } = Object.create(null);
	for (const id of ids) if (id) want[id] = 1;
	const listed = !!ids.filter(Boolean).length;
	if (!listed && !iid) return false;
	for (let j = index + 1; j < events.length; j++) {
		const n = events[j];
		if (!n || n.type === 'request' || n.type === 'turn') break;
		if (n.type !== 'toDiscard') continue;
		if (iid && n.iid === iid) return true;
		const got = Array.isArray(n.ids) ? n.ids as string[] : [];
		if (got.some(id => want[id])) return true;
	}
	return false;
}

/** One event, with a fallback for replays recorded before toDiscard existed. */
function applyBatchEvent(snap: TcgSnapshot, events: TcgEvent[], index: number) {
	const e = events[index];
	if (!e) return;
	if (e.type === 'ko' && e.iid) {
		const found = findMonSlot(snap.players || [], e.iid);
		const cards = found ?
			[found.mon.cardId, ...(found.mon.energyCards || []), ...(found.mon.tools || [])].filter(Boolean) :
			[];
		const seat = e.seat as number;
		applyTcgEvent(snap, e);
		if (cards.length && !laterCoversDiscard(events, index, cards, e.iid)) {
			const p = snap.players[seat];
			if (p) {
				if (!p.discard) p.discard = [];
				for (const id of cards) p.discard.push(id);
			}
		}
		return;
	}
	if (e.type === 'trainer' && e.cardId && !laterCoversDiscard(events, index, [e.cardId])) {
		applyTcgEvent(snap, e);
		const p = snap.players[e.seat as number];
		if (p) {
			if (!p.discard) p.discard = [];
			p.discard.push(e.cardId);
		}
		return;
	}
	applyTcgEvent(snap, e);
}

export function applyTcgEvents(
	base: TcgSnapshot,
	events: TcgEvent[] | undefined,
	actions?: TcgAction[]
): TcgSnapshot {
	const snap = cloneTcgSnapshot(base);
	const list = events || [];
	for (let i = 0; i < list.length; i++) applyBatchEvent(snap, list, i);
	if (actions) snap.actions = actions;
	normalizeTcgEnergy(snap);
	return snap;
}

/** One event, in place. Callers clone first when they need to keep the previous board. */
export function applyTcgEvent(snap: TcgSnapshot, e: TcgEvent) {
	const players = snap.players || [];
	if (!e) return;
	if (e.type === 'damage' || e.type === 'heal') {
		if (e.iid != null && e.hp != null) {
			const found = findMonSlot(players, e.iid);
			if (found) {
				found.mon.hp = Number(e.hp);
				if (e.amount != null) {
					found.mon.lastDelta = e.type === 'damage' ? -Number(e.amount) : Number(e.amount);
				}
			}
		}
	} else if (e.type === 'status') {
		if (e.iid != null) {
			const found = findMonSlot(players, e.iid);
			if (found) {
				const s = e.status == null || e.status === '' ? null : String(e.status).toLowerCase();
				if (e.poisoned != null || e.burned != null) {
					found.mon.status = s;
					found.mon.poisoned = !!e.poisoned || s === 'poisoned';
					found.mon.burned = !!e.burned || s === 'burned';
				} else if (s === 'poisoned') {
					found.mon.poisoned = true;
				} else if (s === 'burned') {
					found.mon.burned = true;
				} else if (s == null) {
					found.mon.status = null;
					found.mon.poisoned = false;
					found.mon.burned = false;
				} else {
					found.mon.status = s;
				}
			}
		}
	} else if (e.type === 'energy') {
		if (e.iid) {
			const found = findMonSlot(players, e.iid);
			if (found) {
				if (e.cardId) {
					found.mon.energyCards = [...(found.mon.energyCards || []), e.cardId];
				}
				found.mon.energy = [...(found.mon.energy || []), ...energyPipsFromEvent(e)];
				if (players[found.seat]) players[found.seat].attachedEnergyThisTurn = true;
			}
		}
	} else if (e.type === 'tool') {
		if (e.iid) {
			const found = findMonSlot(players, e.iid);
			if (found) {
				found.mon.tools = [...(found.mon.tools || []), e.cardId || 'tool'];
			}
		}
	} else if (e.type === 'draw' || e.type === 'find') {
		const seat = e.seat as number;
		const p = players[seat];
		if (p) {
			const ids = e.ids as string[] | undefined;
			if (ids?.length) {
				const hand = handAsIds(p.hand) || [];
				setHand(p, hand.concat(ids));
			} else if (!Array.isArray(p.hand) && p.hand) {
				const n = e.type === 'draw' ? (Number(e.n) || 0) : Math.max(1, ids?.length || Number(e.n) || 1);
				if (n) p.hand = bumpPile(p.hand as { count: number }, n);
			}
			if (e.type === 'draw' && e.n) p.deck = bumpPile(p.deck, -(Number(e.n) || 0));
		}
	} else if (e.type === 'deal') {
		const counts = e.counts as [number, number] | undefined;
		for (let seat = 0; seat < 2; seat++) {
			const p = players[seat];
			if (!p) continue;
			const ids = (seat === 0 ? e.ids0 : e.ids1) as string[] | undefined;
			const n = ids ? ids.length : (counts?.[seat]) || 0;
			if (ids?.length) setHand(p, ids.slice());
			else p.hand = { count: n };
			if (n) p.deck = bumpPile(p.deck, -n);
		}
	} else if (e.type === 'prizeSet') {
		const counts = e.counts as [number, number] | undefined;
		for (let seat = 0; seat < 2; seat++) {
			const p = players[seat];
			if (!p) continue;
			const n = (counts?.[seat]) || 0;
			p.prizes = { count: n };
			if (n) p.deck = bumpPile(p.deck, -n);
		}
	} else if (e.type === 'energyZone') {
		const p = players[e.seat as number];
		if (p) {
			p.energyZone = {
				type: String(e.energyType || e.zone || 'grass'),
				next: e.next,
				ready: !!e.ready,
			};
		}
	} else if (e.type === 'place') {
		const p = players[e.seat as number];
		if (p) {
			const existing = findMonSlot(players, e.iid)?.mon;
			const hide = !existing && snap.status === 'setup' && (snap.you == null || e.seat !== snap.you);
			const mon = existing || (hide ?
				stubMon({ ...e, faceDown: true, name: 'Pokémon', cardId: '', hp: 0, maxHp: 0 }) :
				stubMon(e));
			if (existing) {
				if (e.hp != null) existing.hp = Number(e.hp);
				if (e.maxHp != null) existing.maxHp = Number(e.maxHp);
				if (e.name) existing.name = e.name;
			}
			applyPlace(p, placeSlotOf(e), mon);
			if (p.setup && p.setup !== 'done' && !p.active) p.setup = 'active';
			else if (p.setup === 'active') p.setup = 'bench';
		}
	} else if (e.type === 'evolve') {
		const found = findMonSlot(players, e.iid);
		if (found) {
			if (e.cardId && e.cardId !== found.mon.cardId) delete found.mon.image;
			found.mon.cardId = e.cardId || found.mon.cardId;
			if (e.name) found.mon.name = e.name;
			if (e.hp != null) found.mon.hp = Number(e.hp);
			if (e.maxHp != null) found.mon.maxHp = Number(e.maxHp);
		}
		if (e.fromHand && e.cardId) {
			const owner = players[e.seat as number];
			if (owner) removeHandIds(owner, [e.cardId]);
		}
	} else if (e.type === 'ko') {
		const p = players[e.seat as number];
		if (p && e.iid) dropMonByIid(p, e.iid);
	} else if (e.type === 'shuffle') {
		const p = players[e.seat as number];
		if (p) {
			if (e.from === 'hand') setHand(p, Array.isArray(p.hand) ? [] : { count: 0 });
			if (e.deck != null) p.deck = { count: Number(e.deck) };
		}
	} else if (e.type === 'toDiscard') {
		const p = players[e.seat as number];
		const ids = Array.isArray(e.ids) ? e.ids.filter(Boolean) as string[] : [];
		if (p && ids.length) {
			if (e.from === 'hand') removeHandIds(p, ids);
			if (e.from === 'deck') p.deck = bumpPile(p.deck, -ids.length);
			if (e.iid) {
				const found = findMonSlot(players, e.iid);
				if (found) detachPlayedCards(found.mon, ids);
			}
			if (!p.discard) p.discard = [];
			for (const id of ids) p.discard.push(id);
		}
	} else if (e.type === 'fromDiscard') {
		const p = players[e.seat as number];
		const ids = Array.isArray(e.ids) ? e.ids.filter(Boolean) as string[] : [];
		if (p && ids.length && Array.isArray(p.discard)) {
			for (const id of ids) {
				const at = p.discard.indexOf(id);
				if (at >= 0) p.discard.splice(at, 1);
			}
		}
	} else if (e.type === 'toLost') {
		const p = players[e.seat as number];
		if (p) p.lostZone = bumpPile(p.lostZone, Number(e.n) || 0);
	} else if (e.type === 'trainer') {
		const p = players[e.seat as number];
		if (p && e.cardId && cardKind(e.cardId).supporter) p.playedSupporterThisTurn = true;
	} else if (e.type === 'stadium') {
		const seat = e.seat as number;
		for (let s = 0; s < players.length; s++) {
			const p = players[s];
			if (!p) continue;
			p.stadium = s === seat ? (e.cardId || null) : null;
			if (s === seat) p.playedStadiumThisTurn = true;
		}
	} else if (e.type === 'stadiumEnd') {
		for (const p of players) {
			if (p) p.stadium = null;
		}
	} else if (e.type === 'prize') {
		snap.pendingPrize = { seat: e.seat as number, n: Number(e.n) || 1 };
	} else if (e.type === 'prizeTake') {
		const p = players[e.seat as number];
		if (p?.prizes) p.prizes = bumpPile(p.prizes, -1);
		if (p && e.ids?.length) {
			const hand = handAsIds(p.hand) || [];
			setHand(p, hand.concat(e.ids));
		} else if (p && !Array.isArray(p.hand) && p.hand) {
			p.hand = bumpPile(p.hand as { count: number }, 1);
		}
		if (snap.pendingPrize && snap.pendingPrize.seat === e.seat) {
			snap.pendingPrize = { ...snap.pendingPrize, n: Math.max(0, snap.pendingPrize.n - 1) };
			if (snap.pendingPrize.n <= 0) delete snap.pendingPrize;
		}
	} else if (e.type === 'points') {
		const p = players[e.seat as number];
		if (p && e.total != null) {
			p.points = Number(e.total);
			if (snap.format?.energyZone && snap.format.prizes != null) {
				p.prizes = { count: Math.max(0, Number(snap.format.prizes) - Number(e.total)) };
			}
		}
	} else if (e.type === 'turn') {
		if (e.seat != null) snap.turn = e.seat as number;
		if (e.number != null) snap.turnNumber = Number(e.number);
		if (snap.status === 'setup') snap.status = 'playing';
		for (const p of players) {
			if (!p) continue;
			p.setup = 'done';
			p.attachedEnergyThisTurn = false;
			p.playedSupporterThisTurn = false;
			p.playedStadiumThisTurn = false;
			p.retreatedThisTurn = false;
			if (p.active) p.active.faceDown = false;
			const bench = p.bench || [];
			for (const mon of bench) {
				if (mon) mon.faceDown = false;
			}
		}
	} else if (e.type === 'first') {
		if (e.chooses) snap.pendingFirst = e.seat as number;
		else delete snap.pendingFirst;
	} else if (e.type === 'act') {
		const seat = e.seat as number;
		const p = players[seat];
		const action = e.action as TcgAction | undefined;
		if (p && action) {
			const handTypes = [
				'setActive', 'setBench', 'playBasic', 'evolve', 'attachEnergy', 'attachTool',
				'playTrainer', 'playStadium', 'mulliganBench',
			];
			if (handTypes.includes(action.type) && typeof action.hand === 'number') {
				removeHandIndex(p, action.hand);
			}
			if (action.type === 'setupDone') p.setup = 'done';
			if (action.type === 'attachZone' && p.energyZone) {
				p.energyZone = { ...p.energyZone, ready: false };
				p.attachedEnergyThisTurn = true;
			}
			if (action.type === 'attachEnergy') p.attachedEnergyThisTurn = true;
			if (action.type === 'retreat') p.retreatedThisTurn = true;
			if (action.type === 'playStadium') p.playedStadiumThisTurn = true;
			if (action.type === 'payEnergy' && typeof action.index === 'number') {
				payEnergyAt(p, action.index);
			}
			if (action.type === 'discardPick' && typeof action.hand === 'number') {
				removeHandIndex(p, action.hand);
			}
		}
	} else if (e.type === 'request') {
		clearPending(snap);
		const kind = String(e.kind || '');
		const waiting = Array.isArray(e.waiting) ? e.waiting : [];
		const forYou = snap.you != null && waiting.some((seat: number) => seat === snap.you);
		if (forYou && kind === 'search') {
			snap.pendingSearch = {
				kind: e.searchKind, left: e.left, upTo: e.upTo, zone: e.zone, dest: e.dest,
			};
		} else if (forYou && kind === 'discard' && e.need != null) {
			snap.pendingDiscard = { need: Number(e.need) };
		} else if (forYou && kind === 'retreatPay' && e.need != null) {
			snap.pendingRetreatPay = { need: Number(e.need) };
		} else if (forYou && kind === 'confirm') {
			snap.pendingConfirm = { title: e.title, text: e.text };
		} else if (kind === 'promote' || kind === 'switch') {
			snap.pendingPromote = e.promote != null ? Number(e.promote) : (e.waiting?.[0] as number);
		} else if (kind === 'first') {
			snap.pendingFirst = e.waiting?.[0] as number;
		} else if (kind === 'prize') {
			snap.pendingPrize = {
				seat: e.prizeSeat != null ? Number(e.prizeSeat) : Number(e.waiting?.[0] || 0),
				n: Number(e.n) || 1,
			};
		}
		if (kind === 'over') snap.status = 'over';
		if (kind === 'setup') snap.status = 'setup';
		if (kind === 'turn' && snap.status === 'setup') snap.status = 'playing';
	} else if (e.type === 'over') {
		snap.status = 'over';
		if (e.winner !== undefined) snap.winner = e.winner;
		if (e.reason) snap.winReason = e.reason;
		clearPending(snap);
	}
}

type Preview = { cardId: string, image?: string, name?: string };

/** One replay-player FX beat (Unreal-Bot graphics.js fxFor + hits). */
type FxHit = {
	iid: string, amount?: number, kind: 'damage' | 'heal' | 'status',
	src?: string, label?: string, element?: string, status?: string,
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
	/** Special Condition being applied. Empty string means it just wore off. */
	status?: string,
	slot?: TcgSlot,
	fromBench?: boolean,
};
type PkFx = { cls: string, dataFx?: string, tick?: number, element?: string, status?: string };
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
	you?: number | null
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
	iid?: string
): { seat: number, slot: TcgSlot, mon: TcgPokemonView } | null {
	if (!iid || !players) return null;
	for (let seat = 0; seat < players.length; seat++) {
		const p = players[seat];
		if (!p) continue;
		if (p.active?.iid === iid) return { seat, slot: 'active', mon: p.active };
		const bench = p.bench || [];
		for (let i = 0; i < bench.length; i++) {
			if (bench[i]?.iid === iid) return { seat, slot: i, mon: bench[i] };
		}
	}
	return null;
}
function placeSlotOf(e: TcgEvent): TcgSlot {
	if (e.slot === 'active' || e.slot == null || e.slot === '') return 'active';
	const n = Number(e.slot);
	return Number.isFinite(n) ? n : 'active';
}
const seenMonNames: { [iid: string]: string } = Object.create(null);
const seenCardNames: { [id: string]: string } = Object.create(null);
export function noteTcgMons(players: TcgPlayerView[] | undefined) {
	if (!players) return;
	for (const p of players) {
		const mons = [p?.active, ...(p?.bench || [])];
		for (const mon of mons) {
			if (mon?.iid && mon.name) seenMonNames[mon.iid] = mon.name;
			if (mon?.cardId && mon.name && mon.name !== mon.cardId) seenCardNames[mon.cardId] = mon.name;
		}
	}
}
function monName(players: TcgPlayerView[] | undefined, iid?: string): string {
	return findMonView(players, iid)?.name || (iid && seenMonNames[iid]) || 'a Pokémon';
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
	if (printedNamesLoaded[file]) return;
	printedNamesLoaded[file] = true;
	Net(file).get().then(text => {
		const data = JSON.parse(text);
		if (data && typeof data === 'object') Object.assign(printedNames, data);
	}).catch(() => {});
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
		for (const p of players) {
			const mons = [p?.active, ...(p?.bench || [])];
			for (const mon of mons) {
				if (mon?.cardId === cardId && mon.name && mon.name !== cardId) return mon.name;
			}
		}
	}
	if (iid && seenMonNames[iid] && seenMonNames[iid] !== cardId) return seenMonNames[iid];
	if (cardId && seenCardNames[cardId]) return seenCardNames[cardId];
	return printedName(cardId);
}
/** Printed card name when the index knows it; falls back to the raw id so nothing is blank. */
function cardLabel(id?: string): string {
	if (!id) return 'a card';
	return seenCardNames[id] || printedName(id) || id;
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
/** Special Conditions as Showdown-style short badges (class = PS statbar colour). */
function statusBadges(mon: TcgPokemonView): { id: string, label: string, title: string }[] {
	const out: { id: string, label: string, title: string }[] = [];
	const main = String(mon.status || '').toLowerCase();
	if (main === 'asleep') out.push({ id: 'slp', label: 'SLP', title: 'Asleep' });
	else if (main === 'paralyzed') out.push({ id: 'par', label: 'PAR', title: 'Paralyzed' });
	else if (main === 'confused') out.push({ id: 'cnf', label: 'CNF', title: 'Confused' });
	else if (main === 'poisoned') out.push({ id: 'psn', label: 'PSN', title: 'Poisoned' });
	else if (main === 'burned') out.push({ id: 'brn', label: 'BRN', title: 'Burned' });
	else if (main) out.push({ id: 'other', label: main.slice(0, 3).toUpperCase(), title: statusWord(main) });
	if (mon.poisoned && main !== 'poisoned') out.push({ id: 'psn', label: 'PSN', title: 'Poisoned' });
	if (mon.burned && main !== 'burned') out.push({ id: 'brn', label: 'BRN', title: 'Burned' });
	return out;
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
		// A coin is its own beat. Damage and status after it are the flip's result.
		if (t === 'coin') return false;
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
		if (t === 'request' || t === 'act') continue;
		// Stop at the flip. Hits after it play once that coin beat finishes.
		if (t === 'coin') break;
		if (t === 'damage') hits.push({ iid: n.iid, amount: n.amount, kind: 'damage', src, label, element });
		else if (t === 'heal') hits.push({ iid: n.iid, amount: n.amount, kind: 'heal' });
		else if (t === 'status') hits.push({
			iid: n.iid, kind: 'status',
			status: n.status == null ? '' : String(n.status).toLowerCase(),
			label: n.status ? statusWord(String(n.status)) : 'Recovered',
		});
		else break;
	}
	return hits;
}
/** Indexes of the damage / heal / status events attackHits walks, in the same order. */
function attackHitIndexes(events: TcgEvent[], i: number): number[] {
	const out: number[] = [];
	for (let j = i + 1; j < events.length; j++) {
		const t = events[j]?.type;
		if (t === 'request' || t === 'act') continue;
		if (t === 'coin') break;
		if (t === 'damage' || t === 'heal' || t === 'status') out.push(j);
		else break;
	}
	return out;
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
	players?: TcgPlayerView[]
): { kind: string, name: string, cardId?: string } | null {
	const e = events[i];
	if (!e || e.type !== 'draw') return null;
	if (e.source?.kind && e.source.kind !== 'turn' && e.source.kind !== 'play' && e.source.kind !== 'checkup') {
		const name = e.source.name || (e.source.cardId ? cardLabel(e.source.cardId) : '');
		if (name) return { kind: e.source.kind, name, cardId: e.source.cardId };
	}
	for (let j = i - 1; j >= 0; j--) {
		const p = events[j];
		if (!p) return null;
		const t = String(p.type || '');
		if (t === 'request' || t === 'act' || t === 'coin') continue;
		if (t === 'draw') continue;
		if (t === 'damage' || t === 'heal' || t === 'status' || t === 'ko' || t === 'place') continue;
		if (t === 'shuffle' || t === 'toDiscard' || t === 'toLost' || t === 'fromDiscard') continue;
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
	if (e.type === 'request' && (e.kind === 'search' || e.kind === 'mulligan')) return 1600;
	if (e.type === 'act' && e.action?.type === 'searchDone') return 2000;
	if (e.type === 'act' && e.action?.type === 'discardPick') return 2000;
	const t = e.type;
	if (t === 'request' || t === 'act') return 0;
	if (t === 'checkup') return 1400;
	if (t === 'start') return 1400;
	if (t === 'turn') return 900;
	if (t === 'first') return 3200;
	if (t === 'coin') return 2700;
	if (t === 'attack' || t === 'ability') return 3000;
	if (t === 'damage' || t === 'heal') return 2600;
	if (t === 'ko') return 2800;
	if (t === 'over') return 4200;
	if (t === 'prize' || t === 'prizeTake') return 1200;
	if (t === 'points') return 2400;
	if (t === 'find' || t === 'reveal') return 2600;
	if (t === 'draw') return 2400; // effect draws override wait in playFx
	if (t === 'deal') return 2400;
	if (t === 'shuffleHand') return 2000;
	if (t === 'shuffle') return e.from === 'hand' ? 2000 : 700;
	if (t === 'toDiscard' || t === 'toLost') return 0;
	if (t === 'trainer' || t === 'stadium') return 3200;
	if (t === 'stadiumEnd') return 2400;
	if (t === 'energy' || t === 'tool') return 2400;
	if (t === 'place') return 2200;
	if (t === 'evolve') return 2800;
	if (t === 'discard') return 2000;
	return 2000;
}
/** Name of the card or condition that caused an event. Empty for the player's own play. */
function sourceName(src?: { kind?: string, name?: string, cardId?: string } | null): string {
	if (!src || !src.kind) return '';
	const kind = src.kind;
	if (kind === 'play' || kind === 'turn' || kind === 'search' || kind === 'promote' || kind === 'retreat' || kind === 'evolve') {
		return '';
	}
	if (src.name) return src.name;
	if (src.cardId) return cardLabel(src.cardId);
	if (kind === 'poison') return 'Poison';
	if (kind === 'burn') return 'Burn';
	if (kind === 'asleep') return 'Sleep';
	if (kind === 'paralyzed') return 'Paralysis';
	if (kind === 'confusion') return 'Confusion';
	if (kind === 'checkup') return 'Pokémon Checkup';
	if (kind === 'ko') return 'a Knock Out';
	return '';
}
function fromSource(e: { source?: { kind?: string, name?: string, cardId?: string } }): string {
	const name = sourceName(e.source);
	return name ? ` from ${name}` : '';
}
function bySource(e: { source?: { kind?: string, name?: string, cardId?: string } }): string {
	const name = sourceName(e.source);
	return name ? ` by ${name}` : '';
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
	const kind = e.source?.kind || '';
	const by = sourceName(e.source);
	if (kind === 'retreat') {
		return bench ?
			{ tag: 'BENCH', extra: name, text: `${name} retreated to the Bench.` } :
			{ tag: 'RETREAT', extra: name, text: `${name} retreated to the Active Spot.` };
	}
	if (kind === 'promote') {
		return { tag: 'ACTIVE', extra: name, text: `${name} was sent to the Active Spot.` };
	}
	if (by && (kind === 'attack' || kind === 'ability' || kind === 'trainer' || kind === 'stadium' || kind === 'tool')) {
		return bench ?
			{ tag: 'BENCH', extra: name, text: `${name} was switched to the Bench by ${by}.` } :
			{ tag: 'ACTIVE', extra: name, text: `${name} was switched to the Active Spot by ${by}.` };
	}
	if (bench) return { tag: 'BENCH', extra: name, text: `${actor} benched ${name}.` };
	return { tag: 'ACTIVE', extra: name, text: `${name} came into the Active Spot.` };
}
function dmgSrc(events: TcgEvent[], i: number, players?: TcgPlayerView[]): { key: string, label: string } {
	const e = events[i];
	if (!e || e.type !== 'damage') return { key: 'effect', label: 'Damage' };
	const named = sourceName(e.source);
	if (e.source?.kind && named) return { key: e.source.kind, label: named };
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
	const zone = snap?.you != null && seat === snap.you ? snap.pendingSearch?.zone : undefined;
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
			const seat = (ev.waiting?.[0]) ?? 0;
			const own = snap?.you != null && seat === snap.you;
			return {
				kind: 'draw', label: 'Search',
				text: own ?
					`You are searching ${searchZoneText(snap, seat, true)}.` :
					`${w(seat)} is searching ${searchZoneText(snap, seat, false)}.`,
				seat,
			};
		}
		if (ev.kind === 'mulligan') {
			const seat = (ev.waiting?.[0]) ?? 0;
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
	case 'coin': {
		const why = sourceName(ev.source);
		const face = ev.heads ? 'Heads.' : 'Tails.';
		return { kind: 'coin', label: 'Coin', text: why ? `${why}: ${face}` : `Coin flip: ${face}` };
	}
	case 'place': {
		const talk = placeTalk(ev, players);
		return {
			kind: 'switch',
			label: talk.tag === 'BENCH' ? 'Bench' : talk.tag === 'RETREAT' ? 'Retreat' : 'Active',
			text: talk.text,
			seat: ev.seat,
		};
	}
	case 'evolve': {
		const why = fromSource(ev);
		return {
			kind: 'evolve', label: 'Evolve',
			text: ev.fromCardId ?
				`${nm(ev.fromCardId)} evolved into ${nm(ev.cardId)}${why}.` :
				`Evolved into ${nm(ev.cardId)}${why}.`,
			seat: ev.seat,
		};
	}
	case 'attack':
		return { kind: 'attack', label: 'Attack', text: `${poke(ev.iid)} used ${ev.name}.` };
	case 'ability':
		return { kind: 'ability', label: 'Ability', text: `${poke(ev.iid)} used ${ev.name}.` };
	case 'trainer':
		return { kind: 'trainer', label: 'Play', text: `${w(ev.seat)} played ${nm(ev.cardId)}.`, seat: ev.seat };
	case 'energy': case 'tool': {
		const seat = ev.seat ?? findMonSlot(players, ev.iid)?.seat;
		const why = fromSource(ev);
		return {
			kind: 'energy', label: ev.type === 'tool' ? 'Tool' : 'Energy',
			text: `${w(seat)} attached ${nm(ev.cardId)} to ${poke(ev.iid)}${why}.`, seat,
		};
	}
	case 'stadium':
		return { kind: 'trainer', label: 'Stadium', text: `${w(ev.seat)} played ${nm(ev.cardId)}.`, seat: ev.seat };
	case 'stadiumEnd':
		return { kind: 'trainer', label: 'Stadium', text: `${nm(ev.cardId)} is no longer in play${fromSource(ev)}.` };
	case 'damage':
		return { kind: 'damage', label: 'Damage', text: `${poke(ev.iid)} took ${ev.amount} damage${fromSource(ev)}.` };
	case 'heal':
		return { kind: 'heal', label: 'Heal', text: `${poke(ev.iid)} healed ${ev.amount} damage${fromSource(ev)}.` };
	case 'status':
		return {
			kind: 'status', label: 'Status',
			text: ev.status ?
				`${poke(ev.iid)} is ${statusWord(ev.status)}${fromSource(ev)}.` :
				`${poke(ev.iid)} recovered from Special Conditions${fromSource(ev)}.`,
		};
	case 'ko':
		return { kind: 'ko', label: 'KO', text: `${poke(ev.iid)} was Knocked Out${bySource(ev)}.`, seat: ev.seat };
	case 'shuffle':
		return {
			kind: 'note', label: 'Shuffle',
			text: ev.from === 'hand' ?
				`${w(ev.seat)} shuffled their hand into the deck${fromSource(ev)}.` :
				`${w(ev.seat)} shuffled their deck${fromSource(ev)}.`,
			seat: ev.seat,
		};
	case 'toDiscard': {
		const ids = Array.isArray(ev.ids) ? ev.ids.filter(Boolean) : [];
		const named = ids.length ? ids.map(nm).join(', ') : '';
		return {
			kind: 'discard', label: 'Discard',
			text: named ? `${w(ev.seat)} discarded ${named}${fromSource(ev)}.` :
			`${w(ev.seat)} discarded ${ids.length || 1} card${(ids.length || 1) === 1 ? '' : 's'}${fromSource(ev)}.`,
			seat: ev.seat,
		};
	}
	case 'fromDiscard': {
		const ids = Array.isArray(ev.ids) ? ev.ids.filter(Boolean) : [];
		const named = ids.length ? ids.map(nm).join(', ') : '';
		return {
			kind: 'discard', label: 'Discard',
			text: named ? `${w(ev.seat)} took ${named} from the discard pile${fromSource(ev)}.` :
			`${w(ev.seat)} took a card from the discard pile${fromSource(ev)}.`,
			seat: ev.seat,
		};
	}
	case 'toLost':
		return {
			kind: 'note', label: 'Lost Zone',
			text: (ev.n || 1) === 1 ?
				`${w(ev.seat)} put a card in the Lost Zone${fromSource(ev)}.` :
				`${w(ev.seat)} put ${ev.n} cards in the Lost Zone${fromSource(ev)}.`,
			seat: ev.seat,
		};
	case 'draw': {
		const n = ev.n || 1;
		const ids = Array.isArray(ev.ids) ? ev.ids.filter(Boolean) : [];
		const named = ids.length && ids.length === n ? ids.map(nm).join(', ') : '';
		return {
			kind: 'draw', label: 'Draw',
			text: named ? `${w(ev.seat)} drew ${named}${fromSource(ev)}.` :
			n === 1 ? `${w(ev.seat)} drew a card${fromSource(ev)}.` : `${w(ev.seat)} drew ${n} cards${fromSource(ev)}.`,
			seat: ev.seat,
		};
	}
	case 'reveal': {
		const ids = Array.isArray(ev.ids) ? ev.ids.filter(Boolean) : [];
		const names = ids.map(nm).filter(Boolean);
		const list = names.length ? names.join(', ') : 'no cards';
		return {
			kind: 'note', label: 'Reveal',
			text: `${w(ev.seat)} revealed their hand${fromSource(ev)}: ${list}.`,
			seat: ev.seat,
		};
	}
	case 'find': {
		const ids = Array.isArray(ev.ids) ? ev.ids.filter(Boolean) : [];
		const why = fromSource(ev);
		const text = ids.length === 1 ?
			`${w(ev.seat)} put ${nm(ids[0])} into their hand${why}.` :
			ids.length > 1 ?
				`${w(ev.seat)} put ${ids.map(nm).join(', ')} into their hand${why}.` :
				((ev.ids?.length) || ev.n || 1) === 1 ?
					`${w(ev.seat)} put a card into their hand${why}.` :
					`${w(ev.seat)} put ${(ev.ids?.length) || ev.n} cards into their hand${why}.`;
		return { kind: 'draw', label: 'Search', text, seat: ev.seat };
	}
	case 'prize':
		return {
			kind: 'prize', label: 'Prize',
			text: `${w(ev.seat)} takes ${ev.n} Prize card${ev.n === 1 ? '' : 's'}${fromSource(ev)}.`, seat: ev.seat,
		};
	case 'prizeTake':
	{
		const ids = Array.isArray(ev.ids) ? ev.ids.filter(Boolean) : [];
		return {
			kind: 'prize', label: 'Prize',
			text: ids.length ? `${w(ev.seat)} took a Prize card${fromSource(ev)}: ${ids.map(nm).join(', ')}.` :
			`${w(ev.seat)} took a Prize card${fromSource(ev)}.`,
			seat: ev.seat,
		};
	}
	case 'points':
		return {
			kind: 'prize', label: 'Points',
			text: `${w(ev.seat)} scored ${ev.n} point${ev.n === 1 ? '' : 's'}${fromSource(ev)} (total ${ev.total}).`,
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
		`<span class="tcg-log-tag">${esc(entry.label)}</span> ` +
		`<span class="tcg-log-text">${esc(entry.text)}</span></div>`;
}

function fxFor(
	e: TcgEvent,
	events: TcgEvent[],
	i: number,
	players?: TcgPlayerView[],
	you?: number | null,
	snap?: TcgSnapshot | null
): FxBeat {
	if (!e) return { kind: '' };
	const who = (seat?: number) => actorLabel(players, seat, you);
	const yours = (seat?: number) => actorIsYou(seat, you);
	if (e.type === 'request' && e.kind === 'search') {
		const seat = (e.waiting?.[0] != null) ? e.waiting[0] : 0;
		const zone = searchZoneText(snap, seat, yours(seat));
		return {
			kind: 'search', seat, n: 5,
			extra: `Searching ${zone}`,
			message: yours(seat) ? `You are searching ${zone}` : `${who(seat)} is searching ${zone}`,
		};
	}
	if (e.type === 'request' && e.kind === 'mulligan') {
		// The waiting seat is the one who gets to bench extra Basics; the *other* seat mulliganed.
		const seat = (e.waiting?.[0] != null) ? e.waiting[0] : 0;
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
	if (e.type === 'reveal') {
		const ids = Array.isArray(e.ids) ? e.ids.filter(Boolean) as string[] : [];
		const names = ids.map(cardLabel);
		const found = names.length ? names.join(', ') : 'no cards';
		return {
			kind: 'reveal', seat: e.seat, n: ids.length,
			extra: names.length <= 3 ? found : `${names.length} cards`,
			cardId: ids[0] || '', ids, labels: names,
			message: `${who(e.seat)} revealed their hand: ${found}`,
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
			message: `${monName(players, e.iid)} took ${e.amount} damage${fromSource(e)}`,
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
	if (e.type === 'shuffle') {
		if (e.from === 'hand') {
			return {
				kind: 'shuffleHand', seat: e.seat, n: 5,
				extra: 'Shuffled hand into the deck',
				message: yours(e.seat) ?
					'You shuffled your hand into the deck' :
					`${who(e.seat)} shuffled their hand into the deck`,
			};
		}
		return {
			kind: 'shuffle', seat: e.seat,
			extra: 'Shuffled their deck',
			message: yours(e.seat) ? 'You shuffled your deck' : `${who(e.seat)} shuffled their deck`,
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
			kind: 'points', seat: e.seat, n, amount: e.total,
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
			message: (yours(e.seat) ?
				`You attached ${label} to ${mon?.name || 'a Pokémon'}` :
				`${who(e.seat)} attached ${label} to ${mon?.name || 'a Pokémon'}`) + fromSource(e),
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
			message: `${memName} was Knocked Out${bySource(e)}`,
		};
	}
	if (e.type === 'heal') {
		return {
			kind: 'heal', iid: e.iid || '', seat: e.seat, amount: e.amount,
			extra: e.amount ? `+${e.amount}` : 'Healed',
			message: `${monName(players, e.iid)} healed ${e.amount || 0} damage${fromSource(e)}`,
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
	if (e.type === 'toDiscard' || e.type === 'fromDiscard' || e.type === 'toLost') {
		const ids = Array.isArray(e.ids) ? e.ids.filter(Boolean) as string[] : [];
		const named = ids.length ? ids.map(cardLabel).join(', ') : '';
		const took = e.type === 'fromDiscard';
		return {
			kind: 'discard',
			seat: e.seat,
			extra: named || (took ? 'From the discard pile' : e.type === 'toLost' ? 'Lost Zone' : 'Discarded'),
			message: (took ?
				`${who(e.seat)} took ${named || 'a card'} from the discard pile` :
				e.type === 'toLost' ?
					`${who(e.seat)} put a card in the Lost Zone` :
					`${who(e.seat)} discarded ${named || 'a card'}`) + fromSource(e),
		};
	}
	return {
		kind: e.type,
		iid: e.iid || '',
		targetIid: e.targetIid || '',
		seat,
		amount: e.type === 'points' && e.total != null ? e.total : e.amount,
		n: e.n,
		extra: e.type === 'coin' ? (e.heads ? 'Heads' : 'Tails') :
		e.type === 'turn' ? `Turn ${e.number} · ${whoName(players, e.seat)}` :
		e.type === 'first' ? (e.chooses ?
			`${whoName(players, e.seat)} chooses who goes first` :
			`${whoName(players, e.seat)} goes first`) :
		e.type === 'status' ? (e.status ? statusWord(e.status) : 'Recovered') :
		e.type === 'stadiumEnd' ? 'No longer in play' :
		(e.name || e.status || e.reason || ''),
		message: e.type === 'coin' ? ((sourceName(e.source) ? `${sourceName(e.source)}: ` : '') + (e.heads ? 'Heads!' : 'Tails!')) :
		e.type === 'first' ? (e.chooses ?
			`${who(e.seat)} chooses who goes first` :
			`${who(e.seat)} goes first`) :
		e.type === 'status' ? (e.status ?
			`${monName(players, e.iid)} is ${statusWord(e.status)}${fromSource(e)}` :
			`${monName(players, e.iid)} recovered${fromSource(e)}`) :
		e.type === 'stadiumEnd' ? `${cardLabel(e.cardId)} is no longer in play${fromSource(e)}` :
		undefined,
		cardId: e.cardId || '',
		coins: e.type === 'coin' ? [!!e.heads] : undefined,
		status: e.type === 'status' ? (e.status == null ? '' : String(e.status).toLowerCase()) : undefined,
	};
}

function statusFxClass(status: string | null | undefined): string {
	const t = String(status || '').toLowerCase();
	if (t === 'poisoned') return 'fx-psn';
	if (t === 'burned') return 'fx-brn';
	if (t === 'asleep') return 'fx-slp';
	if (t === 'paralyzed') return 'fx-par';
	if (t === 'confused') return 'fx-cnf';
	return 'fx-cured';
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
	const put = (
		iid: string | undefined, cls: string, dataFx?: string, element?: string, status?: string
	) => {
		if (!iid) return;
		out[iid] = { cls, dataFx, tick, element, status };
	};
	if (fx.kind === 'status' && fx.iid) {
		put(fx.iid, `fx-status ${statusFxClass(fx.status)}`, undefined, undefined, fx.status ?? '');
	} else if (fx.iid) {
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
		const cls = h.kind === 'heal' ? 'fx-heal' :
			h.kind === 'status' ? `fx-status ${statusFxClass(h.status)}` : 'fx-hit';
		put(
			h.iid,
			`${cls}${src ? ` src-${src}` : ''}`,
			dataFx,
			h.kind === 'damage' ? (h.element || fx.element) : undefined,
			h.kind === 'status' ? (h.status ?? '') : undefined
		);
	}
	return out;
}

/** On-card Special Condition. The badge pops in after this plays. */
function StatusBurst(props: { kind: string }) {
	const kind = props.kind || 'cured';
	const n = kind === 'asleep' ? 3 : kind === 'cured' ? 4 : 6;
	return <div class={`tcg-sfx sfx-${kind}`} aria-hidden="true">
		{Array.from({ length: n }, (_, i) => <i key={i} style={{ '--i': String(i) } as any} />)}
	</div>;
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

class FxOverlay extends preact.Component<{
	fx: FxBeat | null, you?: number | null, viewpoint?: 0 | 1, names?: string[],
}> {
	override render() {
		const fx = this.props.fx;
		if (!fx?.kind) return null;
		const layoutSeat = this.props.viewpoint != null ? this.props.viewpoint :
			(this.props.you != null ? this.props.you : 0);
		const seat = fx.seat === layoutSeat ? 'fx-p1' : 'fx-p2';
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
			const coins = (fx.coins?.length) ? fx.coins :
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
			const lifeMs = (forFirst ? 2700 : 2200) + Math.max(0, shown.length - 1) * 200;
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
			const ids = (fx.ids?.length) ? fx.ids : [];
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
									<MiniArt cardId={ids[i]} name={(fx.labels?.[i]) || ''} />
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
		if (k === 'shuffle') {
			return wrap('shuffle', cap('SHUFFLE', 'Deck'));
		}
		if (k === 'search') {
			// Your own search is a prompt; don't cover the picker with a board-wide status card.
			if (yours) return null;
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
		if (k === 'reveal' || k === 'find') {
			const ids = (fx.ids?.length) ? fx.ids : (fx.cardId ? [fx.cardId] : []);
			const faces = ids.length ? ids.map((id, i) => {
				const name = (fx.labels?.[i]) || '';
				return <span class="fx-found-card" key={i}>
					<span class="fx-mini-card face"><MiniArt cardId={id} name={name} /></span>
					{name ? <em>{name}</em> : null}
				</span>;
			}) : (k === 'reveal' ? null : <span class="fx-mini-card back"></span>);
			return wrap(k === 'reveal' ? 'reveal' : 'find', <>
				{k === 'reveal' ? cap('REVEAL', fx.extra || 'Hand') : null}
				<div class={`fx-found-row ${seat}`}>{faces}</div>
			</>);
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
			// The header badge already says whose turn this is.
			return null;
		}
		if (k === 'first') return wrap('first', cap('FIRST', fx.extra));
		if (k === 'over') {
			// The board banner is the one win message. Drawing it here too flashed "won" twice.
			return null;
		}
		if (k === 'points') return wrap('points', <div class="fx-points-burst">+{fx.n || 1}</div>);
		if (k === 'status') return wrap('status', cap('STATUS', fx.extra ? String(fx.extra) : 'Recovered'));
		if (k === 'checkup') return wrap('checkup', cap('CHECKUP', 'Pokémon Checkup'));
		if (k === 'discard') return wrap('discard', cap('DISCARD', fx.extra || 'Discard'));
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

/** Face-down card back shipped with this client (fx/ is tracked; sprites/ is not). */
export function cardBackArt(): string {
	return '/fx/tcg/cardback.webp';
}

const CARD_BACK_FALLBACK = '/fx/tcg/cardback.jpg';

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

type CardKind = {
	known: boolean,
	pokemon: boolean,
	trainer: boolean,
	energy: boolean,
	basic: boolean,
	stage: boolean,
	supporter: boolean,
	item: boolean,
	stadium: boolean,
	tool: boolean,
};

function cardKind(id: string): CardKind {
	const c = id ? getTcgCard(id) : undefined;
	const subs = (c?.u || []).map(s => s.toLowerCase());
	const has = (name: string) => subs.includes(name);
	return {
		known: !!c,
		pokemon: c?.s === 'P',
		trainer: c?.s === 'T',
		energy: c?.s === 'E' || /energy/i.test(id) || /^sve-\d+$/i.test(id),
		basic: has('basic'),
		stage: subs.some(s => s.startsWith('stage')),
		supporter: has('supporter'),
		item: has('item'),
		stadium: has('stadium'),
		tool: has('pokémon tool') || has('pokemon tool') || has('tool'),
	};
}

type WhyCtx = {
	hand?: number,
	drop?: DropTarget | null,
	slot?: TcgSlot,
	foe?: boolean,
	zone?: boolean,
	source?: 'hand' | 'zone',
};

function handCardId(snap: TcgSnapshot, hand: number): string {
	const you = snap.you;
	if (you == null) return '';
	const handv = snap.players[you]?.hand;
	return Array.isArray(handv) ? (handv[hand] || '') : '';
}

function benchFull(p: TcgPlayerView | undefined, snap: TcgSnapshot): boolean {
	const size = snap.format?.benchSize || (snap.format?.energyZone ? 3 : 5);
	return (p?.bench || []).filter(Boolean).length >= size;
}

function firstPlayerTurn(snap: TcgSnapshot): boolean {
	return snap.status === 'playing' && snap.turnNumber === 1 && snap.turn === snap.you;
}

/** Why this attempt is illegal. Empty when the attempt is legal, or when nothing was attempted. */
function whyCant(snap: TcgSnapshot, ctx: WhyCtx, waiting?: boolean): string {
	const you = snap.you;
	if (you == null) return '';
	if (snap.status === 'gameover' || snap.winner != null) return 'The game is over.';
	if (waiting) return 'Wait for the animation to finish.';
	if (snap.pendingPrize && snap.pendingPrize.seat === you) return 'Take a Prize card first.';
	if (snap.pendingSearch) return 'Finish searching your deck first.';
	if (snap.pendingDiscard) return 'Choose a card to discard first.';
	if (snap.pendingRetreatPay) return 'Choose Energy to discard for the retreat.';
	if (snap.pendingConfirm) return 'Confirm this effect first.';
	if (snap.pendingPromote != null && snap.pendingPromote === you && ctx.slot == null) {
		return 'Choose a Pokémon to promote first.';
	}
	if (snap.pendingFirst === you) return 'Choose who goes first.';
	if (snap.status === 'playing' && snap.turn !== you) return "It's not your turn.";

	if (ctx.zone || ctx.source === 'zone') {
		if (ctx.drop) {
			if (actionsForDrop(snap.actions || [], { source: 'zone' }, ctx.drop).length) return '';
			return whyBadDrop(snap, { ...ctx, source: 'zone' });
		}
		if ((snap.actions || []).some(a => a.type === 'attachZone')) return 'Drop this Energy on one of your Pokémon.';
		return whyZone(snap);
	}
	if (ctx.hand != null) {
		const drag: DragSource = { source: 'hand', hand: ctx.hand };
		if (ctx.drop) {
			if (actionsForDrop(snap.actions || [], drag, ctx.drop).length) return '';
			return whyBadDrop(snap, { ...ctx, source: 'hand' });
		}
		const mine = (snap.actions || []).filter(a => a.hand === ctx.hand);
		if (!mine.length) return whyCard(snap, handCardId(snap, ctx.hand));
		return whereToPlay(mine);
	}
	if (ctx.slot != null) return whyMon(snap, ctx.slot);
	return '';
}

function whereToPlay(acts: TcgAction[]): string {
	const types: { [k: string]: true } = {};
	for (const a of acts) types[a.type] = true;
	if (types['attachEnergy'] || types['attachTool']) return 'Drop this on one of your Pokémon.';
	if (types['evolve']) return 'Drop this on the Pokémon it evolves from.';
	if (types['playBasic'] || types['setBench'] || types['setActive'] || types['mulliganBench']) {
		return 'Drop this on an empty spot on your side.';
	}
	if (types['playStadium']) return 'Drop this on the Stadium spot.';
	if (types['discardPick']) return 'Drop this on the discard pile.';
	if (types['playTrainer']) return 'Drop this on the play area.';
	return 'Drop this on a valid target.';
}

function whyZone(snap: TcgSnapshot): string {
	const me = snap.you != null ? snap.players[snap.you] : undefined;
	if (snap.status === 'setup') return "You can't attach Energy during setup.";
	if (firstPlayerTurn(snap) && snap.format?.energyZone) return "You can't attach Energy on your first turn.";
	if (me?.attachedEnergyThisTurn) return 'You already attached Energy this turn.';
	if (me?.energyZone && me.energyZone.ready === false) return 'You already attached Energy this turn.';
	return "You can't attach Energy right now.";
}

function whyCard(snap: TcgSnapshot, id: string): string {
	const me = snap.you != null ? snap.players[snap.you] : undefined;
	const k = cardKind(id);
	const pocket = !!snap.format?.energyZone;
	if (snap.status === 'setup') {
		if (!(k.pokemon && k.basic)) return 'During setup you can only play Basic Pokémon.';
		if (me?.active && benchFull(me, snap)) return 'Your Bench is full.';
		return "You can't play this Pokémon right now.";
	}
	if (k.supporter) {
		if (me?.playedSupporterThisTurn) return 'You already played a Supporter this turn.';
		if (firstPlayerTurn(snap)) return "You can't play a Supporter on your first turn.";
	}
	if (k.stadium && me?.playedStadiumThisTurn) return 'You already played a Stadium this turn.';
	if (k.energy) {
		if (me?.attachedEnergyThisTurn) return 'You already attached Energy this turn.';
		if (firstPlayerTurn(snap) && pocket) return "You can't attach Energy on your first turn.";
		return "You can't attach Energy right now.";
	}
	if (k.stage) {
		if (firstPlayerTurn(snap)) return "You can't evolve on your first turn.";
		return "This card can't evolve any of your Pokémon right now.";
	}
	if (k.pokemon && k.basic) {
		if (me?.active && benchFull(me, snap)) return 'Your Bench is full.';
		return "You can't play this Pokémon right now.";
	}
	if (k.tool) return "You can't attach this Tool right now.";
	return "You can't play this card right now.";
}

function whyBadDrop(snap: TcgSnapshot, ctx: WhyCtx): string {
	const drop = ctx.drop;
	if (!drop) return '';
	const fromZone = ctx.source === 'zone';
	const id = fromZone || ctx.hand == null ? '' : handCardId(snap, ctx.hand);
	const k = cardKind(id);
	const acts = (snap.actions || []).filter(a => fromZone ? a.type === 'attachZone' : a.hand === ctx.hand);
	if (!acts.length) return fromZone ? whyZone(snap) : whyCard(snap, id);
	if (drop.kind === 'discard') return "You're not discarding a card right now.";
	if (drop.kind === 'stadium') {
		return k.stadium ? "You can't play that Stadium right now." : 'Only Stadium cards go on the Stadium spot.';
	}
	if (drop.kind === 'play') {
		if (k.pokemon || fromZone) return fromZone ? 'Drop this Energy on one of your Pokémon.' : 'Drop this Pokémon on an empty spot on your side.';
		if (k.energy) return 'Drop this Energy on one of your Pokémon.';
		if (k.stadium) return 'Drop Stadium cards on the Stadium spot.';
		if (k.tool) return 'Drop this Tool on one of your Pokémon.';
		return "You can't play this card there.";
	}
	if (drop.foe) {
		if (k.energy || fromZone) return 'Energy attaches to your own Pokémon.';
		if (k.pokemon) return 'Play this on your side of the board.';
		if (k.tool) return 'Tools attach to your own Pokémon.';
		return "This card can't target that Pokémon.";
	}
	if (drop.empty) {
		if (k.energy || fromZone) return 'Drop Energy on a Pokémon, not an empty spot.';
		if (k.stage) return 'Drop this on the Pokémon it evolves from.';
		if (k.trainer || k.tool) return "This card doesn't play onto an empty spot.";
		if (drop.slot === 'active') return "This can't be your Active Pokémon.";
		return 'That Bench spot is not open for this card.';
	}
	if (k.energy || fromZone) {
		return acts.some(a => a.type === 'attachEnergy' || a.type === 'attachZone') ?
			"You can't attach Energy to that Pokémon." :
			(fromZone ? whyZone(snap) : whyCard(snap, id));
	}
	if (k.basic && !k.stage) return 'That spot is taken.';
	if (k.stage) return "This card can't evolve that Pokémon.";
	if (k.tool) return "You can't attach this Tool to that Pokémon.";
	if (k.stadium) return 'Drop Stadium cards on the Stadium spot.';
	if (k.trainer) return "This card can't target that Pokémon.";
	return "You can't play this card there.";
}

function whyMon(snap: TcgSnapshot, slot: TcgSlot): string {
	const me = snap.you != null ? snap.players[snap.you] : undefined;
	const mon = slot === 'active' ? me?.active : me?.bench?.[Number(slot)];
	if (!mon) return '';
	if (snap.status === 'setup') return 'Finish setting up your Pokémon first.';
	if (slot !== 'active') {
		if (snap.pendingPromote != null && snap.pendingPromote === snap.you) {
			return 'Choose a different Pokémon to promote.';
		}
		return "This Pokémon can't use an Ability right now.";
	}
	const st = String(mon.status || '').toLowerCase();
	if (st === 'asleep' || st === 'paralyzed') {
		return `This Pokémon is ${statusWord(st)} and can't attack or retreat.`;
	}
	if (firstPlayerTurn(snap)) return "You can't attack on your first turn.";
	if (me?.retreatedThisTurn) return "You already retreated, and this Pokémon can't attack right now.";
	if (!(mon.energy || []).length) return "This Pokémon doesn't have enough Energy to attack.";
	return "This Pokémon can't attack or retreat right now.";
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
	if (typeof p.points === 'number') return p.points;
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
		if (a.name) return a.name;
		const mon = a.slot === 'active' ? me?.active : me?.bench?.[Number(a.slot)];
		const ab = mon?.abilities?.[a.index];
		return ab?.name || `Ability ${slotName(a.slot)}`;
	}
	case 'retreat': return `Retreat → ${monAt(a.bench)}`;
	case 'payEnergy': return 'Discard Energy';
	case 'attack': {
		if (a.name) return a.name;
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
	back?: boolean, playable?: boolean, arrive?: boolean, fanIndex?: number, fanCount?: number,
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

		}
	};
	override render() {
		const {
			cardId, image, name, size, selected, back, playable, arrive, fanIndex, fanCount, dragging,
			pocket, onInspect,
		} = this.props;
		const src = image || (cardId ? cardArt(cardId, pocket ? { pocket: true } : undefined) : '');
		const cls = [
			'tcg-card', `tcg-card-${size || 'md'}`,
			selected ? 'tcg-card-selected' : '',
			back ? 'tcg-card-back' : '',
			this.props.onClick || this.props.onPointerDown || onInspect ? 'tcg-card-click' : '',
			playable ? 'tcg-card-playable' : '',
			arrive ? 'tcg-card-arrive' : '',
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
	onClick?: (ev?: MouseEvent) => void, onInspect?: (p: Preview) => void,
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
		this.props.onClick?.(ev);
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
			{statusBadges(mon).length > 0 &&
				<div class="tcg-status">
					{statusBadges(mon).map(b => <span key={b.id} class={b.id} title={b.title}>{b.label}</span>)}
				</div>}
			{pkFx?.status != null && <StatusBurst kind={pkFx.status} />}
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
	/** Seat drawn at the bottom. Spectators keep `snapshot.you === null`. */
	viewpoint?: 0 | 1,
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
		/** Pokémon that left Active for the Bench slot the switcher came from. */
		placeOut: null as { seat: number, slot: TcgSlot, mon: TcgPokemonView } | null,
		live: { hand: {}, hp: {}, energy: {}, prizes: {}, deck: {}, handN: {}, discardN: {}, points: {}, gained: {} } as {
			hand: { [cardId: string]: number },
			hp: { [iid: string]: number },
			energy: { [iid: string]: string[] },
			prizes: { [seat: number]: number },
			deck: { [seat: number]: number },
			handN: { [seat: number]: number },
			discardN: { [seat: number]: number },
			points: { [seat: number]: number },
			/** Card ids that entered your hand on a beat already playing (draw, prize, search). */
			gained: { [seat: number]: string[] },
		},
		/** fxKey the live overlay was built for; an overlay from an earlier batch is ignored. */
		liveKey: -1,
		inspect: null as Preview | null,
		menuSlot: null as TcgSlot | null,
		endTurnConfirm: false,
		/** Prize indexes already sent for the current prompt. */
		prizePicked: [] as number[],
		/** How many prizes this prompt asked for. The prompt closes once that many are sent. */
		prizeGoal: 0,
		/** Go First / Go Second was sent. Hide that prompt until the server drops the choice. */
		firstSent: false,
		drag: null as DragState | null,
		/** Why the play the player just tried is illegal, anchored at the pointer. */
		refuse: null as { text: string, x: number, y: number } | null,
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
		void loadTcgCardIndex();
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
			], { duration: 820, easing: 'cubic-bezier(.22,.72,.2,1)', fill: 'both' });
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
			if (this.state.prizePicked.length || this.state.prizeGoal || this.state.firstSent) {
				this.setState({ prizePicked: [], prizeGoal: 0, firstSent: false });
			}
		} else if (this.state.prizePicked.length || this.state.prizeGoal) {
			// Forget the picks only after this prompt's choices are gone.
			// Do not trim the count while the server still lists prizes — that
			// reopens the prompt before the last click has been acknowledged.
			const live = this.acts();
			let any = false;
			for (let j = 0; j < live.length; j++) {
				if (live[j].type === 'takePrize') {
					any = true;
					break;
				}
			}
			if (!any) this.setState({ prizePicked: [], prizeGoal: 0 });
		} else if (this.state.firstSent) {
			// The in-progress board falls back to the pre-click actions between beats.
			// Only the committed snapshot means the server has left this choice.
			const committed = this.props.snapshot.actions || [];
			let stillFirst = false;
			for (let j = 0; j < committed.length; j++) {
				if (committed[j].type === 'chooseFirst') {
					stillFirst = true;
					break;
				}
			}
			if (!stillFirst) this.setState({ firstSent: false });
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
		this.stopRefuseTimer();
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
		this.boardSnap = null;
		this.liveNow = { hand: {}, hp: {}, energy: {}, prizes: {}, deck: {}, handN: {}, discardN: {}, points: {}, gained: {} };
		this.setState({ fx: null, pkFx: {}, koGhost: null, koHide: {}, placeIn: null, placeOut: null, live: this.liveNow });
	}

	/**
	 * Synchronous copy of state.live. Each batch starts from an empty overlay: its
	 * snapshot already includes everything earlier batches animated, so carrying the
	 * old overlay over would subtract that damage (or remove that hand card) twice.
	 */
	liveNow: TcgBoard['state']['live'] = {
		hand: {}, hp: {}, energy: {}, prizes: {}, deck: {}, handN: {}, discardN: {}, points: {}, gained: {},
	};
	static readonly NO_LIVE: TcgBoard['state']['live'] = {
		hand: {}, hp: {}, energy: {}, prizes: {}, deck: {}, handN: {}, discardN: {}, points: {}, gained: {},
	};
	/**
	 * Snapshot after every event whose beat has started. The committed snapshot stays
	 * put until the batch ends, so piles, the hand, the turn badge, and the board
	 * read this instead of waiting for that commit.
	 */
	boardSnap: TcgSnapshot | null = null;
	/** Last index of `events` already applied onto boardSnap. Reset when the array changes. */
	foldedThrough = -1;
	foldedRequest = false;
	foldEvents(events: TcgEvent[], inclusiveIndex: number) {
		if (inclusiveIndex < 0) return;
		// First paint already is the post-batch board; folding the same events would double them.
		if (this.props.snapshot === this.props.fxSnapshot) return;
		if (!this.boardSnap) {
			this.boardSnap = cloneTcgSnapshot(this.props.snapshot);
			this.foldedThrough = -1;
		}
		const board = this.boardSnap;
		const from = this.foldedThrough + 1;
		if (inclusiveIndex < from) return;
		for (let k = from; k <= inclusiveIndex && k < events.length; k++) {
			applyBatchEvent(board, events, k);
			if (events[k].type === 'request' && this.props.fxSnapshot?.actions) {
				board.actions = this.props.fxSnapshot.actions;
				this.foldedRequest = true;
			}
		}
		normalizeTcgEnergy(board);
		this.foldedThrough = Math.min(inclusiveIndex, events.length - 1);
	}
	/** Fold a beat that is now playing into the live overlay (see state.live). */
	applyLive(_fx: FxBeat, _you: number | null | undefined) {
		// Pile counts, HP, and the hand come from boardSnap. A second overlay would add them twice.
		return TcgBoard.NO_LIVE;
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
		const displaced = this.state.placeOut;
		if (placed && placed.seat === seat && sameSlot(placed.slot, slot)) return placed.mon;
		if (displaced && displaced.seat === seat && sameSlot(displaced.slot, slot)) return displaced.mon;
		// Keep the real card through the KO. Swapping it for a copy made it vanish and pop back.
		if (live && this.state.koHide[live.iid]) return null;
		if (live && placed && live.iid === placed.mon.iid) return null;
		if (live && displaced && live.iid === displaced.mon.iid) return null;
		if (live) return live;
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
			const iid = fly.getAttribute('data-target') || '';
			const safe = iid.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
			const target = (iid && root.querySelector(`.tcg-mon[data-iid="${safe}"]`)) as HTMLElement | null ||
				root.querySelector(fallbackSel);
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
		const en = root.querySelector('.fx-en-fly');
		if (en) aim(en, '.tcg-mon.fx-energy', false);
		const place = root.querySelector('.fx-place-fly');
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
			this.runFx(next, false);
			return;
		}
		// Drop the in-progress board before commit paints the server snapshot.
		this.boardSnap = null;
		this.foldedThrough = -1;
		this.foldedRequest = false;
		this.fxBusy = false;
		const more = this.props.onFxDone?.() ?? false;
		if (!more) this.clearFx();
	}

	runFx(events: TcgEvent[], fresh = true) {
		if (this.timer != null) window.clearTimeout(this.timer);
		// New batch, new baseline: props.snapshot now already reflects the previous batch.
		// A continuation (events that arrived mid-beat) keeps the board those beats already built.
		if (fresh) {
			this.boardSnap = null;
			this.foldedRequest = false;
			this.liveNow = { hand: {}, hp: {}, energy: {}, prizes: {}, deck: {}, handN: {}, discardN: {}, points: {}, gained: {} };
		}
		this.foldedThrough = -1;
		const shown = this.props.fxSnapshot || this.props.snapshot;
		const players = shown.players;
		const you = shown.you;
		let i = 0;
		let fxTick = 0;
		const HIT_MS = 1600;
		const WINDUP_MS = 1200;
		const BEAT_MS = 1600;

		const show = (fx: FxBeat, e?: TcgEvent) => {
			if (e?.type === 'deal' && you != null) {
				const raw = (you === 0 ? e.ids0 : e.ids1) as string[] | undefined;
				const ids = Array.isArray(raw) ? raw.filter(Boolean) : [];
				if (ids.length) fx = { ...fx, ids, seat: you };
			} else if (e && Array.isArray(e.ids) && e.ids.length &&
				(e.type === 'draw' || e.type === 'find' || e.type === 'prizeTake')) {
				fx = { ...fx, ids: (e.ids as string[]).filter(Boolean), seat: fx.seat ?? (e.seat as number) };
			}
			fxTick++;
			let koGhost: KoGhost | null = null;
			let placeIn: TcgBoard['state']['placeIn'] = null;
			let placeOut: TcgBoard['state']['placeOut'] = null;
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
				if (fx.fromBench && fromOld) {
					const leaving = this.props.snapshot.players[seat]?.active;
					if (leaving && leaving.iid !== incoming?.iid) {
						placeOut = { seat, slot: fromOld.slot, mon: leaving };
					}
				}
			}
			this.setState({
				fx, pkFx: buildPkFx(fx, fxTick), koGhost, koHide, placeIn, placeOut,
				live: this.applyLive(fx, you), liveKey: this.props.fxKey,
			});
		};

		const step = () => {
			while (i < events.length && skipEvent(events, i)) {
				this.props.onEvent?.(events[i]);
				// Damage and heal after an attack land in playHit, when the hit connects.
				const skipped = events[i].type;
				if (skipped !== 'damage' && skipped !== 'heal' && skipped !== 'status') {
					this.foldEvents(events, i);
				}
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
				if ((!fx.ids?.length) && actorIsYou(e.seat, you) && e.seat != null) {
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
				this.foldEvents(events, i - 1);
				show(shuffleFx);
				this.timer = window.setTimeout(() => {
					// Keep pre-draw hand memory until after this beat so inferDrawnIds still works
					// if ids were stripped — then refresh for later FX.
					this.foldEvents(events, i);
					show(fx, e);
					this.stashHands(this.props.snapshot);
					i++;
					let wait = Math.max(fx.kind === 'drawEffect' ? 3200 : fxDuration(e), BEAT_MS);
					if (e.type === 'request' && (e.kind === 'search' || e.kind === 'mulligan') &&
						actorIsYou((e.waiting?.[0]), you)) wait = 80;
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
				this.foldEvents(events, j - 1);
				show(coinFx);
				// Flip (~1.55s) + stagger + hold; linger a bit longer for the first-player announce.
				const wait = (firstEv ? 2700 : 2200) + Math.max(0, results.length - 1) * 200;
				i = j;
				this.timer = window.setTimeout(step, wait);
				return;
			}

			// The hand is about to be cleared. Keep the cards on this beat so the shuffle can show them.
			if (e.type === 'shuffle' && e.from === 'hand' && e.seat != null) {
				const mem = this.handMemory[e.seat];
				fx = {
					...fx,
					ids: mem?.ids || undefined,
					n: Math.max(mem?.count || 0, fx.n || 0, 3),
				};
			}

			// Pile changes ride along with an attack. A discard before a place (setup,
			// playing a Pokémon) is its own beat so the log lines stay separate.
			const pileMove = (t?: string) => t === 'toDiscard' || t === 'toLost' || t === 'fromDiscard';
			if (pileMove(e.type)) {
				let j = i + 1;
				while (j < events.length && pileMove(events[j]?.type)) {
					this.props.onEvent?.(events[j]);
					j++;
				}
				this.foldEvents(events, j - 1);
				const nxt = events[j];
				const ownBeat = nxt?.type === 'place' || nxt?.type === 'evolve';
				i = j;
				this.forceUpdate();
				if (ownBeat) {
					show(fx, e);
					this.timer = window.setTimeout(step, BEAT_MS);
				} else {
					this.timer = window.setTimeout(step, 0);
				}
				return;
			}

			this.foldEvents(events, i);
			let advance = 1;
			if (e.type !== 'attack' && e.type !== 'ability') {
				let j = i + 1;
				while (j < events.length && pileMove(events[j]?.type)) {
					this.props.onEvent?.(events[j]);
					j++;
				}
				if (j > i + 1) this.foldEvents(events, j - 1);
				advance = j - i;
			}
			// A switch is two places of Pokémon already in play. Setup Active + Bench are new cards.
			if (e.type === 'place') {
				const nxt = events[i + advance];
				const alreadyThere = nxt?.type === 'place' && nxt.seat === e.seat &&
					!!findMonSlot(this.boardSnap?.players, nxt.iid);
				if (alreadyThere) {
					this.props.onEvent?.(nxt);
					this.foldEvents(events, i + advance);
					advance += 1;
				}
			}

			if (e.type === 'attack' || e.type === 'ability') {
				const hits = attackHits(events, i, players);
				const hitAt = attackHitIndexes(events, i);
				if (!fx.extra) fx.extra = e.name || (e.type === 'ability' ? 'Ability' : 'Attack');
				if (!fx.message) fx.message = `${monName(players, e.iid)} used ${fx.extra || ''}`;

				const numbered = hits.filter(h =>
					(h.kind === 'damage' || h.kind === 'heal') && (h.amount || 0) > 0
				);
				// No damage before the next coin: the name still plays, then any status
				// that landed before the flip. The coin and its result stay in the queue.
				if (!numbered.length) {
					show({ ...fx, hits: [] });
					if (!hits.some(h => h.kind === 'status')) {
						i++;
						this.timer = window.setTimeout(step, BEAT_MS);
						return;
					}
					let hi = 0;
					const playStatus = () => {
						if (hi >= hits.length) {
							i++;
							this.timer = window.setTimeout(step, BEAT_MS);
							return;
						}
						const at = hitAt[hi];
						const h = hits[hi++];
						if (at != null) this.foldEvents(events, at);
						if (h.kind !== 'status') {
							this.timer = window.setTimeout(playStatus, 0);
							return;
						}
						show({
							kind: 'status',
							iid: h.iid,
							status: h.status ?? '',
							src: h.src || (e.type === 'ability' ? 'ability' : 'attack'),
							extra: h.label || statusWord(h.status) || 'Recovered',
						});
						this.timer = window.setTimeout(playStatus, HIT_MS);
					};
					this.timer = window.setTimeout(playStatus, WINDUP_MS);
					return;
				}
				// Wind-up, then each hit. HP is written when that hit connects, not on the lunge.
				show({ ...fx, hits: [] });
				let hi = 0;
				const playHit = () => {
					if (hi >= hits.length) {
						i++;
						this.timer = window.setTimeout(step, 400);
						return;
					}
					const at = hitAt[hi];
					const h = hits[hi++];
					if (at != null) this.foldEvents(events, at);
					if ((h.kind === 'damage' || h.kind === 'heal') && !(h.amount || 0)) {
						this.timer = window.setTimeout(playHit, 0);
						return;
					}
					const hitFx: FxBeat = h.kind === 'status' ? {
						kind: 'status',
						iid: h.iid,
						status: h.status ?? '',
						src: h.src || (e.type === 'ability' ? 'ability' : 'attack'),
						extra: h.label || statusWord(h.status) || 'Recovered',
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

			// A 0-damage result (a tails flip that missed) updates nothing visible.
			if ((e.type === 'damage' || e.type === 'heal') && !(Number(e.amount) || 0)) {
				i += advance;
				this.timer = window.setTimeout(step, 0);
				return;
			}

			show(fx, e);
			let wait = Math.max(fx.kind === 'drawEffect' ? 3200 : fxDuration(e), BEAT_MS);
			if (e.type === 'request' && (e.kind === 'search' || e.kind === 'mulligan') &&
				actorIsYou((e.waiting?.[0]), you)) wait = 80;
			if (e.type === 'shuffle' && e.from !== 'hand') wait = 700;
			i += advance;
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
		let prizePicked = this.state.prizePicked;
		let prizeGoal = this.state.prizeGoal;
		let firstSent = this.state.firstSent;
		if (a.type === 'chooseFirst') firstSent = true;
		if (a.type === 'takePrize') {
			const idx = Number(a.index);
			if (prizePicked.indexOf(idx) < 0) prizePicked = prizePicked.concat(idx);
			if (!prizeGoal) {
				const pending = (this.boardSnap || this.props.snapshot).pendingPrize;
				prizeGoal = pending?.n || prizePicked.length;
			}
		}
		this.stopRefuseTimer();
		this.setState({
			selectedHand: null, energyPick: false, retreatPick: false, drag: null,
			menuSlot: null, endTurnConfirm: false, prizePicked, prizeGoal, firstSent, refuse: null,
		});
		this.props.onAct(a);
	};

	refuseTimer: number | null = null;
	stopRefuseTimer() {
		if (this.refuseTimer != null) window.clearTimeout(this.refuseTimer);
		this.refuseTimer = null;
	}
	/** Leave the reason on screen after the pointer comes up. */
	showRefuse(text: string, x: number, y: number) {
		if (!text) return;
		this.stopRefuseTimer();
		this.setState({ refuse: { text, x, y } });
		this.refuseTimer = window.setTimeout(() => {
			this.refuseTimer = null;
			this.setState({ refuse: null });
		}, 2400);
	}

	acts(): TcgAction[] {
		// The request beat is when the new choices exist. Until then, keep the previous list.
		if (this.foldedRequest && this.boardSnap) return this.boardSnap.actions || [];
		return this.props.snapshot.actions || [];
	}

	zoneActs(): TcgAction[] {
		return this.acts().filter(a => a.type === 'attachZone');
	}

	startHandDrag = (i: number, cardId: string, e: PointerEvent) => {
		if (e.button != null && e.button !== 0) return;
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
		if (!hits.length) {
			const text = whyCant(this.props.snapshot, { zone: true }, this.props.waiting);
			if (text) this.showRefuse(text, e.clientX, e.clientY);
			return;
		}
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
		const mon = el.closest('.tcg-mon');
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
		let refuse = this.state.refuse;
		if (active && over) {
			const hits = actionsForDrop(this.acts(), drag, over);
			hint = hits.length ? dropVerb(hits[0]) : '';
			const text = hits.length ? '' : whyCant(this.props.snapshot, {
				hand: drag.hand, drop: over, source: drag.source, zone: drag.source === 'zone',
			}, this.props.waiting);
			refuse = text ? { text, x: e.clientX, y: e.clientY } : null;
		} else if (active) {
			hint = drag.source === 'zone' ? 'Drop on a Pokémon' : 'Drop on a valid target';
			const idle = drag.source === 'hand' && drag.hand != null &&
				!this.acts().some(a => actionTouchesHand(a, drag.hand!));
			const text = idle ? whyCant(this.props.snapshot, { hand: drag.hand }, this.props.waiting) : '';
			refuse = text ? { text, x: e.clientX, y: e.clientY } : null;
		}
		if (active) this.stopRefuseTimer();
		if (
			active === drag.active &&
			e.clientX === drag.x && e.clientY === drag.y &&
			sameDrop(over, drag.over) && hint === drag.hint &&
			(refuse?.text || '') === (this.state.refuse?.text || '')
		) return;
		this.setState({
			drag: { ...drag, x: e.clientX, y: e.clientY, active, over, hint },
			refuse,
		});
	};

	onDragEnd = (e: PointerEvent) => {
		const drag = this.state.drag;
		if (this.holdConsumed) {
			this.holdConsumed = false;
			if (drag) this.setState({ drag: null, refuse: null });
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
			this.clickHand(drag.hand, e);
			return;
		}
		if (!drag.active && drag.source === 'zone') {
			this.setState({ drag: null });
			this.clickEnergy(e);
			return;
		}
		const text = whyCant(this.props.snapshot, {
			hand: drag.hand,
			drop: over,
			source: drag.source,
			zone: drag.source === 'zone',
		}, this.props.waiting);
		this.setState({ drag: null, inspect: null, refuse: null });
		if (text) this.showRefuse(text, e.clientX, e.clientY);
	};

	clickHand = (i: number, ev?: { clientX: number, clientY: number }) => {
		const hits = this.acts().filter(a => actionTouchesHand(a, i));
		if (hits.length === 1 && !hasBoardTarget(hits[0])) {
			this.choose(hits[0]);
			return;
		}
		if (!hits.length) {
			const text = whyCant(this.props.snapshot, { hand: i }, this.props.waiting);
			if (text && ev) this.showRefuse(text, ev.clientX, ev.clientY);
			return;
		}
		this.stopRefuseTimer();
		this.setState({
			selectedHand: this.state.selectedHand === i ? null : i,
			energyPick: false,
			retreatPick: false,
			menuSlot: null,
			refuse: null,
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

	clickSlot = (slot: TcgSlot, foe = false, ev?: MouseEvent) => {
		if (this.state.drag?.active) return;
		const acts = this.acts();
		const snap = this.props.snapshot;
		const at = (text: string) => {
			if (text && ev) this.showRefuse(text, ev.clientX, ev.clientY);
		};
		const { selectedHand, energyPick, retreatPick, menuSlot } = this.state;
		if (selectedHand != null) {
			const me = snap.players[snap.you ?? 0];
			const opp = snap.players[snap.you === 0 ? 1 : 0];
			const side = foe ? opp : me;
			const empty = !(slot === 'active' ? side?.active : side?.bench?.[Number(slot)]);
			const drop: DropTarget = { kind: 'slot', slot, foe, empty };
			const hits = actionsForDrop(acts, { source: 'hand', hand: selectedHand }, drop);
			if (hits.length === 1) return this.choose(hits[0]);
			const legacy = acts.filter(a => actionTouchesHand(a, selectedHand) && actionTouchesSlot(a, slot));
			if (legacy.length === 1) return this.choose(legacy[0]);
			at(whyCant(snap, { hand: selectedHand, drop }, this.props.waiting));
			return;
		}
		if (!foe && energyPick) {
			const hits = this.zoneActs().filter(a => actionTouchesSlot(a, slot));
			if (hits.length === 1) return this.choose(hits[0]);
			at(whyCant(snap, { zone: true, drop: { kind: 'slot', slot, foe, empty: false }, source: 'zone' }, this.props.waiting));
			return;
		}
		if (retreatPick) {
			const hits = acts.filter(a => a.type === 'retreat' && typeof slot === 'number' && a.bench === slot);
			if (hits.length === 1) return this.choose(hits[0]);
			at(foe || slot === 'active' ? 'Choose a Benched Pokémon to switch in.' : "This Pokémon can't retreat there.");
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
			this.stopRefuseTimer();
			this.setState({
				menuSlot: menuSlot === slot ? null : slot,
				selectedHand: null,
				energyPick: false,
				refuse: null,
			});
			return;
		}
		this.setState({ menuSlot: null });
		at(whyCant(snap, { slot }, this.props.waiting));
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

	clickEnergy = (ev?: { clientX: number, clientY: number }) => {
		const hits = this.zoneActs();
		if (!hits.length) {
			const text = whyCant(this.props.snapshot, { zone: true }, this.props.waiting);
			if (text && ev) this.showRefuse(text, ev.clientX, ev.clientY);
			return;
		}
		if (hits.length === 1) {
			this.choose(hits[0]);
			return;
		}
		this.setState({ energyPick: true, selectedHand: null, retreatPick: false, menuSlot: null });
	};

	clickPlayZone = (ev?: MouseEvent) => {
		const { selectedHand, drag } = this.state;
		if (drag?.active) return;
		if (selectedHand == null) return;
		const hits = actionsForDrop(this.acts(), { source: 'hand', hand: selectedHand }, { kind: 'play' });
		if (hits.length === 1) {
			this.choose(hits[0]);
			return;
		}
		if (ev) {
			const text = whyCant(this.props.snapshot, {
				hand: selectedHand, drop: { kind: 'play' },
			}, this.props.waiting);
			if (text) this.showRefuse(text, ev.clientX, ev.clientY);
		}
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
		// Already shown face up on an earlier beat of this batch; don't flip them again at commit.
		if (this.boardSnap) {
			this.boardSnap.players.forEach(p => {
				const mons = [p?.active, ...(p?.bench || [])];
				mons.forEach(m => { if (m && !m.faceDown) delete this.faceDownSeen[m.iid]; });
			});
		}
		const meIndex: 0 | 1 = (this.props.viewpoint === 0 || this.props.viewpoint === 1) ?
			this.props.viewpoint : (snap.you === 1 ? 1 : 0);
		const foeIndex: 0 | 1 = meIndex === 0 ? 1 : 0;
		// Events already played this batch. Choices still come from the committed snapshot until the request.
		const view = this.boardSnap || snap;
		this.rememberMons(view);
		const me = view.players[meIndex];
		const foe = view.players[foeIndex];
		if (!me || !foe) {
			return <div class="tcg-table"><p class="tcg-waiting">Waiting for TCG snapshot…</p></div>;
		}
		const benchSize = snap.format?.benchSize || Math.max(me.bench.length, foe.bench.length, 3);
		// Fan keeps pre-batch indexes so a click still matches the server hand.
		// Played cards leave on their beat; drawn and prize cards join on theirs.
		const myHand = handFan(handIds(snap.players[meIndex]?.hand), me.hand);
		const shuffleFx = this.state.fx?.kind === 'shuffleHand' ? this.state.fx : null;
		const shufflingMine = !!(shuffleFx && shuffleFx.seat === meIndex);
		const shufflingFoe = !!(shuffleFx && shuffleFx.seat !== meIndex);
		const shuffleHandIds = shufflingMine ? (shuffleFx?.ids || null) : null;
		const shuffleHandCount = shufflingMine ?
			Math.max(shuffleHandIds?.length || 0, shuffleFx?.n || 0, 3) :
			0;
		const allActs = this.acts();
		const fxNow = this.state.fx;
		const firstPending = this.state.firstSent ? [] : allActs.filter(a => a.type === 'chooseFirst');
		const choosingFirst = firstPending.length > 0 ||
			fxNow?.kind === 'coin' || fxNow?.kind === 'first';
		const ahead = view !== snap;
		const turnSeat = typeof view.turn === 'number' ? view.turn : null;
		const turnOwner = turnSeat != null ? view.players[turnSeat] : null;
		const yourTurn = !this.props.ended && !this.props.waiting && allActs.length > 0;
		// While beats are playing, the badge follows the turn event instead of leftover actions.
		const isMyTurnSeat = snap.you != null && snap.you === meIndex && (
			ahead ? (view.status === 'playing' && turnSeat === snap.you) :
			(allActs.length > 0 ||
				(view.status === 'playing' && turnSeat === snap.you && !this.props.waiting))
		);
		// After the game, a replay re-shows earlier snapshots: label those by turn, not "End".
		const replaying = !!this.props.ended && view.status !== 'over';
		const displayTurn = view.turnNumber || 1;
		const turnWho = this.props.ended && !replaying ? '' :
			choosingFirst && view.status === 'setup' ? 'Coin flip' :
			view.status === 'setup' ? 'Setup phase' :
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
		const firsts = firstPending;
		const searches = allActs.filter(a => a.type === 'searchPick' || a.type === 'searchDone');
		const discards = allActs.filter(a => a.type === 'discardPick');
		const pays = allActs.filter(a => a.type === 'payEnergy');
		const prizeActs = allActs.filter(a => a.type === 'takePrize');
		const picked = this.state.prizePicked;
		const prizeGoal = this.state.prizeGoal || view.pendingPrize?.n || 0;
		// Close the whole prompt on the click that finishes the set, not when the server catches up.
		const prizeDone = prizeGoal > 0 && picked.length >= prizeGoal;
		const prizes = prizeDone ? [] : prizeActs.filter(a => picked.indexOf(Number(a.index)) < 0);
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
		const playHot = dragging && drag.over?.kind === 'play' && playDropHits.length > 0;
		const stadiumHot = dragging && drag.over?.kind === 'stadium' && stadiumDropHits.length > 0;
		const discardHot = dragging && drag.over?.kind === 'discard' && discardDropHits.length > 0;

		const seated = snap.you != null && !this.props.ended;
		let hint = (dragging && drag.hint) || '';
		if (!this.props.ended && seated && !hint) {
			const prizeLeft = prizeDone ? 0 : (view.pendingPrize ? view.pendingPrize.n - picked.length : 0);
			const lines = [
				view.pendingConfirm?.text || '',
				this.state.energyPick ? 'Choose a Pokémon for Energy' : '',
				this.state.retreatPick ? 'Choose a Benched Pokémon to switch in' : '',
				this.state.menuSlot != null ? 'Choose an action' : '',
				selectedHand != null && selectedHandNeedTarget.length ?
					`Drag or tap a Pokémon for ${describeAction(selectedHandNeedTarget[0], snap)}` : '',
				selectedHand != null ? 'Drag onto a target or the play area' : '',
				view.pendingSearch ? 'Choose a card from the search' : '',
				view.pendingDiscard ?
					`Drag ${view.pendingDiscard.need} card${view.pendingDiscard.need === 1 ? '' : 's'} to Discard` : '',
				view.pendingRetreatPay ? `Discard ${view.pendingRetreatPay.need} Energy to retreat` : '',
				view.pendingPromote != null && view.pendingPromote === snap.you ?
					'Choose a Benched Pokémon to promote' : '',
				prizes.length && view.pendingPrize ?
					`Take ${Math.max(1, prizeLeft)} Prize card${prizeLeft === 1 ? '' : 's'}` : '',
				prizes.length ? 'Take a Prize card' : '',
				discards.length ? 'Drag a card to Discard' : '',
				snap.status === 'setup' && !choosingFirst ? 'Drag Basics to Active / Bench, then Ready' : '',
				yourTurn ? 'Drag cards to play · Tap your Pokémon to attack' : '',
			];
			hint = lines.find(line => line) || '';
		}

		const foeHoldsTurn = view.status === 'setup' ?
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
				const fromFx = (/^(.+?)\s+wins?\.?$/i.exec(String(st.fx.extra || '')))?.[1];
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
						{this.props.ended && !replaying ? 'End' : view.status === 'setup' ? (choosingFirst ? 'Coin' : 'Setup') : `Turn ${displayTurn}`}
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
							<TcgPrizeRail remaining={prizesLeft(foe, need, view.status)} max={need} foe /> :
							<TcgPoints scored={scoredPoints(foe, need, view.status)} need={need} pocket />}
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
									onClick={ghost ? undefined : (ev: MouseEvent) => this.clickSlot(i, true, ev)} onInspect={this.openInspect}
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
								onClick={!foe.active && foeActive ? undefined : (ev: MouseEvent) => this.clickSlot('active', true, ev)}
								onInspect={this.openInspect}
							/>
						</div>
					</div>
					<div class="tcg-side right">
						<div class="tcg-pile deck foe" title={`Opponent deck: ${pileCount(foe.deck)}`}>
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
								cardId={stadiumId} name={cardLabel(stadiumId)} size="sm"
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
								remaining={prizesLeft(me, need, view.status)} max={need}
								takeActs={prizes} onTake={a => this.choose(a)}
							/> :
							<>
								<TcgPoints scored={scoredPoints(me, need, view.status)} need={need} pocket />
								{(zone || pocket) && <button
									type="button"
									class={`tcg-ezone ${canAttach ? 'ready' : 'off'} ${this.state.energyPick ? 'pick' : ''} ${drag?.source === 'zone' && dragging ? 'dragging' : ''}`}
									onPointerDown={(ev: any) => this.startZoneDrag(ev)}
									title={canAttach ? 'Drag onto a Pokémon to attach' : ''}
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
								onClick={!me.active && meActive ? undefined : (ev: MouseEvent) => this.clickSlot('active', false, ev)}
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
									onClick={ghost ? undefined : (ev: MouseEvent) => this.clickSlot(i, false, ev)} onInspect={this.openInspect}
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
					) : myHand ? myHand.map(({ id, i, arrive }, fan) => {
						const playable = i >= 0 && allActs.some(a => actionTouchesHand(a, i));
						// Key by "nth copy of this card", not by index, so playing one card lets the
						// rest glide over instead of remounting every card to its right.
						let nth = 0;
						for (let j = 0; j < fan; j++) if (myHand[j].id === id) nth++;
						return <TcgCardFace
							key={`${id}#${nth}`} cardId={id} size="md"
							pocket={pocket}
							arrive={arrive}
							selected={i >= 0 && this.state.selectedHand === i}
							playable={playable}
							dragging={i >= 0 && drag?.source === 'hand' && drag.hand === i && dragging}
							fanIndex={fan} fanCount={myHand.length}
							onPointerDown={i >= 0 ? (ev: any) => this.startHandDrag(i, id, ev) : undefined}
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
				{endTurn && <button
					type="button" class="tcg-endturn" onClick={() => {
						const busy = allActs.some(a =>
							a.type === 'attack' || a.type === 'ability' || a.type === 'attachZone' ||
							a.type === 'playBasic' || a.type === 'playTrainer' || a.type === 'playStadium' ||
							a.type === 'evolve' || a.type === 'attachEnergy' || a.type === 'attachTool' ||
							a.type === 'retreat' || a.type === 'useStadium'
						);
						if (busy && !PS.prefs.tcgskipendturn) this.setState({ endTurnConfirm: true, menuSlot: null });
						else this.choose(endTurn);
					}}
				>
					End<br />Turn
				</button>}
			</div>

			{this.state.menuSlot != null && (() => {
				const slot = this.state.menuSlot;
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
									const atk = a.name || a.cost || a.damage ?
										{ name: a.name, cost: a.cost, damage: a.damage } :
										me.active?.attacks?.[a.index];
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
				if (!kind || snap.you == null) return null;
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
								{searchPicks.length ? searchPicks.map((a, i) =>
									<div key={`${a.pick}-${i}`} class="tcg-prompt-card">
										<TcgCardFace
											cardId={a.pick} size="md"
											onClick={() => this.choose(a)}
											onInspect={this.openInspect}
										/>
										<em>{cardLabel(a.pick)}</em>
									</div>
								) : <p class="tcg-prompt-note">No matching cards</p>}
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
			{this.state.refuse && <div
				class="tcg-refuse"
				style={{ left: `${this.state.refuse.x}px`, top: `${this.state.refuse.y}px` }}
				role="status"
			>{this.state.refuse.text}</div>}
			<FxOverlay
				key={st.fx ? `${st.fx.kind}-${st.fx.iid || ''}-${st.fx.amount || ''}-${Object.values(st.pkFx)[0]?.tick || 0}` : 'fx'}
				fx={st.fx} you={snap.you} viewpoint={meIndex}
				names={snap.players.map(p => p?.name || '')}
			/>
		</div>;
	}
}
