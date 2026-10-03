/**
 * Replay browser. Same search as replay.pokemonshowdown.com: username, format, recent games.
 */

import { PS, PSRoom, type RoomOptions } from "./client-main";
import { PSPanelWrapper, PSRoomPanel } from "./panels";
import { Net } from "./client-connection";
import { toID } from "./battle-dex";

type ReplayHit = {
	id: string,
	format: string,
	players: string[],
	uploadtime?: number,
	rating?: number,
};

function replayOrigin() {
	const server = PS.server;
	if (!server?.host) return '';
	const proto = server.protocol === 'http' ? 'http' : 'https';
	const port = server.httpport || (proto === 'http' ? server.port : 0);
	const suffix = port && port !== 80 && port !== 443 ? `:${port}` : '';
	return `${proto}://${server.host}${suffix}`;
}

function replayWhen(uploadtime?: number) {
	if (!uploadtime) return '';
	const d = new Date(uploadtime * 1000);
	const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export class ReplaysRoom extends PSRoom {
	override readonly classType = 'replays';
	user = '';
	format = '';
	page = 1;
	sort = '';
	results: ReplayHit[] | null = null;
	error = '';
	private token = 0;

	constructor(options: RoomOptions) {
		super(options);
		this.title = 'Replays';
		this.load();
	}
	load() {
		const token = ++this.token;
		const user = this.user;
		const format = this.format;
		const page = this.page;
		const sort = this.sort;
		this.results = null;
		this.error = '';
		this.update(null);
		const url = `${replayOrigin()}/replays/search.json`;
		Net(url).get({
			query: {
				username: user,
				format,
				page: page > 1 ? page : '',
				sort: sort || '',
			},
		}).then(body => {
			if (token !== this.token) return;
			let rows: ReplayHit[] = [];
			try {
				const parsed = JSON.parse(body);
				if (!Array.isArray(parsed)) throw new Error('Unrecognized response');
				rows = parsed;
			} catch (err) {
				this.error = err instanceof Error ? err.message : 'Could not load replays';
				this.results = [];
				this.update(null);
				return;
			}
			this.results = rows;
			this.update(null);
		}).catch(() => {
			if (token !== this.token) return;
			this.error = 'Could not load replays';
			this.results = [];
			this.update(null);
		});
	}
	search(user: string, format: string) {
		this.user = user;
		this.format = format;
		this.page = 1;
		if (!format || user) this.sort = '';
		this.load();
	}
}

class ReplaysPanel extends PSRoomPanel<ReplaysRoom> {
	static readonly id = 'replays';
	static readonly routes = ['replays', 'replay'];
	static readonly Model = ReplaysRoom;
	static readonly location = 'right';
	static readonly icon = <i class="fa fa-caret-square-o-right" aria-hidden></i>;
	static readonly title = 'Replays';

	submitSearch = (ev: Event) => {
		ev.preventDefault();
		const user = this.base?.querySelector<HTMLInputElement>('input[name=user]')?.value || '';
		const format = this.base?.querySelector<HTMLInputElement>('input[name=format]')?.value || '';
		this.props.room.search(user, format);
	};
	cancelSearch = (ev: Event) => {
		ev.preventDefault();
		const userBox = this.base?.querySelector<HTMLInputElement>('input[name=user]');
		const formatBox = this.base?.querySelector<HTMLInputElement>('input[name=format]');
		if (userBox) userBox.value = '';
		if (formatBox) formatBox.value = '';
		this.props.room.search('', '');
	};
	searchMine = (ev: Event) => {
		ev.preventDefault();
		const name = PS.user.name || '';
		const userBox = this.base?.querySelector<HTMLInputElement>('input[name=user]');
		if (userBox) userBox.value = name;
		this.props.room.search(name, this.props.room.format);
	};
	setSort = (sort: string) => {
		this.props.room.sort = sort;
		this.props.room.page = 1;
		this.props.room.load();
	};
	setPage = (page: number) => {
		this.props.room.page = page;
		this.props.room.load();
	};
	renderHit(hit: ReplayHit) {
		const you = toID(this.props.room.user);
		const names = hit.players || [];
		const when = replayWhen(hit.uploadtime);
		const rating = hit.rating ? ` (Rating: ${hit.rating})` : '';
		return <div key={hit.id}><a href={`battle-${hit.id}`} class="blocklink">
			{when && <small style="float:right">{when}</small>}
			<small>{hit.format}{rating}</small><br />
			<em class={you && toID(names[1]) === you ? '' : 'p1'}>{names[0] || 'Player 1'}</em>
			{} <small class="vs">vs.</small> {}
			<em class={you && toID(names[1]) === you ? 'p1' : 'p2'}>{names[1] || 'Player 2'}</em>
		</a></div>;
	}
	override render() {
		const room = this.props.room;
		const searching = !!(room.user || room.format);
		const more = (room.results?.length || 0) > 50;
		const shown = more ? room.results!.slice(0, 50) : room.results;
		return <PSPanelWrapper room={room}><div class="pad">
			<button class="button" style="float:right;font-size:10pt;margin-top:3px" name="closeRoom">
				<i class="fa fa-times" aria-hidden></i> Close
			</button>
			<h2>Search replays</h2>
			<form class="search" onSubmit={this.submitSearch}>
				<p>
					<label class="label">Username:</label> {}
					<input type="search" name="user" class="textbox" placeholder="(blank = any user)" /> {}
					{PS.user.named && <button type="button" class="button" onClick={this.searchMine}>
						{PS.user.name}'s replays
					</button>}
				</p>
				<p>
					<label class="label">Format:</label> {}
					<input type="search" name="format" class="textbox" placeholder="(blank = any format)" />
				</p>
				<p>
					<button type="submit" class="button"><i class="fa fa-search" aria-hidden></i> <strong>Search</strong></button>
					{searching && <button type="button" class="button" onClick={this.cancelSearch}>Cancel</button>}
				</p>
			</form>
			{searching && room.format && !room.user && <p>
				Sort by: {}
				<button type="button" class={'button button-first' + (room.sort ? '' : ' disabled')} onClick={() => this.setSort('')}>Date</button>
				<button type="button" class={'button button-last' + (room.sort ? ' disabled' : '')} onClick={() => this.setSort('rating')}>Rating</button>
			</p>}
			{room.page > 1 && <p>
				<button type="button" class="button" onClick={() => this.setPage(room.page - 1)}>
					<i class="fa fa-caret-up" aria-hidden></i> Page {room.page - 1}
				</button>
			</p>}
			<h2>{searching ? 'Results' : 'Recent replays'}</h2>
			<div class="list">
				{room.error ? <p><strong class="message-error">{room.error}</strong></p> :
					!shown ? <p>Loading...</p> :
					!shown.length ? <p>No replays found.</p> :
					shown.map(hit => this.renderHit(hit))}
			</div>
			{more && <p>
				<button type="button" class="button" onClick={() => this.setPage(room.page + 1)}>
					Page {room.page + 1} <i class="fa fa-caret-down" aria-hidden></i>
				</button>
			</p>}
		</div></PSPanelWrapper>;
	}
}

PS.addRoomType(ReplaysPanel);
