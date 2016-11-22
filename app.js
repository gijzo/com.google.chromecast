'use strict'

const YouTube = require('youtube-node');

const maxSearchResults = 5;

class App {

	constructor() {
		this.init = this._onInit.bind(this);
	}

	_onInit() {

		console.log(`${Homey.manifest.id} running...`);

		this._youTube = new YouTube();
		this._youTube.setKey( Homey.env.YOUTUBE_KEY );
		this._youTube.addParam('type', 'video');

		Homey.manager('flow')
			.on('action.castYouTube.youtube_id.autocomplete', this._onFlowActionCastYouTubeAutocomplete.bind(this));

		// Catch all errors. Note: this should be removed as soon as possible by fixing the dependencies
		// This is NOT recommended to do in an app
		process.removeAllListeners('uncaughtException');
		process.on('uncaughtException', ( e ) => {
			console.log('uncaughtException', e.stack )
		})

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