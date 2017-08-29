'use strict';

const events = require('events');

const logger = require('homey-log').Log;
const YouTube = require('youtube-node');
const getYoutubeId = require('get-youtube-id');
const getYoutubePlaylistId = require('get-youtube-playlist-id');
const mdns = require('mdns-js');
const TuneIn = require('node-tunein');
const tuneIn = new TuneIn();
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

class App extends events.EventEmitter {

	constructor() {
		super();

		this.init = this._onInit.bind(this);
		this.debounceMap = new Map();
		this.argumentsMap = new Map();
	}

	/*
	 Discovery
	 */
	_onBrowserReady() {
		this._discover();
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
	_onInit() {

		console.log(`${Homey.manifest.id} running...`);

		this._youTube = new YouTube();
		this._youTube.setKey(Homey.env.YOUTUBE_KEY);
		this._youTube.addParam('type', 'video');

		Homey.manager('flow')
			.on('action.castYouTube.youtube_id.autocomplete', this.debounce(this._onFlowActionCastYouTubeAutocomplete, 1500))
			.on('action.castYouTubePlaylist.youtube_playlist_id.autocomplete', this.debounce(this._onFlowActionCastYouTubePlaylistAutocomplete, 1500))
			.on('action.castRadio.radio_url.autocomplete', this.debounce(this._onFlowActionCastRadioAutocomplete, 500));

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
		return (function () {
			if (this.debounceMap.has(fn)) {
				const debounceFn = this.debounceMap.get(fn);
				clearTimeout(debounceFn.timeout);
				if (debounceFn.callback) {
					debounceFn.callback(new Error('debounced'));
				}
			}
			let argNames = this.argumentsMap.get(fn);
			if (!argNames) {
				argNames = getParamNames(fn);
				this.argumentsMap.set(fn, argNames);
			}
			const callbackIndex = argNames.indexOf('callback');
			this.debounceMap.set(
				fn,
				setTimeout(
					() => console.log('arguments', arguments) & fn.apply(this, arguments),
					{ timeout, callback: callbackIndex !== -1 ? arguments[callbackIndex] : null }
				)
			);
		}).bind(this);
	}

	_onFlowActionCastYouTubeAutocomplete(callback, args) {

		Promise.all([
			new Promise((resolve, reject) => {
				const youtubeId = getYoutubeId(args.query);
				if (youtubeId) {
					this._youTube.getById(youtubeId, (err, result) => {
						if (err) return reject(err);

						const videos = result.items
							.filter((item) => item.kind === 'youtube#video')
							.map((video) => {
								return {
									id: video.id.videoId,
									name: video.snippet.title,
									image: video.snippet && video.snippet.thumbnails && video.snippet.thumbnails.default ?
										video.snippet.thumbnails.default.url :
										undefined,
								};
							});

						resolve(videos);
					})
				} else {
					resolve([]);
				}
			}),
			new Promise((resolve, reject) => {
				this._youTube.search(args.query, maxSearchResults, { type: 'video' }, (err, result) => {
					if (err) return reject(err);

					const videos = result.items.map((video) => {
						return {
							id: video.id.videoId,
							name: video.snippet.title,
							image: video.snippet && video.snippet.thumbnails && video.snippet.thumbnails.default ?
								video.snippet.thumbnails.default.url :
								undefined,
						};
					});

					resolve(videos);
				});
			}),
		]).then((results) => {
			callback(null, [].concat.apply([], results));
		}).catch((err) => {
			console.log('YouTubeAutocomplete error', err.message, err.stack);
			callback(err);
		});
	}

	_onFlowActionCastYouTubePlaylistAutocomplete(callback, args) {

		Promise.all([
			new Promise((resolve, reject) => {
				const youtubePlaylistId = getYoutubePlaylistId(args.query);
				if (youtubePlaylistId) {
					this._youTube.getPlayListsById(youtubePlaylistId, (err, result) => {
						if (err) return reject(err);

						const playlists = result.items
							.filter((item) => item.kind === 'youtube#playlist')
							.map((playlist) => {
								return {
									id: playlist.id,
									name: playlist.snippet.title,
									image: playlist.snippet && playlist.snippet.thumbnails && playlist.snippet.thumbnails.default ?
										playlist.snippet.thumbnails.default.url :
										undefined,
								};
							});

						resolve(playlists);
					})
				} else {
					resolve([]);
				}
			}),
			new Promise((resolve, reject) => {
				this._youTube.search(args.query, maxSearchResults, { type: 'playlist' }, (err, result) => {
					if (err) return reject(err);

					const playlists = result.items.map((playlist) => {
						return {
							id: playlist.id.playlistId,
							name: playlist.snippet.title,
							image: playlist.snippet && playlist.snippet.thumbnails && playlist.snippet.thumbnails.default ?
								playlist.snippet.thumbnails.default.url :
								undefined,
						};
					});

					resolve(playlists);
				});
			}),
		]).then((results) => {
			callback(null, [].concat.apply([], results));
		}).catch((err) => {
			console.log('YouTubePlaylistAutocomplete error', err.message, err.stack);
			callback(err);
		});

	}

	_onFlowActionCastRadioAutocomplete(callback, args) {

		(args.query === '' ? tuneIn.browse('local') : tuneIn.search(args.query)).then((result) => {

			const items = [];
			for (const item of (args.query === '' ? (((result.body || [])[0] || {}).children || []) : (result.body || []))) {
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

			callback(null, items);
		}).catch((err) => {
			console.log('CastRadioAutocomplete error', err.message, err.stack);
			callback(err);
		});

	}
}

module.exports = new App();