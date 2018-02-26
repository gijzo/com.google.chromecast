'use strict';

const YouTube = require('youtube-node');
const getYoutubeId = require('get-youtube-id');
const getYoutubePlaylistId = require('get-youtube-playlist-id');
const mdns = require('mdns-js');
const TuneIn = require('node-tunein');
const tuneIn = new TuneIn();

const Homey = require('homey');

const DISCOVER_TIMEOUT = 5 * 60 * 1000;

const maxSearchResults = 5;

const STRIP_COMMENTS = /(\/\/.*$)|(\/\*[\s\S]*?\*\/)|(\s*=[^,\)]*(('(?:\\'|[^'\r\n])*')|("(?:\\"|[^"\r\n])*"))|(\s*=[^,\)]*))/mg;
const ARGUMENT_NAMES = /([^\s,]+)/g;
function getParamNames(func) {
	const fnStr = func.toString().replace(STRIP_COMMENTS, '');
	let result = fnStr.slice(fnStr.indexOf('(') + 1, fnStr.indexOf(')')).match(ARGUMENT_NAMES);
	if (result === null) {
		result = [];
	}
	return result;
}

process.on('unhandledRejection', r => console.log('test', r, new Error()));

module.exports = class App extends Homey.App {

	/*
	 Discovery
	 */
	_onBrowserReady() {
		let drivers = Homey.ManagerDrivers.getDrivers();
		if (!Array.isArray(drivers)) {
			drivers = Object.values(drivers);
		}

		Promise.all(
			drivers.map(driver => new Promise(res => driver.ready(res)))
		).then(() => this._discover());
	}

	_discover() {
		clearTimeout(this._discoverTimeout);
		this._discoverTimeout = setTimeout(
			() => {
				this._browser.discover();
				this._discover_timeout = Math.min(this._discover_timeout * 1.5, DISCOVER_TIMEOUT);
				this._discover();
			},
			this._discover_timeout
		);
	}

	_onBrowserUpdate(device) {
		this.emit('mdns_device', device);
	}

	/*
	 Generic
	 */
	onInit() {
		this.log(`${Homey.manifest.id} running...`);

		this.debounceMap = new Map();
		this.argumentsMap = new Map();

		this._youTube = new YouTube();
		this._youTube.setKey(Homey.env.YOUTUBE_KEY);
		this._youTube.addParam('type', 'video');

		this.onFlowActionCastYouTubeAutocomplete = this.debounce(this._onFlowActionCastYouTubeAutocomplete, 1500);
		this.onFlowActionCastYouTubePlaylistAutocomplete = this.debounce(this._onFlowActionCastYouTubePlaylistAutocomplete, 1500);
		this.onFlowActionCastRadioAutocomplete = this.debounce(this._onFlowActionCastRadioAutocomplete, 500);


		/*
		 Discovery
		 */
		this._discover_timeout = DISCOVER_TIMEOUT / 60;
		this._browser = mdns.createBrowser(mdns.tcp('googlecast'));
		this._browser
			.on('ready', this._onBrowserReady.bind(this))
			.on('update', this._onBrowserUpdate.bind(this));

	}

	debounce(fn, timeout) {
		let rejectPending;

		return ((...args) => {
			return new Promise((resolve, reject) => {
				if (rejectPending) {
					rejectPending(new Error('debounced'));
				}

				const debounceTimeout = setTimeout(() => {
					rejectPending = null;
					resolve(fn.apply(this, args));
				}, timeout);

				rejectPending = (err) => {
					clearTimeout(debounceTimeout);
					reject(err);
				};
			});
		});
	}

	_onFlowActionCastYouTubeAutocomplete(query) {
		return Promise.all([
			new Promise((resolve, reject) => {
				const youtubeId = getYoutubeId(query);
				if (youtubeId) {
					this._youTube.getById(youtubeId, (err, result) => {
						if (err) return reject(err);

						const videos = result.items
							.filter((item) => item.kind === 'youtube#video')
							.map((video) => ({
								id: video.id.videoId,
								name: video.snippet.title,
								image: video.snippet && video.snippet.thumbnails && video.snippet.thumbnails.default ?
									video.snippet.thumbnails.default.url :
									undefined,
							}));

						resolve(videos);
					});
				} else {
					resolve([]);
				}
			}),
			new Promise((resolve, reject) => {
				this._youTube.search(query, maxSearchResults, { type: 'video' }, (err, result) => {
					if (err) return reject(err);

					const videos = result.items.map((video) => ({
						id: video.id.videoId,
						name: video.snippet.title,
						image: video.snippet && video.snippet.thumbnails && video.snippet.thumbnails.default ?
							video.snippet.thumbnails.default.url :
							undefined,
					}));

					resolve(videos);
				});
			}),
		])
			.then((results) => [].concat.apply([], results))
			.catch((err) => {
				this.error('YouTubeAutocomplete error', err.message, err.stack);
				return Promise.reject(err);
			});
	}

	_onFlowActionCastYouTubePlaylistAutocomplete(query) {
		return Promise.all([
			new Promise((resolve, reject) => {
				const youtubePlaylistId = getYoutubePlaylistId(query);
				if (youtubePlaylistId) {
					this._youTube.getPlayListsById(youtubePlaylistId, (err, result) => {
						if (err) return reject(err);

						const playlists = result.items
							.filter((item) => item.kind === 'youtube#playlist')
							.map((playlist) => ({
								id: playlist.id,
								name: playlist.snippet.title,
								image: playlist.snippet && playlist.snippet.thumbnails && playlist.snippet.thumbnails.default ?
									playlist.snippet.thumbnails.default.url :
									undefined,
							}));

						resolve(playlists);
					});
				} else {
					resolve([]);
				}
			}),
			new Promise((resolve, reject) => {
				this._youTube.search(query, maxSearchResults, { type: 'playlist' }, (err, result) => {
					if (err) return reject(err);

					const playlists = result.items.map((playlist) => ({
						id: playlist.id.playlistId,
						name: playlist.snippet.title,
						image: playlist.snippet && playlist.snippet.thumbnails && playlist.snippet.thumbnails.default ?
							playlist.snippet.thumbnails.default.url :
							undefined,
					}));

					resolve(playlists);
				});
			}),
		])
			.then((results) => [].concat.apply([], results))
			.catch((err) => {
				this.error('YouTubePlaylistAutocomplete error', err.message, err.stack);
				return Promise.reject(err);
			});

	}

	_onFlowActionCastRadioAutocomplete(query) {
		return (query === '' ? tuneIn.browse('local') : tuneIn.search(query))
			.then((result) => {
				const results = (query === '' ? (((result.body || [])[0] || {}).children || []) : (result.body || []));

				const items = [];
				for (const item of results) {
					if (item.item === 'station' && item.URL && item.URL.href) {
						items.push({
							url: item.URL.href,
							name: item.text,
							image: item.image,
						});
						if (items.length === 10) {
							break;
						}
					}
				}

				return items;
			})
			.catch((err) => {
				this.error('CastRadioAutocomplete error', err.message, err.stack);
				return Promise.reject(err);
			});
	}
};
