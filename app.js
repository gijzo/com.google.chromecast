'use strict';

const events = require('events');

const logger = require('homey-log').Log;
const YouTube = require('youtube-node');
const getYoutubeId = require('get-youtube-id');
const getYoutubePlaylistId = require('get-youtube-playlist-id');
const mdns = require('mdns-js');
const TuneIn = require('node-tunein');
const tuneIn = new TuneIn();

const maxSearchResults = 5;

class App extends events.EventEmitter {

	constructor() {
		super();

		this.init = this._onInit.bind(this);
	}

	/*
	 Discovery
	 */
	_onBrowserReady() {
		this._browser.discover();
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
			.on('action.castYouTube.youtube_id.autocomplete', this._onFlowActionCastYouTubeAutocomplete.bind(this))
			.on('action.castYouTubePlaylist.youtube_playlist_id.autocomplete', this._onFlowActionCastYouTubePlaylistAutocomplete.bind(this))
			.on('action.castRadio.radio_url.autocomplete', this._onFlowActionCastRadioAutocomplete.bind(this));

		/*
		 Discovery
		 */
		this._browser = mdns.createBrowser(mdns.tcp('googlecast'));
		this._browser
			.on('ready', this._onBrowserReady.bind(this))
			.on('update', this._onBrowserUpdate.bind(this));

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
			})
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

					console.log('playlists', result);
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
			})
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
						image: item.image
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