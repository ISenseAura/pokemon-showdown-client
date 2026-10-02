/**
 * Build play.pokemonshowdown.com/tcg-cards-index.json from Wave-TCG catalog data.
 * Usage: node scripts/build-tcg-cards-index.js [path-to-pokemon-showdown]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'play.pokemonshowdown.com/tcg-cards-index.json');
const SHOWDOWN = path.resolve(
	process.argv[2] || path.join(ROOT, '..', 'pokemon-showdown')
);
const DATA = path.join(SHOWDOWN, 'Wave-TCG', 'data');

if (!fs.existsSync(DATA)) {
	console.error('Wave-TCG data not found at', DATA);
	process.exit(1);
}

function walkJson(dir, out) {
	if (!fs.existsSync(dir)) return;
	for (const name of fs.readdirSync(dir)) {
		const p = path.join(dir, name);
		const st = fs.statSync(p);
		if (st.isDirectory()) walkJson(p, out);
		else if (name.endsWith('.json') && name !== 'sets.json' && name !== 'en.json' && name !== 'samples.json') {
			out.push(p);
		}
	}
}

function setId(card) {
	return (card.set && card.set.id) || '';
}

function isPocketSetId(id) {
	return /^(A\d+[a-z]?|B\d+[a-z]?|P-A|P-B)$/i.test(id);
}

function isPocket(card) {
	return isPocketSetId(setId(card));
}

function isPokemon(card) {
	return card.supertype === 'Pokémon' || card.supertype === 'Pokemon';
}

function isTrainer(card) {
	return card.supertype === 'Trainer';
}

function isEnergy(card) {
	return card.supertype === 'Energy';
}

function isBasicEnergy(card) {
	if (!isEnergy(card)) return false;
	return !(card.subtypes || []).some(s => /special/i.test(s));
}

function isBasicPokemon(card) {
	if (!isPokemon(card)) return false;
	if ((card.subtypes || []).some(s => /restored|v-union|vunion/i.test(s))) return false;
	return (card.subtypes || []).some(s => s === 'Basic' || s === 'Baby');
}

function isAceSpec(card) {
	if ((card.subtypes || []).some(s => /ace\s*spec/i.test(s))) return true;
	return (card.rules || []).some(r => /ace spec/i.test(r) && /can't have more than 1/i.test(r));
}

function isRadiant(card) {
	return (card.subtypes || []).some(s => /radiant/i.test(s));
}

function isPrismStar(card) {
	return (card.subtypes || []).some(s => /prism/i.test(s)) || /\u2605|\u2726/.test(card.name || '');
}

function regLetter(card) {
	const m = String(card.regulationMark || '').trim().toUpperCase();
	return /^[A-Z]$/.test(m) ? m : '';
}

function hpOf(card) {
	return Math.max(0, Number(String(card.hp || '0').replace(/[^0-9]/g, '')) || 0);
}

function attackKey(card) {
	return (card.attacks || []).map(a => a.name).join('\0');
}

function sameFunctional(a, b) {
	if (a.name !== b.name) return false;
	if (isPokemon(a) || isPokemon(b)) {
		if (hpOf(a) !== hpOf(b)) return false;
		if (attackKey(a) !== attackKey(b)) return false;
		const tera = c => (c.subtypes || []).some(s => /tera/i.test(s));
		if (tera(a) !== tera(b)) return false;
	}
	return true;
}

function pocketArt(card) {
	const set = setId(card);
	let num = String(card.number || '').trim() || card.id.slice(card.id.lastIndexOf('-') + 1);
	if (/^\d+$/.test(num)) num = (num.replace(/^0+/, '') || '0').padStart(3, '0');
	if (!set || !num) return '';
	return `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/pocket/${set}/${set}_${num}_EN_SM.webp`;
}

const files = [];
walkJson(path.join(DATA, 'paper'), files);
walkJson(path.join(DATA, 'pocket'), files);
walkJson(path.join(DATA, 'cards'), files);
const rootFiles = ['basic-energy.json', 'base1.json'];
for (const f of rootFiles) {
	const p = path.join(DATA, f);
	if (fs.existsSync(p)) files.push(p);
}

const byId = new Map();
for (const file of files) {
	try {
		const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
		const list = Array.isArray(raw) ? raw : raw.data || [];
		for (const card of list) {
			if (!card?.id || !card.name) continue;
			byId.set(card.id, card);
		}
	} catch (e) {
		console.warn('skip', file, e.message);
	}
}

const REG_MIN = 'H';
const currentByName = new Map();
for (const c of byId.values()) {
	if (isPocket(c)) continue;
	const letter = regLetter(c);
	if (!letter || letter < REG_MIN) continue;
	if (c.legalities?.standard === 'Banned') continue;
	const list = currentByName.get(c.name) || [];
	list.push(c);
	currentByName.set(c.name, list);
}

function standardLegal(card) {
	if (isPocket(card)) return false;
	if (isBasicEnergy(card)) return true;
	if (card.legalities?.standard === 'Banned') return false;
	const letter = regLetter(card);
	if (letter && letter >= REG_MIN) return true;
	const reprints = currentByName.get(card.name);
	if (reprints?.some(p => sameFunctional(card, p))) return true;
	return false;
}

function pocketLegal(card) {
	if (!isPocket(card)) return false;
	if (isEnergy(card)) return false; // Energy Zone
	return true;
}

const index = [];
for (const card of byId.values()) {
	const pocket = isPocket(card);
	const img = pocket ?
		pocketArt(card) :
		(card.images?.small || card.images?.large || '');
	const superType = isPokemon(card) ? 'P' : isTrainer(card) ? 'T' : isEnergy(card) ? 'E' : '?';
	index.push({
		id: card.id,
		n: card.name,
		s: superType,
		u: (card.subtypes || []).slice(0, 6),
		t: (card.types || []).map(x => String(x).toLowerCase()),
		set: setId(card),
		r: regLetter(card),
		k: pocket ? 'k' : 'p', // pocket / paper
		i: img,
		std: standardLegal(card) ? 1 : 0,
		pkt: pocketLegal(card) ? 1 : 0,
		b: isBasicPokemon(card) ? 1 : 0,
		be: isBasicEnergy(card) ? 1 : 0,
		ace: isAceSpec(card) ? 1 : 0,
		rad: isRadiant(card) ? 1 : 0,
		prism: isPrismStar(card) ? 1 : 0,
	});
}

index.sort((a, b) => a.n.localeCompare(b.n) || a.id.localeCompare(b.id));

fs.writeFileSync(OUT, JSON.stringify(index));
console.log(`Wrote ${index.length} cards → ${OUT}`);
console.log(`  standard-legal: ${index.filter(c => c.std).length}`);
console.log(`  pocket-legal: ${index.filter(c => c.pkt).length}`);
