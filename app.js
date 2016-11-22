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