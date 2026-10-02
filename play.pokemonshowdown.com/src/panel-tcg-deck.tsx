/**
 * TCG deck builder (Standard + Pocket). Mounted from the team panel for TCG formats.
 */
import preact from "../js/lib/preact";
import { PS, type Team } from "./client-main";
import {
	TCG_DECK_RULES, allTcgCards, cardLegalInFormat, copyMaxFor, deckCounts, deckProblemsClient,
	exportTcgDeck, getTcgCard, groupDeck, importTcgDeck, loadTcgCardIndex, packTcgDeck,
	showdownFormatFor, tcgDeckFormatOf, unpackTcgDeck, type TcgCardRow, type TcgDeckFormat,
} from "./battle-tcg-deck";
import { toID } from "./battle-dex";

type SuperFilter = '' | 'P' | 'T' | 'E';
type EditorMode = 'deck' | 'import';

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
		mode: 'deck' as EditorMode,
		q: '',
		super: '' as SuperFilter,
		type: '' as string,
		reg: '' as string,
		ids: [] as string[],
		format: 'standard' as TcgDeckFormat,
		serverErrors: null as string[] | null,
		validating: false,
		preview: null as TcgCardRow | null,
		importText: '',
		importDirty: false,
		importErrors: null as string[] | null,
		importWarnings: null as string[] | null,
		copied: false,
	};

	searchTimer: number | null = null;
	importBox: HTMLTextAreaElement | null = null;

	override componentDidMount() {
		const format = tcgDeckFormatOf(this.props.team.format);
		const ids = unpackTcgDeck(this.props.team.packedTeam);
		this.setState({ format, ids });
		loadTcgCardIndex().then(() => this.setState({ ready: true }));
		window.addEventListener('keydown', this.onKeyDown);
	}

	override componentWillUnmount() {
		window.removeEventListener('keydown', this.onKeyDown);
		if (this.searchTimer != null) window.clearTimeout(this.searchTimer);
	}

	onKeyDown = (ev: KeyboardEvent) => {
		if (ev.key === 'Escape' && this.state.preview) this.closePreview();
	};

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
	};

	openPreview = (card: TcgCardRow | null) => {
		this.setState({ preview: card });
	};

	closePreview = () => {
		this.setState({ preview: null });
	};

	onSearch = (ev: Event) => {
		const q = (ev.currentTarget as HTMLInputElement).value;
		if (this.searchTimer != null) window.clearTimeout(this.searchTimer);
		this.searchTimer = window.setTimeout(() => this.setState({ q }), 80);
	};

	validate = () => {
		this.setState({ validating: true, serverErrors: null });
		const formatid = this.props.team.format || showdownFormatFor(this.state.format);
		requestValidate(formatid, this.state.ids).then(res => {
			this.setState({ validating: false, serverErrors: res.errors || [] });
		});
	};

	setMode = (mode: EditorMode) => {
		if (mode === this.state.mode) return;
		if (mode === 'import') {
			this.setState({
				mode,
				importText: exportTcgDeck(this.state.ids),
				importDirty: false,
				importErrors: null,
				importWarnings: null,
				copied: false,
				preview: null,
			});
			return;
		}
		this.setState({ mode, importErrors: null, importWarnings: null, copied: false });
	};

	onImportInput = (ev: Event) => {
		const importText = (ev.currentTarget as HTMLTextAreaElement).value;
		const importDirty = importText !== exportTcgDeck(this.state.ids);
		this.setState({ importText, importDirty, importErrors: null, importWarnings: null });
	};

	applyImport = () => {
		const result = importTcgDeck(this.state.importText, this.state.format);
		if (result.errors.length && !result.ids.length) {
			this.setState({ importErrors: result.errors, importWarnings: result.warnings });
			return;
		}
		this.commit(result.ids);
		this.setState({
			mode: 'deck',
			importText: exportTcgDeck(result.ids),
			importDirty: false,
			importErrors: result.errors.length ? result.errors : null,
			importWarnings: result.warnings.length ? result.warnings : null,
		});
		if (result.errors.length || result.warnings.length) {
			const bits = [
				...result.warnings,
				...result.errors,
			].slice(0, 8);
			PS.alert(bits.join('\n') + (result.errors.length + result.warnings.length > 8 ? '\n…' : ''));
		}
	};

	resetImport = () => {
		this.setState({
			importText: exportTcgDeck(this.state.ids),
			importDirty: false,
			importErrors: null,
			importWarnings: null,
		});
	};

	copyExport = () => {
		const text = this.state.importDirty ? this.state.importText : exportTcgDeck(this.state.ids);
		const clip = navigator.clipboard;
		if (!clip?.writeText) {
			PS.alert('Could not copy to clipboard. Select the text and copy manually.');
			return;
		}
		clip.writeText(text).then(() => {
			this.setState({ copied: true });
			window.setTimeout(() => this.setState({ copied: false }), 1500);
		}, () => {
			PS.alert('Could not copy to clipboard. Select the text and copy manually.');
		});
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
		const { ids, format, preview, mode } = this.state;

		return <div class={`tcg-deck-builder${this.props.narrow ? ' narrow' : ''}`}>
			<ul class="tabbar unpadded-tabbar tcg-deck-tabs">
				<li>
					<button type="button" class={`button${mode === 'deck' ? ' cur' : ''}`} onClick={() => this.setMode('deck')}>
						Deck
					</button>
				</li>
				<li>
					<button
						type="button"
						class={`button button-last${mode === 'import' ? ' cur' : ''}`}
						onClick={() => this.setMode('import')}
					>
						Import/Export
					</button>
				</li>
			</ul>
			{mode === 'import' ? this.renderImportExport() : this.renderDeckBuilder()}
			{preview && mode === 'deck' && this.renderPreviewModal(preview, ids, format)}
		</div>;
	}

	renderDeckBuilder() {
		const { ids, format, ready, validating, serverErrors } = this.state;
		const rules = TCG_DECK_RULES[format];
		const problems = ready ? deckProblemsClient(ids, format) : [];
		const counts = deckCounts(ids);
		const lines = groupDeck(ids);
		const poke = lines.filter(l => l.card?.s === 'P');
		const train = lines.filter(l => l.card?.s === 'T');
		const ener = lines.filter(l => l.card?.s === 'E');
		const results = this.filteredCards();
		const countCls = ids.length === rules.deckSize ? 'ok' : ids.length > rules.deckSize ? 'over' : 'short';

		return <div class="tcg-deck-main">
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
				{!ready ? <p class="tcg-deck-loading">Loading card catalog…</p> : (
					<div class="tcg-deck-results">
						{results.map(c => {
							const inDeck = ids.filter(x => x === c.id).length;
							const max = copyMaxFor(c, format);
							return <div
								key={c.id}
								class={`tcg-deck-card${inDeck ? ' in-deck' : ''}`}
								title={`${c.n} (${c.set}${c.r ? ` · ${c.r}` : ''}) — click art to preview`}
							>
								<button
									type="button"
									class="tcg-deck-card-art"
									onClick={() => this.openPreview(c)}
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

	renderImportExport() {
		const { importText, importDirty, importErrors, importWarnings, copied, ready, ids } = this.state;
		const text = importDirty || importText ? importText : (ready ? exportTcgDeck(ids) : '');
		return <div class="tcg-deck-import">
			<p class="tcg-deck-import-help">
				Paste a deck list below, or copy this export. Accepts Limitless-style lines
				(<code>4 Abomasnow sv10-60</code>), bare card ids, or a JSON id array.
			</p>
			<textarea
				class="textbox tcg-deck-import-box"
				value={text}
				onInput={this.onImportInput}
				spellcheck={false}
				ref={el => { this.importBox = el; }}
			/>
			<p class="buttonbar tcg-deck-import-actions">
				<button type="button" class="button" onClick={this.applyImport} disabled={!ready}>
					<i class="fa fa-upload" aria-hidden></i> Import
				</button> {}
				<button type="button" class="button" onClick={this.copyExport} disabled={!ready}>
					<i class="fa fa-clipboard" aria-hidden></i> {copied ? 'Copied!' : 'Copy'}
				</button> {}
				{importDirty && <button type="button" class="button" onClick={this.resetImport}>
					Reset
				</button>}
			</p>
			{(importWarnings?.length || importErrors?.length) && (
				<div class="tcg-deck-import-msgs">
					{importWarnings?.map(w => <div class="tcg-deck-import-warn">{w}</div>)}
					{importErrors?.map(e => <div class="tcg-deck-import-err">{e}</div>)}
				</div>
			)}
		</div>;
	}

	renderPreviewModal(card: TcgCardRow, ids: string[], format: TcgDeckFormat) {
		const inDeck = ids.filter(x => x === card.id).length;
		const max = copyMaxFor(card, format);
		const large = card.i ? card.i.replace('_SM.webp', '.webp').replace('small', 'large') : '';
		const kind = card.s === 'P' ? 'Pokémon' : card.s === 'T' ? 'Trainer' : 'Energy';
		return <div
			class="ps-overlay tcg-deck-modal"
			role="dialog"
			aria-modal="true"
			aria-label={card.n}
			onClick={this.closePreview}
		>
			<div class="ps-popup tcg-deck-modal-card" onClick={ev => ev.stopPropagation()}>
				<button type="button" class="button tcg-deck-modal-close" onClick={this.closePreview} aria-label="Close">×</button>
				{large ? <img src={large} alt={card.n} /> : <div class="tcg-deck-card-fallback">{card.n}</div>}
				<div class="tcg-deck-modal-info">
					<strong>{card.n}</strong>
					<div>{card.set}{card.r ? ` · Reg ${card.r}` : ''}</div>
					<div>{kind}{(card.u || []).length ? ` · ${card.u.join(', ')}` : ''}</div>
					<div class="tcg-deck-card-qty tcg-deck-modal-qty">
						<button
							type="button"
							class="tcg-deck-qty"
							disabled={!inDeck}
							onClick={() => this.setQty(card.id, inDeck - 1)}
							aria-label={`Remove one ${card.n}`}
						>−</button>
						<span class="tcg-deck-qty-n">{inDeck}</span>
						<button
							type="button"
							class="tcg-deck-qty"
							disabled={inDeck >= max}
							onClick={() => this.addCard(card.id)}
							aria-label={`Add one ${card.n}`}
						>+</button>
					</div>
				</div>
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
						<button type="button" class="tcg-deck-line-name" onClick={() => this.openPreview(line.card || null)}>
							{line.card?.n || line.id}
						</button>
					</li>
				)}
			</ul>
		</section>;
	}
}
