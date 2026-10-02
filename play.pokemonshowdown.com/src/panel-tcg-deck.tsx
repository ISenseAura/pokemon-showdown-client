/**
 * TCG deck builder (Standard + Pocket). Mounted from the team panel for TCG formats.
 */
import preact from "../js/lib/preact";
import { PS, type Team } from "./client-main";
import {
	TCG_DECK_RULES, allTcgCards, cardLegalInFormat, copyMaxFor, deckCounts, deckProblemsClient,
	getTcgCard, groupDeck, loadTcgCardIndex, packTcgDeck, showdownFormatFor, tcgDeckFormatOf,
	unpackTcgDeck, type TcgCardRow, type TcgDeckFormat,
} from "./battle-tcg-deck";
import { toID } from "./battle-dex";

type SuperFilter = '' | 'P' | 'T' | 'E';

type ValidateResult = {
	ok: boolean,
	errors: string[],
	deckSize?: number,
	rulesSize?: number,
};

let validateCb: ((res: ValidateResult) => void) | null = null;

export function receiveTcgValidate(response: ValidateResult) {
	validateCb?.(response);
	validateCb = null;
}

function requestValidate(formatid: string, ids: string[]): Promise<ValidateResult> {
	return new Promise(resolve => {
		validateCb = resolve;
		PS.send(`/cmd tcgvalidate ${toID(formatid)} ${JSON.stringify(ids)}`);
		window.setTimeout(() => {
			if (validateCb === resolve) {
				validateCb = null;
				resolve({ ok: false, errors: ['Server did not respond. Client checks are shown above.'] });
			}
		}, 8000);
	});
}

const ENERGY_TYPES = [
	'grass', 'fire', 'water', 'lightning', 'psychic', 'fighting',
	'darkness', 'metal', 'fairy', 'dragon', 'colorless',
];

const BASIC_ENERGY_IDS: { [type: string]: string } = {
	grass: 'sve-1',
	fire: 'sve-2',
	water: 'sve-3',
	lightning: 'sve-4',
	psychic: 'sve-5',
	fighting: 'sve-6',
	darkness: 'sve-7',
	metal: 'sve-8',
	fairy: 'sve-9',
	// colorless basic energy is not a standard Basic Energy print in modern sets
};

