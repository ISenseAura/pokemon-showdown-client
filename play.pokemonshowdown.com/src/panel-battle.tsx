/**
 * Battle panel
 *
 * @author Guangcong Luo <guangcongluo@gmail.com>
 * @license AGPLv3
 */

import preact from "../js/lib/preact";
import {
	PS, PSRoom, type RoomOptions, type RoomID, Config, type BattlePanelLayout,
} from "./client-main";
import { PSIcon, PSPanelWrapper, PSRoomPanel } from "./panels";
import { ChatLog, ChatRoom, ChatTextEntry, ChatUserList } from "./panel-chat";
import { FormatDropdown } from "./panel-mainmenu";
import { Battle, type Pokemon, type ServerPokemon } from "./battle";
import { BattleScene } from "./battle-animations";
import { Dex, toID, type ID } from "./battle-dex";
import {
	BattleChoiceBuilder, type BattleRequestActivePokemon, type BattleRequestSideInfo,
	type BattleRequest, type BattleMoveRequest, type BattleSwitchRequest, type BattleTeamRequest,
} from "./battle-choices";
import type { Args } from "./battle-text-parser";
import { ModifiableValue } from "./battle-tooltips";
import { Net } from "./client-connection";
import { BattleLog } from "./battle-log";
import { TcgBoard, isTcgBattleId, chatEntryForEvent, chatHtmlForEntry, noteTcgMons, loadPaperNames, type TcgAction, type TcgEvent, type TcgPokemonView, type TcgSnapshot } from "./battle-tcg";

type BattleDesc = {
	id: RoomID,
	minElo?: number | string,
	p1?: string,
	p2?: string,
	p3?: string,
	p4?: string,
};
export class BattlesRoom extends PSRoom {
	override readonly classType = 'battles';
	/** null means still loading */
	format = '';
	filters = '';
	battles: BattleDesc[] | null = null;
	constructor(options: RoomOptions) {
		super(options);
		this.refresh();
		// If graphics preference is set to use BW sprites
		if (PS.prefs.bwgfx) {
			Dex.loadSpriteData('bw');
		}
	}
	setFormat(format: string) {
		if (format === this.format) return this.refresh();
		this.battles = null;
		this.format = format;
		this.update(null);
		this.refresh();
	}
	refresh() {
		PS.send(`/cmd roomlist ${toID(this.format)}, ${this.filters}`);
	}
}

class BattlesPanel extends PSRoomPanel<BattlesRoom> {
	static readonly id = 'battles';
	static readonly routes = ['battles'];
	static readonly Model = BattlesRoom;
	static readonly location = 'right';
	static readonly icon = <i class="fa fa-caret-square-o-right" aria-hidden></i>;
	static readonly title = 'Battles';
	refresh = () => {
		this.props.room.refresh();
	};
	changeFormat = (e: Event) => {
		const value = (e.target as HTMLButtonElement).value;
		this.props.room.setFormat(value);
	};
	applyFilters = (e: Event) => {
		e.preventDefault();
		const minElo = this.base?.querySelector<HTMLInputElement>(`select[name=elofilter]`)?.value;
		const searchPrefix = this.base?.querySelector<HTMLInputElement>(`input[name=prefixsearch]`)?.value;
		this.props.room.filters = `${minElo || ''},${searchPrefix || ''}`;
		this.refresh();
	};
	renderBattleLink(battle: BattleDesc) {
		const format = battle.id.split('-')[1];
		const minEloMessage = typeof battle.minElo === 'number' ? `rated ${battle.minElo}` : battle.minElo;
		return <div key={battle.id}><a href={`/${battle.id}`} class="blocklink">
			{minEloMessage && <small style="float:right">({minEloMessage})</small>}
			<small>[{format}]</small><br />
			<em class="p1">{battle.p1}</em> <small class="vs">vs.</small> <em class="p2">{battle.p2}</em>
		</a></div>;
	}
	override render() {
		const room = this.props.room;
		return <PSPanelWrapper room={room}><div class="pad">
			<button class="button" style="float:right;font-size:10pt;margin-top:3px" name="closeRoom">
				<i class="fa fa-times" aria-hidden></i> Close
			</button>
			<div class="roomlist">
				<p>
					<button class="button" name="refresh" onClick={this.refresh}>
						<i class="fa fa-refresh" aria-hidden></i> Refresh
					</button> {}
					<span
						style={Dex.getPokemonIcon('meloetta-pirouette') + ';display:inline-block;vertical-align:middle'} class="picon"
						title="Meloetta is PS's mascot! The Pirouette forme is Fighting-type, and represents our battles."
					></span>
				</p>

				<p>
					<label class="label">Format:</label><FormatDropdown onChange={this.changeFormat} placeholder="(All formats)" />
				</p>
				<label class="label">
					Minimum Elo: <select name="elofilter" class="select" onChange={this.applyFilters}>
						<option value="none">None</option><option value="1100">1100</option><option value="1300">1300</option>
						<option value="1500">1500</option><option value="1700">1700</option><option value="1900">1900</option>
					</select>
				</label>

				<form class="search" onSubmit={this.applyFilters}>
					<p>
						<input type="text" name="prefixsearch" class="textbox" placeholder="Username prefix" autocomplete="off" />
						<button type="submit" class="button">Search</button>
					</p>
				</form>
				<div class="list">{!room.battles ? (
					<p>Loading...</p>
				) : !room.battles.length ? (
					<p>No battles are going on</p>
				) : (<>
					<p>{room.battles.length === 100 ?
						`100+` : room.battles.length} {room.battles.length > 1 ? `battles` : `battle`}</p>
					{room.battles.map(battle => this.renderBattleLink(battle))}
				</>
				)}</div>
			</div>
		</div></PSPanelWrapper>;
	}
}

/** Same TCG event batch (by seq)? */
function sameTcgEvents(a: TcgEvent[] | undefined, b: TcgEvent[] | undefined): boolean {
	if (!a?.length || !b?.length || a.length !== b.length) return false;
	return a.every((ev, i) => ev.seq === b[i].seq && ev.type === b[i].type);
}

export class BattleRoom extends ChatRoom {
	override readonly classType = 'battle';
	declare pmTarget: null;
	declare challengeMenuOpen: false;
	declare challengingFormat: null;
	declare challengedFormat: null;

	override battle: Battle = null!;
	/** null if spectator, otherwise current player's info */
	side: BattleRequestSideInfo | null = null;
	request: BattleRequest | null = null;
	choices: BattleChoiceBuilder | null = null;
	autoTimerActivated: boolean | null = null;
	requireForfeit = false;
	/** should be false if we joined right after accepting or challenging a battle,
	  * and true if we refreshed and rejoined a battle.
		* null = initializing, we don't know yet */
	rejoining: boolean | null = null;
	overlayActive: 'move' | 'switch' | null = null;
	tcgMode = isTcgBattleId(this.id);
	tcgSnapshot: TcgSnapshot | null = null;
	/** Snapshot for the beat currently animating. The board keeps the previous one until that beat ends. */
	tcgFxSnapshot: TcgSnapshot | null = null;
	tcgEvents: TcgEvent[] = [];
	tcgFxKey = 0;
	tcgLastSeq = 0;
	tcgWait = false;
	tcgPlaying = false;
	/** Highest event seq already queued for FX; repeats are dropped. */
	tcgSeqSeen = 0;
	/** Status of the newest payload (events can arrive without a snapshot). */
	tcgLatestStatus: string | undefined = undefined;
	/** Opponent setup placements we show face down: seat → slot → iid. */
	tcgSetupHidden: { [seat: number]: { [slot: string]: string } } = {};
	/** Payloads that arrive during (re)join are history; show the result instead of replaying every beat. */
	tcgSyncUntil = Date.now() + 2500;
	tcgQueue: {
		snapshot?: TcgSnapshot,
		events?: TcgEvent[],
		wait?: boolean,
		animate: boolean,
		/** |request| repeats events that |tcg| will log. Don't write them again. */
		silent?: boolean,
		/** Copied from history for a local replay. Do not record it again. */
		replay?: boolean,
		markEnded?: boolean,
		winner?: string | null,
	}[] = [];
	/** Every payload this battle, so Replay can play it again. */
	tcgHistory: BattleRoom['tcgQueue'] = [];
	tcgPaused = false;
	tcgHalt = 0;
	tcgEnded = false;
	/** Winner display name from `|win|`; `null` means tie / unknown. */
	tcgWinner: string | null = null;
	/** Seat shown at the bottom for spectators / offline replay (0 or 1). */
	tcgViewpoint: 0 | 1 = 0;
	/** Your seat when playing; null when spectating. */
	tcgSide: 0 | 1 | null = null;
	tcgP1 = { id: '', name: '' };
	tcgP2 = { id: '', name: '' };
	/** Timer countdown from `|inactive|` (TCG has no Battle object). */
	tcgKickingInactive: number | boolean = false;
	tcgTotalTimeLeft = 0;
	/** Offline / uploaded replay — scrub freely. */
	tcgReplayMode = false;
	/** History index currently displayed while scrubbing (−1 = live end). */
	tcgSeekIndex = -1;

	override interruptClose(explicit?: boolean, elem?: HTMLElement | null) {
		if (this.isPlaying() || this.requireForfeit) {
			PS.join('forfeitbattle' as RoomID, { parentElem: elem, parentRoomid: this.id });
			return `You are still in ${this.title}`;
		}
		return super.interruptClose(explicit, elem);
	}
	isPlaying() {
		if (this.tcgMode) {
			return !this.tcgEnded && this.connectMode !== 'deleted' && !!this.tcgSnapshot;
		}
		return this.battle && !this.battle.ended && this.request && this.connectMode !== 'deleted';
	}
	updateChoiceNotification() {
		let oName = this.battle?.farSide.name;
		if (oName) oName = " against " + oName;
		let title = '';
		let body = '';
		switch (this.request?.requestType) {
		case 'move':
			title = "Your move!";
			body = "Move in your battle" + oName;
			break;
		case 'switch':
			title = "Your switch!";
			body = "Switch in your battle" + oName;
			break;
		case 'team':
			title = "Team preview!";
			body = "Choose your team order in your battle" + oName;
			break;
		}

		if (!this.choices || this.choices.isDone()) body = '';

		if (this.tcgMode && this.tcgSnapshot && !this.tcgWait && this.tcgSnapshot.actions?.length && !this.tcgEnded) {
			title = "Your turn!";
			body = "Choose a TCG action" + oName;
		}

		const current = this.notifications.find(notification => notification.id === 'choice');
		if ((current?.body || '') === body) return;

		if (!body) {
			this.dismissNotification('choice');
		} else {
			this.notify({ title, body, id: 'choice', noAutoDismiss: true });
		}
	}

	override handleReconnect(): boolean | void {
		if (this.battle) {
			this.battle.stepQueue = [];
			this.battle.preemptStepQueue = [];
			this.battle.resetStep();
		}
		this.side = null;
		this.request = null;
		this.choices = null;
		this.tcgSnapshot = null;
		this.tcgFxSnapshot = null;
		this.tcgEvents = [];
		this.tcgQueue = [];
		this.tcgHistory = [];
		this.tcgPaused = false;
		this.tcgPlaying = false;
		this.tcgSyncUntil = Date.now() + 2500;
		this.tcgLastSeq = 0;
		this.tcgSeqSeen = 0;
		this.tcgLatestStatus = undefined;
		this.tcgSetupHidden = {};
		this.tcgEnded = false;
		this.tcgWinner = null;
		this.tcgViewpoint = 0;
		this.tcgSide = null;
		this.tcgKickingInactive = false;
		this.tcgTotalTimeLeft = 0;
		this.tcgReplayMode = false;
		this.tcgSeekIndex = -1;
		this.updateChoiceNotification();
		return false;
	}

