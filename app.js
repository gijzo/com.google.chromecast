'use strict'

const events				= require('events');

const YouTube 				= require('youtube-node');
const mdns 					= require('mdns-js');

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

	_onBrowserUpdate( device ) {
		this.emit( 'mdns_device', device );
	}

	/*
		Generic
	*/
	_onInit() {

		console.log(`${Homey.manifest.id} running...`);

		this._youTube = new YouTube();
		this._youTube.setKey( Homey.env.YOUTUBE_KEY );
		this._youTube.addParam('type', 'video');

		Homey.manager('flow')
			.on('action.castYouTube.youtube_id.autocomplete', this._onFlowActionCastYouTubeAutocomplete.bind(this));

		/*
			Discovery
		*/
		this._browser = mdns.createBrowser( mdns.tcp('googlecast') );
		this._browser
			.on('ready', this._onBrowserReady.bind(this))
			.on('update', this._onBrowserUpdate.bind(this))

	}

	_onFlowActionCastYouTubeAutocomplete( callback, args ) {

		this._youTube.search(args.query, maxSearchResults, ( err, result ) => {
			if( err ) return callback( err );

			var videos = [];
			result.items.forEach(function(video){
				videos.push({
					id		: video.id.videoId,
					name	: video.snippet.title,
					image	: video.snippet.thumbnails.default.url
				})
			})

			callback( null, videos );
		});

	}
}

module.exports = new App();