export class TcgDeckEditor extends preact.Component<{
	team: Team,
	onChange: () => void,
	narrow?: boolean,
}> {
	override state = {
		ready: false,
		q: '',
		super: '' as SuperFilter,
		type: '' as string,
		reg: '' as string,
		ids: [] as string[],
		format: 'standard' as TcgDeckFormat,
		serverErrors: null as string[] | null,
		validating: false,
		preview: null as TcgCardRow | null,
	};

	searchTimer: number | null = null;

	override componentDidMount() {
		const format = tcgDeckFormatOf(this.props.team.format);
		const ids = unpackTcgDeck(this.props.team.packedTeam);
		this.setState({ format, ids });
		loadTcgCardIndex().then(() => this.setState({ ready: true }));
	}

	override componentDidUpdate(prev: this['props']) {
		if (prev.team !== this.props.team || prev.team.format !== this.props.team.format) {
			this.setState({
				format: tcgDeckFormatOf(this.props.team.format),
				ids: unpackTcgDeck(this.props.team.packedTeam),
				serverErrors: null,
			});
			return;
		}
		// Ignore our own commits (packedTeam already matches state.ids).
		if (prev.team.packedTeam !== this.props.team.packedTeam) {
			const next = unpackTcgDeck(this.props.team.packedTeam);
			if (next.join('\0') !== this.state.ids.join('\0')) {
				this.setState({ ids: next, serverErrors: null });
			}
		}
	}

	commit(ids: string[], format = this.state.format) {
		const team = this.props.team;
		team.packedTeam = packTcgDeck(ids);
		team.iconCache = null;
		const psFormat = showdownFormatFor(format);
		const cur = toID(team.format);
		if (!cur.includes('tcg') || cur.includes('random') ||
			(format === 'pocket' && !cur.includes('pocket')) ||
			(format === 'standard' && cur.includes('pocket'))) {
			team.format = psFormat as any;
		}
		this.setState({ ids, format, serverErrors: null });
		this.props.onChange();
	}

	setQty = (id: string, qty: number) => {
		const card = getTcgCard(id);
		const max = card ? copyMaxFor(card, this.state.format) : 4;
		qty = Math.max(0, Math.min(max, qty));
		const without = this.state.ids.filter(x => x !== id);
		const next = without.concat(Array(qty).fill(id));
		this.commit(next);
	};

	addCard = (id: string) => {
		const card = getTcgCard(id);
		if (!card) return;
		const cur = this.state.ids.filter(x => x === id).length;
		const max = copyMaxFor(card, this.state.format);
		if (cur >= max) return;
		// Same-name copy limit (except basic energy)
		if (!card.be) {
			const named = this.state.ids.filter(x => getTcgCard(x)?.n === card.n).length;
			if (named >= max) return;
		}
		this.commit(this.state.ids.concat([id]));
		this.setState({ preview: card });
	};

	onSearch = (ev: Event) => {
		const q = (ev.currentTarget as HTMLInputElement).value;
		if (this.searchTimer != null) window.clearTimeout(this.searchTimer);
		this.searchTimer = window.setTimeout(() => this.setState({ q }), 80);
	};

	validate = async () => {
		this.setState({ validating: true, serverErrors: null });
		const formatid = this.props.team.format || showdownFormatFor(this.state.format);
		const res = await requestValidate(formatid, this.state.ids);
		this.setState({ validating: false, serverErrors: res.errors || [] });
	};

	filteredCards(): TcgCardRow[] {
		if (!this.state.ready) return [];
		const { q, super: sup, type, reg, format } = this.state;
		const qid = toID(q);
		const out: TcgCardRow[] = [];
		for (const c of allTcgCards()) {
			if (!cardLegalInFormat(c, format) && !(format === 'standard' && c.be)) continue;
			// Basic energy is always shown in Standard even if std flag missed
			if (format === 'standard' && !c.std && !c.be) continue;
			if (format === 'pocket' && !c.pkt) continue;
			if (sup && c.s !== sup) continue;
			if (type && !(c.t || []).includes(type)) continue;
			if (reg && c.r !== reg) continue;
			if (qid) {
				const hay = toID(c.n + c.id + c.set);
				if (!hay.includes(qid)) continue;
			}
			out.push(c);
			if (out.length >= 120) break;
		}
		return out;
	}

	override render() {
		const { ids, format, ready, validating, serverErrors, preview } = this.state;
		const rules = TCG_DECK_RULES[format];
		const problems = ready ? deckProblemsClient(ids, format) : [];
		const counts = deckCounts(ids);
		const lines = groupDeck(ids);
		const poke = lines.filter(l => l.card?.s === 'P');
		const train = lines.filter(l => l.card?.s === 'T');
		const ener = lines.filter(l => l.card?.s === 'E');
		const results = this.filteredCards();
		const countCls = ids.length === rules.deckSize ? 'ok' : ids.length > rules.deckSize ? 'over' : 'short';

		return <div class={`tcg-deck-builder${this.props.narrow ? ' narrow' : ''}`}>
			{/* Your deck first: top when stacked, left on wide screens. */}
			<aside class="tcg-deck-rail">
				<div class="tcg-deck-rail-head">
					<div class={`tcg-deck-count ${countCls}`}>{ids.length}<small>/{rules.deckSize}</small></div>
					<div class="tcg-deck-split">
						<span>Pokémon {counts.pokemon}</span>
						<span>Trainer {counts.trainer}</span>
						<span>Energy {counts.energy}</span>
					</div>
					<button type="button" class="button tcg-deck-validate" onClick={this.validate} disabled={validating}>
						<i class="fa fa-check" aria-hidden></i> {validating ? '…' : 'Validate'}
					</button>
				</div>

				<div class="tcg-deck-lists">
					{this.renderGroup('Pokémon', poke)}
					{this.renderGroup('Trainer', train)}
					{this.renderGroup('Energy', ener)}
					{!lines.length && <p class="tcg-deck-empty">Your deck is empty. Use + on cards below to add them.</p>}
				</div>

				{format === 'standard' && <div class="tcg-deck-energy-quick">
					<small>Basic Energy</small>
					<div class="tcg-deck-chips">
						{Object.keys(BASIC_ENERGY_IDS).map(t =>
							<button type="button" class="button" onClick={() => this.addCard(BASIC_ENERGY_IDS[t])}>{t}</button>
						)}
					</div>
				</div>}

				{(problems.length > 0 || serverErrors?.length) && (
					<div class="tcg-deck-legal bad">
						<ul>
							{problems.map(e => <li>{e}</li>)}
							{serverErrors?.map(e => <li>{e}</li>)}
						</ul>
					</div>
				)}
			</aside>

			<div class="tcg-deck-browser">
				<div class="tcg-deck-searchbar">
					<input
						class="textbox tcg-deck-search" type="search" placeholder="Search cards…"
						onInput={this.onSearch} autofocus
					/>
					<div class="tcg-deck-chips">
						{(['', 'P', 'T', 'E'] as SuperFilter[]).map(s =>
							<button
								type="button"
								class={`button${this.state.super === s ? ' cur' : ''}`}
								onClick={() => this.setState({ super: s })}
							>{s === '' ? 'All' : s === 'P' ? 'Pokémon' : s === 'T' ? 'Trainer' : 'Energy'}</button>
						)}
					</div>
					{format === 'standard' && <div class="tcg-deck-chips">
						<select class="select" value={this.state.type} onChange={ev => this.setState({ type: (ev.currentTarget as HTMLSelectElement).value })}>
							<option value="">Any type</option>
							{ENERGY_TYPES.map(t => <option value={t}>{t}</option>)}
						</select>
						<select class="select" value={this.state.reg} onChange={ev => this.setState({ reg: (ev.currentTarget as HTMLSelectElement).value })}>
							<option value="">Any regulation</option>
							{['H', 'I', 'J', 'K'].map(r => <option value={r}>{r}+</option>)}
						</select>
					</div>}
				</div>
				<div class={`tcg-deck-preview${preview ? '' : ' empty'}`}>
					{preview ? <>
						{preview.i && <img src={preview.i.replace('_SM.webp', '.webp').replace('small', 'large')} alt={preview.n} />}
						<div class="tcg-deck-preview-info">
							<strong>{preview.n}</strong>
							<div>{preview.set}{preview.r ? ` · Reg ${preview.r}` : ''}</div>
							<div>{preview.s === 'P' ? 'Pokémon' : preview.s === 'T' ? 'Trainer' : 'Energy'}{(preview.u || []).length ? ` · ${preview.u.join(', ')}` : ''}</div>
							{ready && (() => {
								const inDeck = ids.filter(x => x === preview.id).length;
								const max = copyMaxFor(preview, format);
								return <div class="tcg-deck-card-qty tcg-deck-preview-qty">
									<button
										type="button"
										class="tcg-deck-qty"
										disabled={!inDeck}
										onClick={() => this.setQty(preview.id, inDeck - 1)}
										aria-label={`Remove one ${preview.n}`}
									>−</button>
									<span class="tcg-deck-qty-n">{inDeck}</span>
									<button
										type="button"
										class="tcg-deck-qty"
										disabled={inDeck >= max}
										onClick={() => this.addCard(preview.id)}
										aria-label={`Add one ${preview.n}`}
									>+</button>
								</div>;
							})()}
						</div>
					</> : <p class="tcg-deck-preview-hint">Hover a card to preview it</p>}
				</div>
				{!ready ? <p class="tcg-deck-loading">Loading card catalog…</p> : (
					<div class="tcg-deck-results">
						{results.map(c => {
							const inDeck = ids.filter(x => x === c.id).length;
							const max = copyMaxFor(c, format);
							return <div
								key={c.id}
								class={`tcg-deck-card${inDeck ? ' in-deck' : ''}`}
								onMouseEnter={() => this.setState({ preview: c })}
								title={`${c.n} (${c.set}${c.r ? ` · ${c.r}` : ''})`}
							>
								<button
									type="button"
									class="tcg-deck-card-art"
									onClick={() => this.addCard(c.id)}
								>
									{c.i ? <img src={c.i} alt="" /> : <span class="tcg-deck-card-fallback">{c.n}</span>}
								</button>
								<span class="tcg-deck-card-meta">
									<strong>{c.n}</strong>
									<small>{c.set}{c.r ? ` · ${c.r}` : ''}</small>
								</span>
								<div class="tcg-deck-card-qty">
									<button
										type="button"
										class="tcg-deck-qty"
										disabled={!inDeck}
										onClick={ev => { ev.stopPropagation(); this.setQty(c.id, inDeck - 1); }}
										aria-label={`Remove one ${c.n}`}
									>−</button>
									<span class="tcg-deck-qty-n">{inDeck}</span>
									<button
										type="button"
										class="tcg-deck-qty"
										disabled={inDeck >= max}
										onClick={ev => { ev.stopPropagation(); this.addCard(c.id); }}
										aria-label={`Add one ${c.n}`}
									>+</button>
								</div>
							</div>;
						})}
						{!results.length && <p class="tcg-deck-empty">No cards match.</p>}
					</div>
				)}
			</div>
		</div>;
	}

	renderGroup(title: string, lines: ReturnType<typeof groupDeck>) {
		if (!lines.length) return null;
		return <section>
			<h3>{title} <small>({lines.reduce((n, l) => n + l.n, 0)})</small></h3>
			<ul>
				{lines.map(line =>
					<li key={line.id}>
						<button type="button" class="tcg-deck-qty" onClick={() => this.setQty(line.id, line.n - 1)}>−</button>
						<span class="tcg-deck-qty-n">{line.n}</span>
						<button type="button" class="tcg-deck-qty" onClick={() => this.setQty(line.id, line.n + 1)}>+</button>
						<button type="button" class="tcg-deck-line-name" onClick={() => this.setState({ preview: line.card || null })}>
							{line.card?.n || line.id}
						</button>
					</li>
				)}
			</ul>
		</section>;
	}
}