	tcgFormatId() {
		const parts = this.id.split('-');
		return parts[1] || 'tcgstandard';
	}
	tcgOpponentId() {
		if (this.tcgSide === 0) return toID(this.tcgP2.id || this.tcgP2.name);
		if (this.tcgSide === 1) return toID(this.tcgP1.id || this.tcgP1.name);
		return '';
	}
	isTcgPlayer() {
		return this.tcgSide != null && !this.tcgReplayMode;
	}
	isTcgSpectator() {
		return this.tcgSide == null || this.tcgReplayMode;
	}
	switchTcgViewpoint = () => {
		if (!this.isTcgSpectator() && !this.tcgEnded && !this.tcgReplayMode) return;
		this.tcgViewpoint = this.tcgViewpoint === 0 ? 1 : 0;
		this.update(null);
	};
	/** Snapshot for the board with spectator viewpoint applied. */
	tcgViewSnapshot(snap: TcgSnapshot | null): TcgSnapshot | null {
		if (!snap) return null;
		if (this.isTcgPlayer() && !this.tcgEnded && !this.tcgReplayMode) return snap;
		if (snap.you != null && !this.tcgReplayMode && !this.tcgEnded) return snap;
		return { ...snap, you: this.tcgViewpoint };
	}
	turnAtHistoryIndex(index: number): number {
		let turn = 0;
		for (let i = 0; i <= index && i < this.tcgHistory.length; i++) {
			const item = this.tcgHistory[i];
			if (item.snapshot?.turnNumber != null) turn = item.snapshot.turnNumber;
			for (const ev of item.events || []) {
				if (ev.type === 'turn' && typeof ev.number === 'number') turn = ev.number;
			}
		}
		return turn;
	}
	/** Seek TCG history by turn / relative offset / end (offline or post-game). */
	fftoTcg(target: string | number) {
		if (!this.tcgHistory.length) return;
		const canScrub = this.tcgEnded || this.tcgReplayMode || this.isTcgSpectator();
		if (!canScrub) {
			// Live spectator catch-up only
			if (target === 'end' || target === Infinity) this.skipTcgToEnd();
			return;
		}
		const turns: number[] = [];
		for (let i = 0; i < this.tcgHistory.length; i++) {
			turns.push(this.turnAtHistoryIndex(i));
		}
		const curIdx = this.tcgSeekIndex < 0 ? this.tcgHistory.length - 1 : this.tcgSeekIndex;
		const curTurn = turns[curIdx] || 0;
		let wantTurn: number;
		if (target === 'end' || target === Infinity) {
			this.tcgSeekIndex = -1;
			this.replayTcgSeek(this.tcgHistory.length - 1, false);
			this.skipTcgToEnd();
			return;
		}
		const t = String(target);
		if (t.startsWith('+')) {
			wantTurn = curTurn + (parseInt(t.slice(1), 10) || 1);
		} else if (t.startsWith('-') || (typeof target === 'number' && target < 0)) {
			wantTurn = Math.max(0, curTurn + (typeof target === 'number' ? target : parseInt(t, 10)));
		} else {
			wantTurn = Number(target);
			if (isNaN(wantTurn)) wantTurn = 0;
		}
		let idx = 0;
		for (let i = 0; i < turns.length; i++) {
			if (turns[i] <= wantTurn) idx = i;
			if (turns[i] >= wantTurn && wantTurn > 0) {
				idx = i;
				break;
			}
		}
		if (wantTurn <= 0) idx = 0;
		this.tcgSeekIndex = idx;
		this.replayTcgSeek(idx, false);
	}
	/** Paint history through `throughIndex` instantly (for scrubbing). */
	replayTcgSeek(throughIndex: number, animate: boolean) {
		this.tcgPaused = !animate;
		this.tcgPlaying = false;
		this.tcgHalt++;
		this.tcgSnapshot = null;
		this.tcgFxSnapshot = null;
		this.tcgEvents = [];
		this.tcgWait = true;
		this.tcgQueue = [];
		let seen = 0;
		const slice = this.tcgHistory.slice(0, throughIndex + 1);
		if (!animate) {
			for (const item of slice) {
				const events = (item.events || []).filter(ev => {
					if (typeof ev.seq !== 'number') return true;
					if (ev.seq <= seen) return false;
					seen = ev.seq;
					return true;
				});
				this.commitTcg({ ...item, events, animate: false, silent: true, replay: true }, false);
			}
			this.update(null);
			return;
		}
		this.tcgQueue = slice.map(item => {
			const events = (item.events || []).filter(ev => {
				if (typeof ev.seq !== 'number') return true;
				if (ev.seq <= seen) return false;
				seen = ev.seq;
				return true;
			});
			return {
				...item,
				events,
				animate: !!events.length && !PS.prefs.noanim,
				silent: true,
				replay: true,
			};
		});
		this.pumpTcg();
	}
	buildTcgReplayDownload(): string {
		let snapshot: TcgSnapshot | null = null;
		const events: TcgEvent[] = [];
		let seen = 0;
		for (const item of this.tcgHistory) {
			if (item.snapshot && !snapshot) snapshot = item.snapshot;
			if (item.snapshot && item.snapshot.you == null) snapshot = snapshot || item.snapshot;
			for (const ev of item.events || []) {
				if (typeof ev.seq === 'number') {
					if (ev.seq <= seen) continue;
					seen = ev.seq;
				}
				// Strip private draw ids for download safety
				if ((ev.type === 'draw' || ev.type === 'find' || ev.type === 'prizeTake') && (ev as any).ids) {
					const { ids: _ids, ...rest } = ev as any;
					events.push(rest);
				} else {
					events.push(ev);
				}
			}
		}
		if (!snapshot) {
			for (let i = this.tcgHistory.length - 1; i >= 0; i--) {
				if (this.tcgHistory[i].snapshot) {
					snapshot = this.tcgHistory[i].snapshot!;
					break;
				}
			}
		}
		const payload = {
			format: this.tcgFormatId(),
			formatName: this.tcgFormatId(),
			p1: this.tcgP1.name,
			p2: this.tcgP2.name,
			winner: this.tcgWinner || '',
			replay: { snapshot, events },
		};
		return `|tcgreplay|${JSON.stringify(payload)}`;
	}
	loadTcgReplayPayload(raw: string, titleHint?: string) {
		let body = raw.trim();
		if (body.startsWith('|tcgreplay|')) body = body.slice('|tcgreplay|'.length);
		const data = JSON.parse(body) as {
			format?: string, formatName?: string, p1?: string, p2?: string, winner?: string,
			replay?: { snapshot?: TcgSnapshot, events?: TcgEvent[] },
			snapshot?: TcgSnapshot, events?: TcgEvent[],
		};
		const replay = data.replay || { snapshot: data.snapshot, events: data.events };
		if (!replay?.snapshot) throw new Error('Missing TCG replay snapshot');
		this.tcgMode = true;
		this.tcgReplayMode = true;
		this.tcgEnded = true;
		this.tcgSide = null;
		this.tcgWinner = data.winner || null;
		this.tcgP1 = { id: toID(data.p1 || ''), name: data.p1 || 'Player 1' };
		this.tcgP2 = { id: toID(data.p2 || ''), name: data.p2 || 'Player 2' };
		this.title = titleHint ||
			`[${data.formatName || data.format || 'TCG'}] ${this.tcgP1.name} vs. ${this.tcgP2.name}`;
		this.connectMode = null;
		this.connectError = null;
		this.tcgHistory = [{
			snapshot: replay.snapshot,
			events: replay.events || [],
			animate: false,
			wait: false,
			markEnded: true,
			winner: this.tcgWinner,
		}];
		// Split events into turn chunks for scrubbing when possible
		if (replay.events?.length) {
			const chunks: BattleRoom['tcgQueue'] = [{
				snapshot: replay.snapshot,
				events: [],
				animate: false,
				wait: false,
			}];
			for (const ev of replay.events) {
				if (ev.type === 'turn' && chunks[chunks.length - 1].events?.length) {
					chunks.push({ events: [ev], animate: true, wait: false });
				} else {
					(chunks[chunks.length - 1].events ||= []).push(ev);
				}
			}
			chunks[chunks.length - 1].markEnded = true;
			chunks[chunks.length - 1].winner = this.tcgWinner;
			this.tcgHistory = chunks;
		}
		this.tcgSeekIndex = -1;
		this.replayTcgSeek(this.tcgHistory.length - 1, false);
		this.update(null);
	}
	/** Beyond this many queued payloads, the oldest are applied instantly so the board never lags minutes behind. */
	static readonly TCG_MAX_BACKLOG = 12;
	/** How long a silent |request| echo waits for its animated |tcg| twin before painting on its own. */
	static readonly TCG_ECHO_HOLD_MS = 400;
	enqueueTcg(item: BattleRoom['tcgQueue'][number]) {
		// Each server batch arrives as a silent |request| echo followed by the animated |tcg|
		// payload with the same events. If the echo is still waiting in the queue, let the
		// animated twin carry the board instead, so the result never paints before its beat.
		if (item.animate && item.events?.length && !item.replay) {
			const last = this.tcgQueue[this.tcgQueue.length - 1];
			if (last && !last.animate && last.silent && !last.replay && sameTcgEvents(last.events, item.events)) {
				this.tcgQueue.pop();
				const hist = this.tcgHistory[this.tcgHistory.length - 1];
				if (hist && hist.silent && sameTcgEvents(hist.events, last.events)) this.tcgHistory.pop();
			}
		}
		if (!item.replay) {
			// The backlog arrives only once we're logged in, which can be well after the room was
			// built; measure the catch-up window from the first payload so a rejoin never animates.
			if (!this.tcgHistory.length) this.tcgSyncUntil = Math.max(this.tcgSyncUntil, Date.now() + 2500);
			this.tcgHistory.push({
				...item,
				events: item.events?.slice(),
			});
		}
		const status = item.snapshot?.status ?? this.tcgSnapshot?.status;
		if (Date.now() < this.tcgSyncUntil && status && status !== 'setup') {
			// Catch-up burst after rejoining a game in progress: write the log, jump the board, no beats.
			// A fresh game is still in setup here, so its opening beats keep animating.
			item.animate = false;
			if (this.tcgPlaying || this.tcgQueue.length) {
				// The opening beats of the backlog started animating before we knew this was a
				// rejoin; drop them and jump straight to the newest board.
				this.tcgQueue.push(item);
				this.skipTcgToEnd();
			} else {
				this.commitTcg(item, false);
			}
			return;
		}
		// A request must not paint the resulting board while an earlier beat is still playing.
		if (!item.animate && !this.tcgPlaying && !this.tcgQueue.length) {
			if (item.silent && item.events?.length) {
				// Hold the echo briefly: its animated twin normally follows within a few ms.
				this.tcgQueue.push(item);
				this.tcgWait = true;
				window.setTimeout(() => this.pumpTcg(), BattleRoom.TCG_ECHO_HOLD_MS);
				return;
			}
			this.commitTcg(item, false);
			return;
		}
		this.tcgQueue.push(item);
		while (this.tcgQueue.length > BattleRoom.TCG_MAX_BACKLOG) {
			const old = this.tcgQueue.shift()!;
			this.commitTcg(old, false);
		}
		this.tcgWait = true;
		this.pumpTcg();
	}
	pumpTcg() {
		if (this.tcgPaused || this.tcgPlaying || !this.tcgQueue.length) return;
		const item = this.tcgQueue[0];
		if (!item.animate) {
			this.tcgQueue.shift();
			this.commitTcg(item, false);
			this.pumpTcg();
			return;
		}
		this.tcgPlaying = true;
		this.tcgFxSnapshot = item.snapshot || null;
		if (!this.tcgSnapshot && item.snapshot) this.tcgSnapshot = item.snapshot;
		this.tcgEvents = item.events || [];
		this.tcgFxKey++;
		this.tcgWait = true;
		this.update(null);
	}
	/** Apply the board for one payload. Logs were already written beat-by-beat when `paced` is set. */
	commitTcg(item: BattleRoom['tcgQueue'][number], paced: boolean) {
		if (item.snapshot) {
			this.tcgSnapshot = item.snapshot;
			if (item.snapshot.status === 'over') {
				this.tcgEnded = true;
				if (this.tcgWinner == null && item.snapshot.winner != null) {
					this.tcgWinner = item.snapshot.players?.[item.snapshot.winner]?.name || null;
				}
			}
		}
		if (item.markEnded) this.tcgEnded = true;
		if (item.winner !== undefined) this.tcgWinner = item.winner;
		if (item.wait != null) this.tcgWait = item.wait;
		else if (item.snapshot) this.tcgWait = !item.snapshot.actions?.length;
		if (!paced && !item.silent && item.events?.length) {
			for (const ev of item.events) this.revealTcgEvent(ev);
		}
		this.tcgFxSnapshot = null;
		this.updateChoiceNotification();
		this.update(null);
	}
	revealTcgEvent(ev: TcgEvent) {
		noteTcgMons(this.tcgSnapshot?.players);
		noteTcgMons(this.tcgFxSnapshot?.players);
		if (typeof ev.seq === 'number' && ev.seq <= this.tcgLastSeq) return;
		if (typeof ev.seq === 'number') this.tcgLastSeq = Math.max(this.tcgLastSeq, ev.seq);
		const players = this.tcgFxSnapshot?.players || this.tcgSnapshot?.players;
		const entry = chatEntryForEvent(ev, players, this.tcgFxSnapshot || this.tcgSnapshot);
		if (!entry) return;
		if (ev.type === 'turn') {
			const esc = (s: string) => String(s || '')
				.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
			this.log?.add(['html',
				`<h2 class="battle-history tcg-turn-head">Turn ${Number(ev.number) || '?'} — ${esc(entry.text)}</h2>`]);
			return;
		}
		this.log?.add(['html', chatHtmlForEntry(entry)]);
	}
	onTcgEvent = (ev: TcgEvent) => {
		this.revealTcgEvent(ev);
		this.update(null);
	};
	/** @returns whether another beat started */
	onTcgFxDone = () => {
		const item = this.tcgQueue.shift();
		this.tcgPlaying = false;
		if (item) this.commitTcg(item, true);
		if (!this.tcgPaused) this.pumpTcg();
		return this.tcgPlaying;
	}
	toggleTcgPause = () => {
		this.tcgPaused = !this.tcgPaused;
		if (!this.tcgPaused) this.pumpTcg();
		else this.update(null);
	};
	/** Jump the board to the newest snapshot. Same idea as Skip to end. */
	skipTcgToEnd = () => {
		this.tcgPaused = false;
		const pending = this.tcgQueue.slice();
		this.tcgQueue = [];
		this.tcgPlaying = false;
		this.tcgHalt++;
		if (pending.length) {
			for (const item of pending) this.commitTcg(item, false);
		} else {
			this.update(null);
		}
	};
	/** Play the stored battle again from the first payload. */
	replayTcg = () => {
		if (!this.tcgHistory.length) return;
		this.tcgSeekIndex = -1;
		this.tcgPaused = false;
		this.replayTcgSeek(this.tcgHistory.length - 1, true);
	};

