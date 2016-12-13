'use strict';

const events = require('events');

const logger = require('homey-log').Log;
const YouTube = require('youtube-node');
const mdns = require('mdns-js');

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
			.on('action.castYouTubePlaylist.youtube_playlist_id.autocomplete', this._onFlowActionCastYouTubePlaylistAutocomplete.bind(this));

		/*
		 Discovery
		 */
		this._browser = mdns.createBrowser(mdns.tcp('googlecast'));
		this._browser
			.on('ready', this._onBrowserReady.bind(this))
			.on('update', this._onBrowserUpdate.bind(this));

	}

	_onFlowActionCastYouTubeAutocomplete(callback, args) {

		this._youTube.search(args.query, maxSearchResults, { type: 'video' }, (err, result) => {
			if (err) return callback(err);

			const videos = result.items.map((video) => {
				return {
					id: video.id.videoId,
					name: video.snippet.title,
					image: video.snippet.thumbnails.default.url,
				};
			});

			callback(null, videos);
		});

	}

	_onFlowActionCastYouTubePlaylistAutocomplete(callback, args) {

		this._youTube.search(args.query, maxSearchResults, { type: 'playlist' }, (err, result) => {
			if (err) return callback(err);

			const playlists = result.items.map((playlist) => {
				return {
					id: playlist.id.playlistId,
					name: playlist.snippet.title,
					image: playlist.snippet.thumbnails.default.url,
				};
			});

			callback(null, playlists);
		});

	}
}

module.exports = new App();