	override destroy() {
		this.request = null;
		this.choices = null;
		super.destroy();
	}

	loadReplay() {
		const replayid = this.id.slice(7);
		const urls = [
			`https://${Config.routes.replays}/${replayid}.json`,
			`https://replay.pokemonshowdown.com/${replayid}.json`,
		];
		const tryFetch = (i: number): Promise<string> =>
			Net(urls[i]).get().catch(() => (i + 1 < urls.length ? tryFetch(i + 1) : ''));
		tryFetch(0).then(data => {
			try {
				const replay = JSON.parse(data);
				const log = String(replay.log || '');
				if (isTcgBattleId(this.id) || log.includes('|tcgreplay|') || log.trimStart().startsWith('{')) {
					this.tcgMode = true;
					const marker = log.indexOf('|tcgreplay|');
					const raw = marker >= 0 ? log.slice(marker) :
						log.trimStart().startsWith('{') ? log : '';
					if (!raw) throw new Error('no tcg replay');
					this.loadTcgReplayPayload(raw, `[${replay.format}] ${replay.players?.join(' vs. ') || ''}`);
					return;
				}
				if (!this.battle) {
					this.connectError = `Battle "${replayid}" not found`;
					this.update(null);
					return;
				}
				this.title = `[${replay.format}] ${replay.players.join(' vs. ')}`;
				this.battle.stepQueue = log.split('\n');
				this.battle.atQueueEnd = false;
				this.battle.pause();
				this.battle.seekTurn(0);
				this.connectMode = null;
				this.connectError = null;
				this.update(null);
			} catch {
				this.connectError = `Battle "${replayid}" not found`;
				if (this.battle?.stepQueue && !this.battle.stepQueue.length) {
					this.battle.scene.message(
						`<div class="broadcast-red pad"><strong>${BattleLog.escapeHTML(this.connectError)}</strong></div><br />` +
						`The battle you're looking for has expired. Battles expire after 15 minutes of inactivity unless they're saved.<br /><br />` +
						`In the future, remember to click "Save replay" to save a replay permanently.`
					);
				}
				this.update(null);
			}
		});
	}
}

class BattleDiv extends preact.Component<{ room: BattleRoom }> {
	override shouldComponentUpdate() {
		return false;
	}
	override componentDidMount() {
		const room = this.props.room;
		if (room.battle) {
			this.base!.replaceChild(room.battle.scene.$frame![0], this.base!.firstChild!);
		}
	}
	override render() {
		return <div><div class="battle"></div></div>;
	}
}

class TimerButton extends preact.Component<{ room: BattleRoom, top: number, inline?: boolean }> {
	timerInterval: number | null = null;
	override componentWillUnmount() {
		if (this.timerInterval) {
			clearInterval(this.timerInterval);
			this.timerInterval = null;
		}
	}
	secondsToTime(seconds: number | true) {
		if (seconds === true) return '-:--';
		const minutes = Math.floor(seconds / 60);
		seconds -= minutes * 60;
		return `${minutes}:${(seconds < 10 ? '0' : '')}${seconds}`;
	}
	kicking(room: BattleRoom) {
		return room.tcgMode ? room.tcgKickingInactive : room.battle?.kickingInactive;
	}
	render() {
		let time = 'Timer';
		const room = this.props.room;
		const kicking = this.kicking(room);
		if (!this.timerInterval && kicking) {
			this.timerInterval = setInterval(() => {
				if (room.tcgMode) {
					if (typeof room.tcgKickingInactive === 'number' && room.tcgKickingInactive > 1) {
						room.tcgKickingInactive--;
						if (room.tcgTotalTimeLeft) room.tcgTotalTimeLeft--;
					}
				} else {
					if (room.choices?.isDone()) return;
					if (typeof room.battle.kickingInactive === 'number' && room.battle.kickingInactive > 1) {
						room.battle.kickingInactive--;
						if (room.battle.graceTimeLeft) room.battle.graceTimeLeft--;
						else if (room.battle.totalTimeLeft) room.battle.totalTimeLeft--;
					}
				}
				this.forceUpdate();
			}, 1000);
		} else if (this.timerInterval && !kicking) {
			clearInterval(this.timerInterval);
			this.timerInterval = null;
		}

		let timerTicking = '';
		if (room.tcgMode) {
			timerTicking = (room.tcgKickingInactive && room.isTcgPlayer() && !room.tcgWait && !room.tcgEnded) ?
				' timerbutton-on' : '';
		} else {
			timerTicking = (room.battle.kickingInactive &&
				room.request && room.request.requestType !== "wait" && (room.choices && !room.choices.isDone())) ?
				' timerbutton-on' : '';
		}

		if (kicking) {
			const secondsLeft = kicking;
			time = this.secondsToTime(secondsLeft as number | true);
			if (secondsLeft !== true) {
				if ((secondsLeft as number) <= 10 && timerTicking) {
					timerTicking = ' timerbutton-critical';
				}
				const total = room.tcgMode ? room.tcgTotalTimeLeft : room.battle?.totalTimeLeft;
				if (total) {
					// Compact on the TCG HUD so a long "total" line doesn't cover the turn badge.
					time += this.props.inline ?
						` · ${this.secondsToTime(total)}` :
						` |  ${this.secondsToTime(total)} total`;
				}
			}
		}

		return <button
			style={this.props.inline ? undefined : { position: "absolute", right: '10px', top: `${this.props.top}px` }}
			data-href="battletimer" class={`button timerbutton${timerTicking}`} role="timer"
			title={this.props.inline && kicking && typeof kicking === 'number' ?
				`Turn ${this.secondsToTime(kicking)}${room.tcgTotalTimeLeft ? ` · Total ${this.secondsToTime(room.tcgTotalTimeLeft)}` : ''}` :
				undefined}
		>
			<i class="fa fa-hourglass-start" aria-hidden></i> {time}
		</button>;
	}
};

class BattlePanel extends PSRoomPanel<BattleRoom> {
	static readonly id = 'battle';
	static readonly routes = ['battle-*', 'game-*'];
	static readonly Model = BattleRoom;
	static handleDrop(ev: DragEvent) {
		const file = ev.dataTransfer?.files?.[0];
		if (!file) return;
		const isJson = file.type === 'application/json' || /\.json$/i.test(file.name);
		const isHtml = file.type === 'text/html' || /\.html?$/i.test(file.name);
		if (isJson) {
			let roomNum = 1;
			for (; roomNum < 100; roomNum++) {
				if (!PS.rooms[`battle-tcguploaded-${roomNum}`]) break;
			}
			file.text().then(text => {
				try {
					const id = `battle-tcguploaded-${roomNum}` as RoomID;
					PS.join(id);
					const room = PS.rooms[id] as BattleRoom;
					if (!room) return;
					room.tcgMode = true;
					room.connectMode = null;
					const raw = text.includes('|tcgreplay|') ? text : `|tcgreplay|${text.trim().startsWith('{') ? text : JSON.stringify(JSON.parse(text))}`;
					room.loadTcgReplayPayload(raw, file.name.replace(/\.json$/i, ''));
				} catch (err) {
					PS.alert(`Unrecognized TCG replay JSON: ${err}`);
				}
			});
			return true;
		}
		if (isHtml) {
			let roomNum = 1;
			for (; roomNum < 100; roomNum++) {
				if (!PS.rooms[`battle-uploaded-${roomNum}`]) break;
			}
			file.text().then(html => {
				const titleStart = html.indexOf('<title>');
				const titleEnd = html.indexOf('</title>');
				let title = 'Uploaded Replay';
				if (titleStart >= 0 && titleEnd > titleStart) {
					title = html.slice(titleStart + 7, titleEnd - 1);
					const colonIndex = title.indexOf(':');
					const hyphenIndex = title.lastIndexOf('-');
					if (hyphenIndex > colonIndex + 2) {
						title = title.substring(colonIndex + 2, hyphenIndex - 1);
					} else {
						title = title.substring(colonIndex + 2);
					}
				}
				const index1 = html.indexOf('<script type="text/plain" class="battle-log-data">');
				const index2 = html.indexOf('<script type="text/plain" class="log">');
				if (index1 < 0 && index2 < 0) {
					PS.alert("Unrecognized HTML file: Only replay files are supported.");
					return;
				}
				if (index1 >= 0) {
					html = html.slice(index1 + 50);
				} else if (index2 >= 0) {
					html = html.slice(index2 + 38);
				}
				const index3 = html.indexOf('</script>');
				html = html.slice(0, index3);
				html = html.replace(/\\\//g, '/');

				PS.join(`battle-uploaded-${roomNum}` as RoomID);
				const room = PS.rooms[`battle-uploaded-${roomNum}`] as BattleRoom;
				if (!room) return;

				room.title = title;
				room.connectMode = null;
				PS.receive(`>battle-uploaded-${roomNum}\n${html}`);
			});
			return true;
		}
	}
	/** last displayed team. will not show the most recent request until the last one is gone. */
	team: ServerPokemon[] | null = null;
	mobileChatShown = false;
	showMobileChat = () => {
		this.mobileChatShown = true;
		this.forceUpdate();
	};
	showMobileBattle = () => {
		this.mobileChatShown = false;
		this.forceUpdate();
	};
	send = (text: string, elem?: HTMLElement) => {
		this.props.room.send(text, elem);
	};
	focusIfNoSelection = () => {
		if (window.getSelection?.()?.type === 'Range') return;
		this.focus();
	};
	onKey = (e: KeyboardEvent) => {
		if (e.keyCode === 33) { // Pg Up key
			const chatLog = this.base!.getElementsByClassName('chat-log')[0] as HTMLDivElement;
			chatLog.scrollTop = chatLog.scrollTop - chatLog.offsetHeight + 60;
			return true;
		} else if (e.keyCode === 34) { // Pg Dn key
			const chatLog = this.base!.getElementsByClassName('chat-log')[0] as HTMLDivElement;
			chatLog.scrollTop = chatLog.scrollTop + chatLog.offsetHeight - 60;
			return true;
		}
		return false;
	};
	toggleBoostedMove = (e: Event) => {
		const checkbox = e.currentTarget as HTMLInputElement;
		const choices = this.props.room.choices;
		if (!choices) return; // shouldn't happen
		switch (checkbox.name) {
		case 'mega':
			choices.current.mega = checkbox.checked;
			break;
		case 'megax':
			choices.current.megax = checkbox.checked;
			choices.current.megay = false;
			break;
		case 'megay':
			choices.current.megay = checkbox.checked;
			choices.current.megax = false;
			break;
		case 'ultra':
			choices.current.ultra = checkbox.checked;
			break;
		case 'z':
			choices.current.z = checkbox.checked;
			break;
		case 'max':
			choices.current.max = checkbox.checked;
			break;
		case 'tera':
			choices.current.tera = checkbox.checked;
			break;
		}
		this.props.room.update(null);
	};
	override componentDidMount() {
		const room = this.props.room;
		if (room.tcgMode || isTcgBattleId(room.id)) {
			room.tcgMode = true;
			const logEl = this.base!.querySelector<HTMLDivElement>('.battle-log');
			if (logEl) {
				room.log ||= new BattleLog(logEl);
				room.log.getHighlight = room.handleHighlight;
			}
			if (room.backlog) {
				const backlog = room.backlog;
				room.backlog = null;
				for (const line of backlog) this.receiveTcgLine(line);
			}
			super.componentDidMount();
			return;
		}
		const $elem = $(this.base!);
		const battle = (room.battle ||= new Battle({
			id: room.id as any,
			$frame: $elem.find('.battle'),
			$logFrame: $elem.find('.battle-log'),
			log: room.backlog?.map(args => '|' + args.join('|')),
		}));
		const scene = battle.scene as BattleScene;
		room.backlog = null;
		room.log ||= scene.log;
		room.log.getHighlight = room.handleHighlight;
		scene.tooltips.unlisten(scene.$frame);
		scene.tooltips.listen(this.base!);
		super.componentDidMount();
		if (!PS.prefs.spectatefromstart) battle.seekTurn(Infinity);
		if (PS.prefs.autohardcore) {
			battle.setHardcoreMode(true);
		}
		battle.subscribe(() => this.forceUpdate());
	}
	override componentWillUnmount() {
		const scene = this.props.room.battle?.scene as BattleScene | undefined;
		if (this.base) scene?.tooltips.unlisten(this.base);
		super.componentWillUnmount();
	}
	battleHeight = 360;
	updateLayout() {
		if (!this.base) return;
		const room = this.props.room;
		if (!room.width) return;
		const { battleHeight } = this.chooseLayout();
		this.battleHeight = battleHeight;
		if (battleHeight !== 360) {
			room.battle?.scene.$frame!.css('transform', `scale(${battleHeight / 360})`);
		} else {
			room.battle?.scene.$frame!.css('transform', 'none');
		}
	}
	chooseLayout(): {
		layout: BattlePanelLayout,
		battleHeight: number,
		battleWidth: number,
		overlayControls: boolean,
	} {
		const room = this.props.room;
		return PS.chooseBattleLayout(room.width, room.height, PS.prefs.battlelayout);
	}
	fastForwardIfRejoining() {
		const room = this.props.room;
		if (!room.rejoining || !room.side) return;
		room.rejoining = false;
		room.battle.seekTurn(Infinity);
	}
	override receiveLine(args: Args) {
		const room = this.props.room;
		if (room.tcgMode || args[0] === 'tcg' || (args[0] === 'request' && args[1]?.includes('"tcg":true'))) {
			room.tcgMode = true;
			this.receiveTcgLine(args);
			return;
		}
		switch (args[0]) {
		case 'cantleave':
			room.requireForfeit = true;
			return;
		case 'allowleave':
			room.requireForfeit = false;
			return;
		case 'initdone':
			if (!PS.prefs.spectatefromstart) room.battle.seekTurn(Infinity);
			return;
		case 'request':
			this.receiveRequest(args[1] ? JSON.parse(args[1]) : null);
			return;
		case 'win': case 'tie':
			this.receiveRequest(null);
			break;
		case 'c': case 'c:': case 'chat': case 'chatmsg': case 'inactive':
			room.battle.instantAdd('|' + args.join('|'));
			return;
		case 'error':
			if (args[1].startsWith('[Invalid choice]') && room.request) {
				room.choices = new BattleChoiceBuilder(room.request);
				room.updateChoiceNotification();
				room.update(null);
			}
			break;
		case 'sentchoice':
			if (room.request) {
				let choices = new BattleChoiceBuilder(room.request);
				const possibleError = choices.addChoices(args[1]);
				if (possibleError || !choices.isDone()) {
					choices = new BattleChoiceBuilder(room.request);
					choices.serializedChoice = args[1];
				}
				room.choices = choices;
			}
			room.updateChoiceNotification();
			room.update(null);
			return;
		}
		room.battle.add('|' + args.join('|'));
		if (PS.prefs.noanim) this.props.room.battle.seekTurn(Infinity);
	}
	receiveTcgLine(args: Args) {
		const room = this.props.room;
		switch (args[0]) {
		case 'tcg':
			this.applyTcgPayload(JSON.parse(args[1] || '{}'));
			return;
		case 'request':
			if (!args[1]) return;
			this.applyTcgPayload(JSON.parse(args[1]), true);
			return;
		case 'player': {
			// |player|p1|Name|avatar|rating|
			const side = args[1] || '';
			const name = args[2] || '';
			const idx = side === 'p1' ? 0 : side === 'p2' ? 1 : -1;
			if (name && idx === 0) room.tcgP1 = { id: toID(name), name };
			if (name && idx === 1) room.tcgP2 = { id: toID(name), name };
			if (name && room.tcgSnapshot?.players && idx >= 0 && room.tcgSnapshot.players[idx]) {
				room.tcgSnapshot.players[idx].name = name;
				room.update(null);
			}
			return;
		}
		case 'inactive': {
			room.log?.add(args);
			const msg = args[1] || '';
			if (msg.startsWith('Time left: ')) {
				const [time, totalTime] = msg.split(' | ');
				room.tcgKickingInactive = parseInt(time.slice(11), 10) || true;
				room.tcgTotalTimeLeft = parseInt(totalTime || '', 10) || 0;
				if (room.tcgTotalTimeLeft === room.tcgKickingInactive) room.tcgTotalTimeLeft = 0;
			} else if (msg.startsWith('You have ')) {
				room.tcgKickingInactive = parseInt(msg.slice(9), 10) || true;
			} else if (msg.includes('Battle timer is ON')) {
				room.tcgKickingInactive = true;
			} else if (msg.endsWith(' seconds left this turn.') || msg.endsWith(' seconds left.')) {
				const hasIndex = msg.indexOf(' has ');
				if (hasIndex >= 0 && toID(msg.slice(0, hasIndex)) === PS.user.userid) {
					room.tcgKickingInactive = parseInt(msg.slice(hasIndex + 5), 10) || true;
				}
			}
			room.update(null);
			return;
		}
		case 'inactiveoff':
			room.tcgKickingInactive = false;
			room.log?.add(args);
			room.update(null);
			return;
		case 'win': case 'tie': {
			const winnerName = args[0] === 'win' ? (args[1] || '').trim() : '';
			const endingAlready = room.tcgEnded ||
				room.tcgEvents.some(ev => ev.type === 'over') ||
				room.tcgQueue.some(item => item.markEnded || item.events?.some(ev => ev.type === 'over'));
			if (endingAlready) {
				if (args[0] === 'win' && winnerName && !room.tcgWinner) room.tcgWinner = winnerName;
				room.update(null);
				return;
			}
			room.enqueueTcg({
				animate: !PS.prefs.noanim,
				markEnded: true,
				winner: args[0] === 'tie' ? null : (winnerName || null),
				events: [{
					seq: room.tcgLastSeq + 1,
					type: 'over',
					reason: args[0] === 'tie' || !winnerName ? 'Draw' : `${winnerName} won`,
					winnerName: winnerName || undefined,
					tie: args[0] === 'tie' || !winnerName,
				}],
			});
			return;
		}
		case 'html': case 'raw': case 'c': case 'c:': case 'chat': case 'chatmsg':
		case 'error': case 'bigerror': case 'tier':
			room.log?.add(args);
			if (args[0] === 'error') room.update(null);
			return;
		case 'cantleave':
			room.requireForfeit = true;
			return;
		case 'allowleave':
			room.requireForfeit = false;
			return;
		case '-message':
			room.log?.add(['chatmsg', args.slice(1).join('|')]);
			return;
		case 'turn':
			// Event-driven turn headings are written from |tcg| payloads.
			return;
		case 'title':
			if (args[1]) room.title = args[1];
			PS.update();
			return;
		}
		if (args[0] && !['init', 'request', 'done', ''].includes(args[0])) {
			room.log?.add(args);
		}
	}
	applyTcgPayload(data: {
		tcg?: boolean, kind?: string, wait?: boolean, seq?: number,
		snapshot?: TcgSnapshot, events?: TcgEvent[],
	}, skipFx = false) {
		const room = this.props.room;
		if (!data) return;
		if (data.kind === 'watch' && room.tcgSnapshot?.you != null) {
			return;
		}
		if (data.snapshot && !data.snapshot.format?.energyZone &&
			!data.snapshot.players?.some(p => p?.energyZone)) {
			loadPaperNames();
		}
		if (data.snapshot?.you != null) {
			room.tcgSide = data.snapshot.you as 0 | 1;
			room.tcgViewpoint = room.tcgSide;
		}
		if (data.snapshot?.players?.[0]?.name) {
			room.tcgP1 = {
				id: toID(data.snapshot.players[0].id || data.snapshot.players[0].name),
				name: data.snapshot.players[0].name,
			};
		}
		if (data.snapshot?.players?.[1]?.name) {
			room.tcgP2 = {
				id: toID(data.snapshot.players[1].id || data.snapshot.players[1].name),
				name: data.snapshot.players[1].name,
			};
		}
		if (PS.prefs.autotimer && room.isTcgPlayer() && !room.tcgKickingInactive && !room.autoTimerActivated) {
			this.send('/timer on');
			room.autoTimerActivated = true;
		}
		const wait = data.wait != null ? data.wait : (data.snapshot ? !data.snapshot.actions?.length : undefined);
		const ended = data.snapshot?.status === 'over';
		let winner: string | null | undefined;
		if (ended && data.snapshot?.winner != null) {
			winner = data.snapshot.players?.[data.snapshot.winner]?.name || null;
		}
		// The server may send the same batch twice (the opening |tcg| payload is repeated);
		// animate each event once. The silent |request| echo never animates, so it is not counted.
		const fresh = skipFx ? data.events : data.events?.filter(ev => {
			if (typeof ev.seq !== 'number') return true;
			if (ev.seq <= room.tcgSeqSeen) return false;
			room.tcgSeqSeen = ev.seq;
			return true;
		});
		const events = this.hideSetupPlacements(data.snapshot, fresh);
		room.enqueueTcg({
			snapshot: data.snapshot,
			events,
			wait,
			animate: !skipFx && !!events?.length && !PS.prefs.noanim,
			silent: skipFx,
			markEnded: ended || undefined,
			winner,
		});
	}
	/**
	 * Official rules: opening Active and Bench Pokémon are placed face down and only
	 * turned up once both players are ready. The sim still names the other seat's
	 * card in its setup `place` events, so strip that here and show a card back instead.
	 */
	hideSetupPlacements(snapshot: TcgSnapshot | undefined, events: TcgEvent[] | undefined): TcgEvent[] | undefined {
		const room = this.props.room;
		const status = snapshot?.status ?? room.tcgLatestStatus;
		if (snapshot) room.tcgLatestStatus = snapshot.status;
		if (status !== 'setup') {
			room.tcgSetupHidden = {};
			return events;
		}
		const you = snapshot?.you ?? room.tcgSnapshot?.you ?? null;
		const hidden = room.tcgSetupHidden;
		const out = events?.map(ev => {
			if (ev.type !== 'place' || ev.seat == null || ev.seat === you || !ev.iid) return ev;
			const slot = ev.slot === 'active' || ev.slot == null || ev.slot === '' ? 'active' : String(ev.slot);
			hidden[ev.seat] = { ...hidden[ev.seat], [slot]: ev.iid };
			return { ...ev, cardId: '', faceDown: true };
		});
		if (snapshot) {
			Object.keys(hidden).forEach(seatKey => {
				const seat = Number(seatKey);
				const p = snapshot.players?.[seat];
				if (!p || seat === you) return;
				const slots = hidden[seat];
				const placeholder = (iid: string): TcgPokemonView => ({
					iid, cardId: '', name: '', hp: 0, maxHp: 0, faceDown: true,
				});
				if (slots.active && !p.active) p.active = placeholder(slots.active);
				const bench = (p.bench || []).slice();
				Object.keys(slots).forEach(slotKey => {
					if (slotKey === 'active') return;
					const i = Number(slotKey);
					if (!bench[i]) bench[i] = placeholder(slots[slotKey]);
				});
				// No sparse holes: the board maps over this array.
				p.bench = Array.from(bench, m => m || null) as TcgPokemonView[];
			});
		}
		return out;
	}
	sendTcgAction = (action: TcgAction) => {
		const room = this.props.room;
		room.tcgWait = true;
		room.sendDirect(`/choose ${JSON.stringify(action)}`);
		room.update(null);
	};
	receiveRequest(request: BattleRequest | null) {
		const room = this.props.room;
		if (!request) {
			room.request = null;
			room.choices = null;
			room.updateChoiceNotification();
			return;
		}

		if (PS.prefs.autotimer && !room.battle.kickingInactive && !room.autoTimerActivated) {
			this.send('/timer on');
			room.autoTimerActivated = true;
		}

		BattleChoiceBuilder.fixRequest(request, room.battle);

		if (request.side) {
			const wasPlayer = !!room.side;
			room.battle.myPokemon = request.side.pokemon;
			room.battle.setViewpoint(request.side.id);
			room.side = request.side;
			if (!wasPlayer) this.fastForwardIfRejoining();
		}
		if (request.ally) {
			room.battle.myAllyPokemon = request.ally.pokemon;
		}

		room.request = request;
		room.choices = new BattleChoiceBuilder(request);
		// A reconnect can send `|sentchoice|` immediately after `|request|`.
		// Wait until the entire protocol message has been processed before notifying.
		Promise.resolve().then(() => room.updateChoiceNotification());
		room.update(null);
	}
	renderConnectError() {
		const room = this.props.room;
		if (room.connectMode !== 'deleted' && room.connectMode !== 'not-found') {
			return null;
		}
		return <div class="pad"><div class="broadcast-red pad">
			<h3>{room.connectError || "Error"}</h3>
			<p class="buttonbar"><button class="button" data-cmd="/close"><strong>Close</strong></button></p>
		</div></div>;
	}
	renderControls(overlayVersion = false, hidePlayerControls = false) {
		const room = this.props.room;
		if (!room.battle) return null;
		if (overlayVersion) {
			if (!room.side || !room.request || room.battle.ended) return null;
			return this.renderPlayerControls(room.request, true);
		}
		if (room.battle.ended) return this.renderAfterBattleControls();
		if (room.side && room.request) {
			if (hidePlayerControls) return null;
			return this.renderPlayerControls(room.request);
		}
		if (room.battle.stepQueue.length === 0) return null;

		const atStart = !room.battle.started;
		const atEnd = room.battle.atQueueEnd;
		return <div class="inline-controls">
			<p>
				{atEnd ? (
					<button class="button disabled" aria-disabled data-cmd="/play" style="min-width:4.5em">
						<i class="fa fa-play" aria-hidden></i><br />Play
					</button>
				) : room.battle.paused ? (
					<button class="button" data-cmd="/play" style="min-width:4.5em">
						<i class="fa fa-play" aria-hidden></i><br />Play
					</button>
				) : (
					<button class="button" data-cmd="/pause" style="min-width:4.5em">
						<i class="fa fa-pause" aria-hidden></i><br />Pause
					</button>
				)} {}
				{!room.battle.hardcoreMode && <>
					<button class={"button button-first" + (atStart ? " disabled" : "")} data-cmd="/ffto 0" style="margin-right:2px">
						<i class="fa fa-undo" aria-hidden></i><br />First turn
					</button>
					<button class={"button button-first" + (atStart ? " disabled" : "")} data-cmd="/ffto -1">
						<i class="fa fa-step-backward" aria-hidden></i><br />Prev turn
					</button>
					<button class={"button button-last" + (atEnd ? " disabled" : "")} data-cmd="/ffto +1" style="margin-right:2px">
						<i class="fa fa-step-forward" aria-hidden></i><br />Skip turn
					</button>
					<button class={"button button-last" + (atEnd ? " disabled" : "")} data-cmd="/ffto end">
						<i class="fa fa-fast-forward" aria-hidden></i><br />Skip to end
					</button>
				</>}
			</p>
			<p>
				<button class="button" data-cmd="/switchsides">
					<i class="fa fa-random" aria-hidden></i> Switch viewpoint
				</button> {}
				{!room.battle.hardcoreMode && <button class="button" data-cmd="/ffto">
					<i class="fa fa-random" aria-hidden></i> Go to turn
				</button>}
			</p>
		</div>;
	}
	renderMoveButton(props: {
		name: string, cmd: string, type: Dex.TypeName, tags: string, tooltip: string,
		moveData: { pp?: number, maxpp?: number, disabled?: boolean },
	} | null) {
		if (!props) {
			return <button class="movebutton" disabled>&nbsp;</button>;
		}
		const pp = props.moveData.maxpp ? `${props.moveData.pp!}/${props.moveData.maxpp}` : '\u2014';
		return <button
			data-cmd={props.cmd} data-tooltip={props.tooltip}
			class={`movebutton has-tooltip ${props.moveData.disabled ? 'disabled' : `type-${props.type}`}`}
			aria-disabled={props.moveData.disabled}
		>
			{props.name}<br />
			<small class="type">{props.type} <span class="effectiveness-icon">{props.tags}</span></small> {}
			<small class="pp">{pp}</small>&nbsp;
		</button>;
	}
	renderPokemonButton(props: {
		pokemon: Pokemon | ServerPokemon | null, cmd: string, noHPBar?: boolean, disabled?: boolean | 'fade', tooltip: string,
	}) {
		const pokemon = props.pokemon;
		if (!pokemon) {
			return <button
				data-cmd={props.cmd} class={`${props.disabled ? 'disabled ' : ''}has-tooltip`}
				aria-disabled={props.disabled}
				style={props.disabled === 'fade' ? 'opacity: 0.5' : ''} data-tooltip={props.tooltip}
			>
				(empty slot)
			</button>;
		}

		let hpColorClass;
		switch (BattleScene.getHPColor(pokemon)) {
		case 'y': hpColorClass = 'hpbar hpbar-yellow'; break;
		case 'r': hpColorClass = 'hpbar hpbar-red'; break;
		default: hpColorClass = 'hpbar'; break;
		}

		return <button
			data-cmd={props.cmd} class={`${props.disabled ? 'disabled ' : ''}has-tooltip`}
			aria-disabled={props.disabled}
			style={props.disabled === 'fade' ? 'opacity: 0.5' : ''} data-tooltip={props.tooltip}
		>
			{PSIcon({ pokemon })}
			{pokemon.name}
			{
				!props.noHPBar && !pokemon.fainted &&
				<span class={hpColorClass}>
					<span style={{ width: Math.round(pokemon.hp * 92 / pokemon.maxhp) || 1 }}></span>
				</span>
			}
			{!props.noHPBar && pokemon.status && <span class={`status ${pokemon.status}`}></span>}
		</button>;
	}
	renderMoveMenu(choices: BattleChoiceBuilder, overlayVersion?: boolean) {
		const moveRequest = choices.currentMoveRequest()!;

		const canDynamax = moveRequest.canDynamax && !choices.alreadyMax;
		const canMegaEvo = moveRequest.canMegaEvo && !choices.alreadyMega;
		const canMegaEvoX = moveRequest.canMegaEvoX && !choices.alreadyMega;
		const canMegaEvoY = moveRequest.canMegaEvoY && !choices.alreadyMega;
		const canZMove = moveRequest.zMoves && !choices.alreadyZ;
		const canUltraBurst = moveRequest.canUltraBurst;
		const canTerastallize = moveRequest.canTerastallize;

		const maybeDisabled = moveRequest.maybeDisabled;
		const maybeLocked = moveRequest.maybeLocked;

		return <div class="movemenu">
			{maybeDisabled && <p><em class="movewarning">
				You <strong>might</strong> have some moves disabled, so you won't be able to cancel an attack!
			</em></p>}
			{maybeLocked && <p><em class="movewarning">
				You <strong>might</strong> be locked into a move. {}
				<button class="button" data-cmd="/choose testfight">Try Fight button</button> {}
				(prevents switching if you're locked)
			</em></p>}
			{!overlayVersion && this.renderMoveControls(moveRequest, choices)}
			<div class="megaevo-box">
				{canDynamax && <label class={`megaevo${choices.current.max ? ' cur' : ''}`}>
					<input type="checkbox" name="max" checked={choices.current.max} onChange={this.toggleBoostedMove} /> {}
					{moveRequest.gigantamax ? 'Gigantamax' : 'Dynamax'}
				</label>}
				{canMegaEvo && <label class={`megaevo${choices.current.mega ? ' cur' : ''}`}>
					<input type="checkbox" name="mega" checked={choices.current.mega} onChange={this.toggleBoostedMove} /> {}
					Mega Evolution
				</label>}
				{canMegaEvoX && <label class={`megaevo${choices.current.mega ? ' cur' : ''}`}>
					<input type="checkbox" name="megax" checked={choices.current.megax} onChange={this.toggleBoostedMove} /> {}
					Mega Evolution X
				</label>}
				{canMegaEvoY && <label class={`megaevo${choices.current.mega ? ' cur' : ''}`}>
					<input type="checkbox" name="megay" checked={choices.current.megay} onChange={this.toggleBoostedMove} /> {}
					Mega Evolution Y
				</label>}
				{canUltraBurst && <label class={`megaevo${choices.current.ultra ? ' cur' : ''}`}>
					<input type="checkbox" name="ultra" checked={choices.current.ultra} onChange={this.toggleBoostedMove} /> {}
					Ultra Burst
				</label>}
				{canZMove && <label class={`megaevo${choices.current.z ? ' cur' : ''}`}>
					<input type="checkbox" name="z" checked={choices.current.z} onChange={this.toggleBoostedMove} /> {}
					Z-Power
				</label>}
				{canTerastallize && <label class={`megaevo${choices.current.tera ? ' cur' : ''}`}>
					<input type="checkbox" name="tera" checked={choices.current.tera} onChange={this.toggleBoostedMove} /> {}
					Tera {PSIcon({ type: canTerastallize, new: true, tera: true })}
				</label>}
			</div>
			{overlayVersion && this.renderMoveControls(moveRequest, choices)}
		</div>;
	}
	renderMoveControls(active: BattleRequestActivePokemon, choices: BattleChoiceBuilder) {
		const battle = this.props.room.battle;
		const dex = battle.dex;
		const pokemonIndex = choices.index();
		const activeIndex = battle.mySide.n > 1 ? pokemonIndex + battle.pokemonControlled : pokemonIndex;
		const serverPokemon = choices.request.side!.pokemon[pokemonIndex];
		const valueTracker = new ModifiableValue(battle, battle.nearSide.active[activeIndex]!, serverPokemon);
		const tooltips = (battle.scene as BattleScene).tooltips;

		if (choices.current.max || (active.maxMoves && !active.canDynamax)) {
			if (!active.maxMoves) {
				return <div class="message-error">Maxed with no max moves</div>;
			}
			const gmax = active.gigantamax && dex.moves.get(active.gigantamax);
			return active.moves.map((moveData, i) => {
				const move = dex.moves.get(moveData.name);
				const [moveType, tags] = tooltips.getMoveTypeText(move, valueTracker, gmax || true);
				let maxMoveData: { name: string, id: ID } = active.maxMoves![i];
				if (maxMoveData.name !== 'Max Guard') {
					maxMoveData = tooltips.getMaxMoveFromType(moveType, gmax);
				}
				const gmaxTooltip = maxMoveData.id.startsWith('gmax') ? `|${maxMoveData.id}` : ``;
				const tooltip = `maxmove|${moveData.name}|${pokemonIndex}${gmaxTooltip}`;
				return this.renderMoveButton({
					name: maxMoveData.name,
					cmd: `/move ${i + 1} max`,
					type: moveType,
					tags,
					tooltip,
					moveData,
				});
			});
		}

		if (choices.current.z) {
			if (!active.zMoves) {
				return <div class="message-error">No Z moves</div>;
			}
			return active.moves.map((moveData, i) => {
				const zMoveData = active.zMoves![i];
				if (!zMoveData) {
					return this.renderMoveButton(null);
				}
				const specialMove = dex.moves.get(zMoveData.name);
				const move = specialMove.exists ? specialMove : dex.moves.get(moveData.name);
				const [moveType, tags] = tooltips.getMoveTypeText(move, valueTracker);
				const tooltip = `zmove|${moveData.name}|${pokemonIndex}`;
				return this.renderMoveButton({
					name: zMoveData.name,
					cmd: `/move ${i + 1} zmove`,
					type: moveType,
					tags,
					tooltip,
					moveData: { pp: 1, maxpp: 1 },
				});
			});
		}

		const special = choices.moveSpecial(choices.current);
		return active.moves.map((moveData, i) => {
			const move = dex.moves.get(moveData.name);
			const [moveType, tags] = tooltips.getMoveTypeText(move, valueTracker);
			const tooltip = `move|${moveData.name}|${pokemonIndex}`;
			return this.renderMoveButton({
				name: move.name,
				cmd: `/move ${i + 1}${special}`,
				type: moveType,
				tags,
				tooltip,
				moveData,
			});
		});
	}
	renderMoveTargetControls(request: BattleMoveRequest, choices: BattleChoiceBuilder) {
		const battle = this.props.room.battle;
		let moveTarget = choices.currentMove()?.target;
		if ((moveTarget === 'adjacentAlly' || moveTarget === 'adjacentFoe') && battle.gameType === 'freeforall') {
			moveTarget = 'normal';
		}
		const moveChoice = choices.stringChoice(choices.current);

		const userSlot = choices.index() + Math.floor(battle.mySide.n / 2) * battle.pokemonControlled;
		const userSlotCross = battle.farSide.active.length - 1 - userSlot;

		return <>
			{battle.farSide.active.map((pokemon, i) => {
				let disabled = false;
				if (moveTarget === 'adjacentAlly' || moveTarget === 'adjacentAllyOrSelf') {
					disabled = true;
				} else if (moveTarget === 'normal' || moveTarget === 'adjacentFoe') {
					if (Math.abs(userSlotCross - i) > 1) disabled = true;
				}

				if (pokemon?.fainted) pokemon = null;
				return this.renderPokemonButton({
					pokemon,
					cmd: disabled ? `` : `/${moveChoice} +${i + 1}`,
					disabled: disabled && 'fade',
					tooltip: `activepokemon|1|${i}`,
				});
			}).reverse()}
			<div style={{ clear: 'left' }}></div>
			{battle.nearSide.active.map((pokemon, i) => {
				let disabled = false;
				if (moveTarget === 'adjacentFoe') {
					disabled = true;
				} else if (moveTarget === 'normal' || moveTarget === 'adjacentAlly' || moveTarget === 'adjacentAllyOrSelf') {
					if (Math.abs(userSlot - i) > 1) disabled = true;
				}
				if (moveTarget !== 'adjacentAllyOrSelf' && userSlot === i) disabled = true;

				if (pokemon?.fainted) pokemon = null;
				return this.renderPokemonButton({
					pokemon,
					cmd: disabled ? `` : `/${moveChoice} -${i + 1}`,
					disabled: disabled && 'fade',
					tooltip: `activepokemon|0|${i}`,
				});
			})}
		</>;
	}
	renderSwitchMenu(
		request: BattleMoveRequest | BattleSwitchRequest, choices: BattleChoiceBuilder, ignoreTrapping?: boolean
	) {
		const numActive = choices.requestLength();
		const maybeTrapped = !ignoreTrapping && choices.currentMoveRequest()?.maybeTrapped;
		const trapped = !ignoreTrapping && !maybeTrapped && choices.currentMoveRequest()?.trapped;
		const isReviving = choices.isReviving();

		return <div class="switchmenu">
			{maybeTrapped && <em class="movewarning">
				You <strong>might</strong> be trapped, so you won't be able to cancel a switch!<br />
			</em>}
			{trapped && <em class="movewarning">
				You're <strong>trapped</strong> and cannot switch!<br />
			</em>}
			{isReviving && <em class="movewarning">
				Choose a Pokémon to revive!<br />
			</em>}
			{request.side.pokemon.map((serverPokemon, i) => {
				let cantSwitch = trapped || i < numActive || choices.alreadySwitchingIn.includes(i + 1) || serverPokemon.fainted;
				if (isReviving) cantSwitch = !serverPokemon.fainted || choices.alreadySwitchingIn.includes(i + 1);
				return this.renderPokemonButton({
					pokemon: serverPokemon,
					cmd: `/switch ${i + 1}`,
					disabled: cantSwitch,
					tooltip: `switchpokemon|${i}`,
				});
			})}
			{request.ally?.pokemon?.map((serverPokemon, i) => {
				return this.renderPokemonButton({
					pokemon: serverPokemon,
					cmd: `/switch notMine`,
					disabled: true,
					tooltip: `allypokemon|${i}`,
				});
			})}
		</div>;
	}
	renderTeamPreviewChooser(request: | BattleTeamRequest, choices: BattleChoiceBuilder) {
		return request.side.pokemon.map((serverPokemon, i) => {
			const cantSwitch = choices.alreadySwitchingIn.includes(i + 1);
			return this.renderPokemonButton({
				pokemon: serverPokemon,
				cmd: `/switch ${i + 1}`,
				disabled: cantSwitch && 'fade',
				tooltip: `switchpokemon|${i}`,
			});
		});
	}
	renderTeamList(overlayVersion = false) {
		const team = this.team;
		if (!team) return;
		return <div class="switchcontrols">
			{!overlayVersion && <h3 class="switchselect">Team</h3>}
			<div class="switchmenu">
				{team.map((serverPokemon, i) => {
					return this.renderPokemonButton({
						pokemon: serverPokemon,
						cmd: "",
						disabled: true,
						tooltip: `switchpokemon|${i}`,
					});
				})}
			</div>
		</div>;
	}
	renderChosenTeam(request: BattleTeamRequest, choices: BattleChoiceBuilder) {
		return choices.alreadySwitchingIn.map(slot => {
			const serverPokemon = request.side.pokemon[slot - 1];
			return this.renderPokemonButton({
				pokemon: serverPokemon,
				cmd: `/switch ${slot}`,
				tooltip: `switchpokemon|${slot - 1}`,
			});
		});
	}
	renderOldChoices(request: BattleRequest, choices: BattleChoiceBuilder, overlayVersion = false) {
		if (!choices) return null; // should not happen
		if (
			(request.requestType !== 'move' && request.requestType !== 'switch' && request.requestType !== 'team') ||
			choices.isEmpty()
		) {
			return null;
		}

		let buf: preact.ComponentChild[] = [
			<button data-cmd="/cancelone" class="button"><i class="fa fa-chevron-left" aria-hidden></i> Back</button>, ' ',
		];
		if (choices.isDone() && (
			choices.noCancel || this.props.room.battle.hardcoreMode ||
			(choices.choices.length <= 1 && !overlayVersion)
		)) {
			buf = [];
		}

		if (choices.serializedChoice) {
			if (choices.serializedChoice === 'default') {
				return [`Automatic choice`, <br />];
			}
			return [`Unrecognized choice from server: `, <code>{choices.serializedChoice}</code>, <br />];
		}

		const battle = this.props.room.battle;
		let teamList = false;
		for (let i = 0; i < choices.choices.length; i++) {
			const choiceString = choices.choices[i];
			if (choiceString === "testfight") {
				buf.push(`${request.side.pokemon[i].name} is locked into a move.`);
				return buf;
			}
			let choice;
			try {
				choice = choices.parseChoice(choiceString, i);
			} catch (err: any) {
				buf.push(<span class="message-error">{err.message}</span>);
			}
			if (!choice) continue;
			const pokemon = request.side.pokemon[i];
			const active = request.requestType === 'move' ? request.active[i] : null;
			if (choice.choiceType === 'move') {
				buf.push(`${pokemon.name} will `);
				if (choice.mega) buf.push(<strong>Mega</strong>, ` Evolve and `);
				if (choice.megax) buf.push(<strong>Mega</strong>, ` Evolve (X) and `);
				if (choice.megay) buf.push(<strong>Mega</strong>, ` Evolve (Y) and `);
				if (choice.ultra) buf.push(<strong>Ultra</strong>, ` Burst and `);
				if (choice.tera) buf.push(`Terastallize (`, <strong>{active?.canTerastallize || '???'}</strong>, `) and `);
				if (choice.max && active?.canDynamax) buf.push(active?.gigantamax ? `Gigantamax and ` : `Dynamax and `);
				buf.push(`use `, <strong>{choices.currentMove(choice, i)?.name}</strong>);
				if (choice.targetLoc > 0) {
					const target = battle.farSide.active[choice.targetLoc - 1];
					if (!target) {
						buf.push(` at slot ${choice.targetLoc}`);
					} else {
						buf.push(` at ${target.name}`);
					}
				} else if (choice.targetLoc < 0) {
					const target = battle.nearSide.active[-choice.targetLoc - 1];
					const ally = battle.gameType !== 'freeforall' ? 'ally' : '';
					if (!target) {
						buf.push(` at ${ally} slot ${choice.targetLoc}`);
					} else {
						buf.push(` at ${ally} ${target.name}`);
					}
				}
				buf.push(`.`);
			} else if (choice.choiceType === 'switch') {
				const target = request.side.pokemon[choice.targetPokemon - 1];
				if (choices.isReviving(i)) {
					buf.push(`${pokemon.name} will revive `, <strong>{target.name}</strong>, `.`);
				} else {
					buf.push(`${pokemon.name} will switch to `, <strong>{target.name}</strong>, `.`);
				}
			} else if (choice.choiceType === 'shift') {
				buf.push(`${pokemon.name} will `, <strong>shift</strong>, ` to the center.`);
			} else if (choice.choiceType === 'team') {
				const target = request.side.pokemon[choice.targetPokemon - 1];
				buf.push(teamList ? `, ` : `You picked `, <strong>{target.name}</strong>);
				teamList = true;
			}
			if (!teamList) buf.push(<br />);
		}
		if (teamList) {
			buf.push('.', <br />);
		}
		return buf;
	}
	overlayControlClass(overlay: 'move' | 'switch') {
		return `button ${overlay}-button${this.props.room.overlayActive === overlay ? ' cur' : ''}`;
	}
	renderPlayerAnimationControls(overlayVersion = false) {
		const room = this.props.room;
		if (overlayVersion) {
			const canSkip = !room.battle.hardcoreMode;
			return <>
				{canSkip && <div class="overlay-controls-skip">
					<button class="button" data-cmd="/ffto end"><i class="fa fa-fast-forward" aria-hidden></i><br />Skip</button>
				</div>}
			</>;
		}
		return <div class="inline-controls">
			{!room.battle.hardcoreMode && <div class="whatdo" style="padding-bottom:0">
				<button class="button" data-cmd="/ffto end"><i class="fa fa-fast-forward" aria-hidden></i><br />Skip animation</button>
			</div>}
			{this.renderTeamList()}
		</div>;
	}
	renderPlayerMoveControls(request: BattleMoveRequest, choices: BattleChoiceBuilder, overlayVersion = false) {
		const room = this.props.room;
		const index = choices.index();
		const pokemon = request.side.pokemon[index];

		if (choices.current.move) {
			const moveName = choices.currentMove()?.name;
			if (overlayVersion) {
				return <>
					<div class="overlay-controls-list">
						<button class="button move-button cur"><strong>Battle</strong></button> {}
						<button class="button switch-button disabled"><strong>Switch</strong></button>
					</div>
					<div class="targetcontrols">
						<p class="overlay-message">
							{this.renderOldChoices(request, choices, true)}
							{pokemon.name} should use <strong>{moveName}</strong> at where?
						</p>
						<div class="switchmenu">
							{this.renderMoveTargetControls(request, choices)}
						</div>
					</div>
				</>;
			}
			return <div class="inline-controls">
				<div class="whatdo">
					{this.renderOldChoices(request, choices)}
					{pokemon.name} should use <strong>{moveName}</strong> at where? {}
				</div>
				<div class="switchcontrols">
					<div class="switchmenu">
						{this.renderMoveTargetControls(request, choices)}
					</div>
				</div>
			</div>;
		}

		const canShift = room.battle.gameType === 'triples' && index !== 1;

		if (overlayVersion) {
			return <>
				<div class="overlay-controls-list">
					<button class={this.overlayControlClass('move')} data-cmd="/movemenu"><strong>Battle</strong></button> {}
					<button class={this.overlayControlClass('switch')} data-cmd="/switchmenu"><strong>Switch</strong></button>
				</div>
				{!room.overlayActive && <div class="whatdo">
					{this.renderOldChoices(request, choices, true)}
					What will <strong>{pokemon.name}</strong> do?
				</div>}
				{room.overlayActive === 'move' && <div class="movecontrols">
					{this.renderMoveMenu(choices, true)}
				</div>}
				{room.overlayActive === 'switch' && <div class="switchcontrols">
					{canShift && (
						<button data-cmd="/shift">Move to center</button>
					)}
					{this.renderSwitchMenu(request, choices)}
				</div>}
			</>;
		}
		return <div class="inline-controls">
			<div class="whatdo">
				{this.renderOldChoices(request, choices)}
				What will <strong>{pokemon.name}</strong> do?
			</div>
			<div class="movecontrols">
				<h3 class="moveselect">Battle</h3>
				{this.renderMoveMenu(choices)}
			</div>
			<div class="switchcontrols">
				{canShift && [
					<h3 class="shiftselect">Shift</h3>,
					<button data-cmd="/shift">Move to center</button>,
				]}
				<h3 class="switchselect">Switch</h3>
				{this.renderSwitchMenu(request, choices)}
			</div>
		</div>;
	}
	renderPlayerSwitchControls(request: BattleSwitchRequest, choices: BattleChoiceBuilder, overlayVersion = false) {
		const pokemon = request.side.pokemon[choices.index()];
		const prompt = choices.isReviving() ?
			<>Who will <strong>{pokemon.name}</strong> revive?</> :
			<>Who will replace <strong>{pokemon.name}</strong>?</>;
		if (overlayVersion) {
			return <>
				<div class="overlay-controls-list">
					<button class="button switch-button cur"><strong>Switch</strong></button>
				</div>
				<div class="switchcontrols">
					<p class="overlay-message">
						{this.renderOldChoices(request, choices, true)}
						{prompt}
					</p>
					{this.renderSwitchMenu(request, choices, true)}
				</div>
			</>;
		}
		return <div class="inline-controls">
			<div class="whatdo">
				{this.renderOldChoices(request, choices)}
				{prompt}
			</div>
			<div class="switchcontrols">
				<h3 class="switchselect">Switch</h3>
				{this.renderSwitchMenu(request, choices, true)}
			</div>
		</div>;
	}
	renderPlayerTeamPreviewControls(request: BattleTeamRequest, choices: BattleChoiceBuilder, overlayVersion = false) {
		const prompt = choices.alreadySwitchingIn.length > 0 ? (
			[<button data-cmd="/cancelone" class="button"><i class="fa fa-chevron-left" aria-hidden></i> Back</button>,
				" What about the rest of your team? "]
		) : (
			"How will you start the battle? "
		);
		const chosenTeamSizeLabel = (request.chosenTeamSize || 0) > 1 ? ` / ${request.chosenTeamSize!}` : '';
		const chooseLabel = choices.alreadySwitchingIn.length <= 0 ?
			`lead${chosenTeamSizeLabel}` : `slot ${choices.alreadySwitchingIn.length + 1}${chosenTeamSizeLabel}`;
		if (overlayVersion) {
			return <>
				<div class="overlay-controls-list">
					<button class="button switch-button cur"><strong>Team</strong></button>
				</div>
				<div class="teamcontrols">
					<p class="overlay-message">{prompt}</p>
					<h3 class="switchselect">Choose {chooseLabel}</h3>
					<div class="switchmenu">
						{this.renderTeamPreviewChooser(request, choices)}
						<div style="clear:left"></div>
					</div>
					{choices.alreadySwitchingIn.length > 0 && <>
						<h3 class="switchselect">Team so far</h3>
						<div class="switchmenu">
							{this.renderChosenTeam(request, choices)}
						</div>
					</>}
				</div>
			</>;
		}
		return <div class="inline-controls">
			<div class="whatdo">
				{prompt}
			</div>
			<div class="switchcontrols">
				<h3 class="switchselect">
					Choose {chooseLabel}
				</h3>
				<div class="switchmenu">
					{this.renderTeamPreviewChooser(request, choices)}
					<div style="clear:left"></div>
				</div>
			</div>
			<div class="switchcontrols">
				{choices.alreadySwitchingIn.length > 0 && <h3 class="switchselect">Team so far</h3>}
				<div class="switchmenu">
					{this.renderChosenTeam(request, choices)}
				</div>
			</div>
		</div>;
	}
	renderPlayerControls(request: BattleRequest, overlayVersion = false) {
		const room = this.props.room;
		const atEnd = room.battle.atQueueEnd;
		if (!atEnd) return this.renderPlayerAnimationControls(overlayVersion);

		let choices = room.choices;
		if (!choices) return 'Error: Missing BattleChoiceBuilder';
		if (choices.request !== request) {
			choices = new BattleChoiceBuilder(request);
			room.choices = choices;
			room.overlayActive = null;
		}

		if (choices.isDone()) {
			if (overlayVersion) {
				return <>
					<div class="overlay-controls-list">
						<button class={this.overlayControlClass('switch')} data-cmd="/switchmenu"><strong>Team</strong></button>
					</div>
					{!room.overlayActive && <div class="whatdo">
						{this.renderOldChoices(request, choices, true)}
					</div>}
					{room.overlayActive === 'switch' && this.renderTeamList(true)}
				</>;
			}
			return <div class="inline-controls">
				<div class="whatdo">
					{this.renderOldChoices(request, choices)}
					<em>Waiting for opponent...</em> {choices.noCancel || room.battle.hardcoreMode ?
						null : <button data-cmd="/cancel" class="button">Cancel</button>}
				</div>
				{this.renderTeamList()}
			</div>;
		}
		if (request.side) {
			room.battle.myPokemon = request.side.pokemon;
			this.team = request.side.pokemon;
		}
		switch (request.requestType) {
		case 'move':
			return this.renderPlayerMoveControls(request, choices, overlayVersion);
		case 'switch':
			return this.renderPlayerSwitchControls(request, choices, overlayVersion);
		case 'team':
			return this.renderPlayerTeamPreviewControls(request, choices, overlayVersion);
		}
		return null;
	}

	renderAfterBattleControls() {
		const room = this.props.room;
		const isNotTiny = room.width > 700;
		return <div class="inline-controls">
			<p>
				<span style="float: right">
					<a
						onClick={this.handleDownloadReplay}
						href={`//${Config.routes.replays}/download`}
						class="button replayDownloadButton"
					>
						<i class="fa fa-download" aria-hidden></i> Download replay</a>
					<br />
					<br />
					<button class="button" data-cmd="/savereplay">
						<i class="fa fa-upload" aria-hidden></i> Upload and share replay
					</button>
				</span>

				<button class="button" data-cmd="/play" style="min-width:4.5em">
					<i class="fa fa-undo" aria-hidden></i><br />Replay
				</button> {}
				{isNotTiny && !room.battle.hardcoreMode && <>
					<button class="button button-first" data-cmd="/ffto 0" style="margin-right:2px">
						<i class="fa fa-undo" aria-hidden></i><br />First turn
					</button>
					<button class="button button-first" data-cmd="/ffto -1">
						<i class="fa fa-step-backward" aria-hidden></i><br />Prev turn
					</button>
				</>}
			</p>
			{room.side ? (
				<p>
					<button class="button" data-cmd="/close">
						<strong>Main menu</strong><br /><small>(closes this battle)</small>
					</button> {}
					<button class="button" data-cmd={`/closeand /challenge ${room.battle.farSide.id},${room.battle.tier}`}>
						<strong>Rematch</strong><br /><small>(closes this battle)</small>
					</button>
				</p>
			) : (
				<p>
					<button class="button" data-cmd="/switchsides"><i class="fa fa-random" aria-hidden></i> Switch viewpoint</button> {}
					{!room.battle.hardcoreMode && <button class="button" data-cmd="/ffto">
						<i class="fa fa-random" aria-hidden></i> Go to turn
					</button>}
				</p>
			)}
		</div>;
	}

	handleDownloadReplay = (e: MouseEvent) => {
		let room = this.props.room;
		const target = e.currentTarget as HTMLAnchorElement;
		let date = new Date();
		const stamp = `${date.getFullYear()}-${date.getMonth() >= 9 ? '' : '0'}${date.getMonth() + 1}` +
			`-${date.getDate() >= 10 ? '' : '0'}${date.getDate()}`;
		if (room.tcgMode) {
			const filename = `${room.tcgFormatId()}-${stamp}-${toID(room.tcgP1.name)}-${toID(room.tcgP2.name)}`;
			const blob = new Blob([room.buildTcgReplayDownload()], { type: 'application/json' });
			target.href = URL.createObjectURL(blob);
			target.download = filename + '.json';
			e.stopPropagation();
			return;
		}
		let filename = (room.battle.tier || 'Battle').replace(/[^A-Za-z0-9]/g, '');
		filename += `-${stamp}`;
		filename += '-' + toID(room.battle.p1.name);
		filename += '-' + toID(room.battle.p2.name);
		target.href = window.BattleLog.createReplayFileHref(room);
		target.download = filename + '.html';
		e.stopPropagation();
	};

	renderTcgControls() {
		const room = this.props.room;
		const ended = room.tcgEnded || room.tcgReplayMode;
		const isPlayer = room.isTcgPlayer();
		const isSpec = room.isTcgSpectator();
		const atEnd = room.tcgSeekIndex < 0 && !room.tcgQueue.length;
		const atStart = room.tcgSeekIndex === 0 ||
			(room.tcgSeekIndex < 0 && room.tcgHistory.length <= 1 && !room.tcgQueue.length);
		const canScrub = ended || (isSpec && !ended);
		// The server drops the game (and its timer) as soon as the match ends, while the client
		// is still animating the final beats; hide Timer from the latest server status, not the FX one.
		const showTimer = isPlayer && !ended && room.tcgLatestStatus !== 'over';
		const showSpecLive = !ended && isSpec;
		const showScrub = ended && canScrub;
		const showEndPlayer = ended && isPlayer && !room.tcgReplayMode;
		const showEndSpec = ended && isSpec;
		if (!showTimer && !showSpecLive && !showScrub && !showEndPlayer && !showEndSpec) return null;

		const mode = ended ? 'ended' : showSpecLive ? 'spec' : 'live';
		// Viewing an earlier turn: the result banner is hidden, so centre the bar in the mid-board gap.
		const scrubbing = ended && room.tcgSnapshot?.status !== 'over';
		return <div
			class={`tcg-chrome ${mode}${scrubbing ? ' scrubbing' : ''}`}
			role="complementary"
			aria-label="TCG Battle Controls"
		>
			{showTimer && <TimerButton room={room} top={0} inline />}
			{showSpecLive && <div class="tcg-chrome-group" aria-label="Spectator controls">
				{room.tcgPaused || !room.tcgPlaying ? (
					<button class="button" data-cmd="/play" title="Play">
						<i class="fa fa-play" aria-hidden></i>
					</button>
				) : (
					<button class="button" data-cmd="/pause" title="Pause">
						<i class="fa fa-pause" aria-hidden></i>
					</button>
				)}
				<button class="button" data-cmd="/ffto end" title="Skip to end">
					<i class="fa fa-fast-forward" aria-hidden></i>
				</button>
				<button class="button" data-cmd="/switchsides" title="Switch viewpoint">
					<i class="fa fa-random" aria-hidden></i>
				</button>
			</div>}
			{ended && <div class="tcg-chrome-bar">
				{showEndPlayer && <div class="tcg-chrome-group" aria-label="Match controls">
					<button class="button" data-cmd="/close">Menu</button>
					{!!room.tcgOpponentId() && <button
						class="button"
						data-cmd={`/closeand /challenge ${room.tcgOpponentId()},${room.tcgFormatId()}`}
					>
						Rematch
					</button>}
					<a
						onClick={this.handleDownloadReplay}
						href={`//${Config.routes.replays}/download`}
						class="button replayDownloadButton"
						title="Download replay"
					>
						<i class="fa fa-download" aria-hidden></i>
					</a>
					{!room.tcgReplayMode && <button
						class="button" data-cmd="/savereplay" title="Upload and share replay"
					>
						<i class="fa fa-upload" aria-hidden></i>
					</button>}
				</div>}
				{showEndSpec && !showEndPlayer && <div class="tcg-chrome-group" aria-label="Replay download">
					<a
						onClick={this.handleDownloadReplay}
						href={`//${Config.routes.replays}/download`}
						class="button replayDownloadButton"
						title="Download replay"
					>
						<i class="fa fa-download" aria-hidden></i>
					</a>
				</div>}
				{showScrub && <div class="tcg-chrome-group" aria-label="Replay controls">
					<button class="button" data-cmd="/play" title="Replay">
						<i class="fa fa-undo" aria-hidden></i>
					</button>
					<button class={"button" + (atStart ? " disabled" : "")} data-cmd="/ffto 0" title="First turn">
						<i class="fa fa-fast-backward" aria-hidden></i>
					</button>
					<button class={"button" + (atStart ? " disabled" : "")} data-cmd="/ffto -1" title="Previous turn">
						<i class="fa fa-step-backward" aria-hidden></i>
					</button>
					<button class={"button" + (atEnd ? " disabled" : "")} data-cmd="/ffto +1" title="Next turn">
						<i class="fa fa-step-forward" aria-hidden></i>
					</button>
					<button class={"button" + (atEnd ? " disabled" : "")} data-cmd="/ffto end" title="Skip to end">
						<i class="fa fa-fast-forward" aria-hidden></i>
					</button>
					<button class="button" data-cmd="/ffto" title="Go to turn">Turn</button>
					<button class="button" data-cmd="/switchsides" title="Switch viewpoint">
						<i class="fa fa-random" aria-hidden></i>
					</button>
				</div>}
			</div>}
		</div>;
	}

	override render() {
		this.updateLayout();
		const room = this.props.room;
		if (room.tcgMode || isTcgBattleId(room.id)) {
			return this.renderTcg();
		}
		const id = `room-${room.id}`;
		const hardcoreStyle = room.battle?.hardcoreMode ? <style
			dangerouslySetInnerHTML={{ __html: `#${id} .battle .turn, #${id} .battle-history { display: none !important; }` }}
		></style> : null;
		const { layout, battleHeight, battleWidth, overlayControls } = this.chooseLayout();
		const overlayVersion = overlayControls && !!room.battle && !!room.side && !!room.request && !room.battle.ended;

		if (layout === 'scrolling') {
			// low-width-low-height layout
			// TODO: nicer phone horizontal layout
			return <PSPanelWrapper room={room} focusClick noScroll="hidden">
				{hardcoreStyle}
				<ChatLog
					class="battle-log hasuserlist" room={room} noSubscription hasPreempt bottom={0}
				>
					<div style="height:18px;position:relative">
						<ChatUserList room={room} top={0} minimized />
					</div>
					<ChatTextEntry room={room} onMessage={this.send} onKey={this.onKey} left={0} tinyLayout={room.width < 400} />
					<div style={`height:${battleHeight}px;width:${battleWidth}px;margin: 0 auto;position:relative`}>
						<BattleDiv room={room} />
					</div>
					{overlayVersion && <div class="overlay-controls" style="position:relative;height:0">
						{this.renderControls(true)}
					</div>}
					<div
						class={`battle-controls inline-battle${room.width > 660 ? ' wide-controls' : ''}`}
						role="complementary" aria-label="Battle Controls"
					>
						{this.renderControls(false, overlayVersion)}
						{this.renderConnectError()}
					</div>
				</ChatLog>
				{(room.battle && !room.battle.ended && room.request && room.battle.mySide.id === PS.user.userid) &&
					<TimerButton room={room} top={7} />}
				<div class="battle-controls-container"></div>
			</PSPanelWrapper>;
		}

		if (layout === 'top-and-bottom') {
			// phone vertical layout
			return <PSPanelWrapper room={room} focusClick noScroll="hidden">
				{hardcoreStyle}
				<div style={`position:relative;height:${battleHeight}px;width:${battleWidth}px;margin:0 auto`}>
					<BattleDiv room={room} />
				</div>
				{overlayVersion && <div
					class="overlay-controls"
					style={`position:absolute;left:0;top:${battleHeight}px;width:100%;height:0`}
				>
					{this.renderControls(true)}
				</div>}
				<ChatLog
					class="battle-log hasuserlist" room={room} top={battleHeight} noSubscription hasPreempt
				>
					<div
						class={`battle-controls${room.width > 660 ? ' wide-controls' : ''}`}
						role="complementary" aria-label="Battle Controls"
					>
						{this.renderControls(false, overlayVersion)}
						{this.renderConnectError()}
					</div>
				</ChatLog>
				<ChatTextEntry room={room} onMessage={this.send} onKey={this.onKey} left={0} tinyLayout={room.width < 400} />
				<ChatUserList room={room} top={battleHeight} minimized />
				{(room.battle && !room.battle.ended && room.request && room.battle.mySide.id === PS.user.userid) &&
					<TimerButton room={room} top={battleHeight + 7} />}
				<div class="battle-controls-container"></div>
			</PSPanelWrapper>;
		}

		if (room.width < 500) {
			// oldclient phone layout
			const showingChat = this.mobileChatShown;
			return <PSPanelWrapper room={room} focusClick noScroll="hidden">
				{hardcoreStyle}
				<div class="scrollable-battle-container" style={`width:${battleWidth}px;${showingChat ? 'display:none;' : ''}`}>
					<BattleDiv room={room} />
					{overlayVersion && <div
						class="overlay-controls"
						style={`position:absolute;left:0;top:${battleHeight}px;width:${battleWidth}px;height:0`}
					>
						{this.renderControls(true)}
					</div>}
					<div class="battle-controls-container">
						<div
							class={`battle-controls${battleWidth >= 639 ? ' wide-controls' : ''}`}
							role="complementary" aria-label="Battle Controls"
							style={`top:${battleHeight + 10}px;width:${battleWidth}px;`}
						>
							{(room.battle && !room.battle.ended && room.request &&
								room.battle.mySide.id === PS.user.userid) && <TimerButton room={room} top={0} />}
							{this.renderControls(false, overlayVersion)}
							{this.renderConnectError()}
						</div>
					</div>
				</div>
				<div style={!showingChat ? 'display:none;' : ''}>
					<ChatLog class="battle-log hasuserlist" room={room} noSubscription hasPreempt />
					<ChatTextEntry room={room} onMessage={this.send} onKey={this.onKey} tinyLayout />
					<ChatUserList room={room} minimized />
				</div>
				{showingChat ? (
					<button class="battle-chat-toggle button" name="hideChat" onClick={this.showMobileBattle}>
						Battle <i class="fa fa-caret-right" aria-hidden></i>
					</button>
				) : (
					<button class="battle-chat-toggle button" name="showChat" onClick={this.showMobileChat}>
						<i class="fa fa-caret-left" aria-hidden></i> Chat
					</button>
				)}
			</PSPanelWrapper>;
		}

		// regular layout
		return <PSPanelWrapper room={room} focusClick noScroll="hidden">
			{hardcoreStyle}
			<div class="scrollable-battle-container" style={`width:${battleWidth}px`}>
				<BattleDiv room={room} />
				{overlayVersion && <div
					class="overlay-controls"
					style={`position:absolute;left:0;top:${battleHeight}px;width:${battleWidth}px;height:0`}
				>
					{this.renderControls(true)}
				</div>}
				<div class="battle-controls-container">
					<div
						class={`battle-controls${battleWidth >= 639 ? ' wide-controls' : ''}`}
						role="complementary" aria-label="Battle Controls"
						style={`top:${battleHeight + 10}px;width:${battleWidth}px;`}
					>
						{(room.battle && !room.battle.ended && room.request && room.battle.mySide.id === PS.user.userid) &&
							<TimerButton room={room} top={0} />}
						{this.renderControls(false, overlayVersion)}
						{this.renderConnectError()}
					</div>
				</div>
			</div>
			<ChatLog
				class="battle-log hasuserlist" room={room} left={battleWidth} noSubscription hasPreempt
			>
				{}
			</ChatLog>
			<ChatTextEntry
				room={room} onMessage={this.send} onKey={this.onKey} left={battleWidth} tinyLayout={room.width < battleWidth + 340}
			/>
			<ChatUserList room={room} left={battleWidth} minimized />
		</PSPanelWrapper>;
	}

	renderTcg() {
		const room = this.props.room;
		const { battleHeight, battleWidth, layout } = this.chooseLayout();
		const chatWidth = Math.min(400, Math.max(300, Math.floor(room.width * 0.3)));
		const boardW = layout === 'top-and-bottom' ?
			Math.max(battleWidth, Math.min(room.width, 960)) :
			Math.max(battleWidth, room.width - chatWidth);
		const viewSnap = room.tcgViewSnapshot(room.tcgSnapshot);
		const viewFx = room.tcgViewSnapshot(room.tcgFxSnapshot);
		const board = viewSnap ? <TcgBoard
			snapshot={viewSnap}
			fxSnapshot={viewFx}
			events={room.tcgEvents}
			fxKey={room.tcgFxKey}
			halt={room.tcgHalt}
			paused={room.tcgPaused}
			onTogglePause={room.toggleTcgPause}
			onReplay={room.replayTcg}
			onSkip={room.skipTcgToEnd}
			waiting={room.tcgWait}
			ended={room.tcgEnded || room.tcgReplayMode}
			showReplayControls={false}
			winnerName={room.tcgWinner}
			onAct={this.sendTcgAction}
			onEvent={room.onTcgEvent}
			onFxDone={room.onTcgFxDone}
		/> : <div class="tcg-table"><p class="tcg-waiting">Shuffling…</p></div>;
		const controls = this.renderTcgControls();

		// Phone / narrow: board fills the room; toggle to chat (same idea as gen battles)
		const isPhone = room.width < 640;
		if (isPhone) {
			const showingChat = this.mobileChatShown;
			return <PSPanelWrapper room={room} focusClick noScroll="hidden">
				<div
					class="tcg-mobile-board"
					style={showingChat ? 'display:none;' :
						'position:absolute;inset:0;display:flex;flex-direction:column;' +
						'padding:0;box-sizing:border-box;z-index:1;min-height:0;'}
				>
					<div class="tcg-board-shell">
						{board}
						{controls}
					</div>
					{this.renderConnectError()}
				</div>
				<div class="tcg-mobile-chat" style={showingChat ? 'position:absolute;inset:0;z-index:1;' : 'display:none;'}>
					<ChatLog class="battle-log hasuserlist" room={room} noSubscription hasPreempt />
					<ChatTextEntry room={room} onMessage={this.send} onKey={this.onKey} tinyLayout />
					<ChatUserList room={room} minimized />
				</div>
				{showingChat ? (
					<button
						type="button" class="button tcg-view-toggle" name="hideChat"
						onClick={this.showMobileBattle}
					>
						Board <i class="fa fa-caret-right" aria-hidden></i>
					</button>
				) : (
					<button
						type="button" class="button tcg-view-toggle" name="showChat"
						onClick={this.showMobileChat}
					>
						<i class="fa fa-caret-left" aria-hidden></i> Chat
					</button>
				)}
			</PSPanelWrapper>;
		}

		if (layout === 'top-and-bottom') {
			return <PSPanelWrapper room={room} focusClick noScroll="hidden">
				<div
					class="tcg-board-shell"
					style={`height:${battleHeight}px;width:${boardW}px;margin:0 auto;`}
				>
					{board}
					{controls}
				</div>
				<ChatLog
					class="battle-log hasuserlist" room={room} top={battleHeight} noSubscription hasPreempt
				/>
				<ChatTextEntry
					room={room} onMessage={this.send} onKey={this.onKey} left={0} tinyLayout={room.width < 400}
				/>
				<ChatUserList room={room} top={battleHeight} minimized />
			</PSPanelWrapper>;
		}

		return <PSPanelWrapper room={room} focusClick noScroll="hidden">
			<div
				class="tcg-board-shell tcg-board-shell-side"
				style={`width:${boardW}px;`}
			>
				{board}
				{controls}
				{this.renderConnectError()}
			</div>
			<ChatLog
				class="battle-log hasuserlist" room={room} left={boardW} noSubscription hasPreempt
			/>
			<ChatTextEntry
				room={room} onMessage={this.send} onKey={this.onKey} left={boardW}
				tinyLayout={room.width < boardW + 340}
			/>
			<ChatUserList room={room} left={boardW} minimized />
		</PSPanelWrapper>;
	}
}

PS.addRoomType(BattlePanel, BattlesPanel);
