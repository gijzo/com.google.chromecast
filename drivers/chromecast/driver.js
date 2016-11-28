'use strict';

const DefaultMediaReceiver  = require('castv2-client').DefaultMediaReceiver;
const Web					= require('castv2-web').Web;

Web.APP_ID 	= '909CFFC5';
Web.APP_URN = 'com.athom.chromecast';

const Driver = require('../../lib/Driver.js');

class DriverChromecast extends Driver {

	constructor() {
		super();

		this._id = 'chromecast';
		this._txtMd = 'Chromecast';

		/*
			Flow
		*/
		Homey.manager('flow')
			.on('action.castYouTube', this._onFlowActionCastYouTube.bind(this) )
			.on('action.castUrl', this._onFlowActionCastUrl.bind(this) )
			.on('action.castVideo', this._onFlowActionCastVideo.bind(this) )
	}

	/*
		Flow
	*/
	_onFlowActionCastYouTube( callback, args ) {
		this.log('_onFlowActionCastYouTube');

		let device = this.getDevice( args.chromecast );
		if( device instanceof Error ) return callback( device );

		device.client.connect( device.address, ( err ) => {
			if( err ) return callback( err );

			this.log('Connected to Chromecast');

			device.client.launch(Web, (err, manager) => {
			    if( err ) return callback( err );

			    this.log('Connected to Web');

				manager.web.request({
					command: 'loadYoutube',
					args: {
						youtubeId: args.youtube_id.id
					}
				});

				callback();

			});
		});

	}

	_onFlowActionCastVideo( callback, args ) {
		this.log('_onFlowActionCastVideo');

		let device = this.getDevice( args.chromecast );
		if( device instanceof Error ) return callback( device );

		device.client.connect( device.address, ( err ) => {
			if( err ) return callback( err );

			this.log('Connected to Chromecast');

			device.client.launch(DefaultMediaReceiver, (err, player) => {
			    if( err ) return callback( err );

			    this.log('Connected to DefaultMediaReceiver');

			    player.load({
				    contentId: args.url
			    }, {
				    autoplay: true
			    }, ( err, status ) => {
					if( err ) return callback( err );
					callback();
			    });

			});
		});

	}

	_onFlowActionCastUrl( callback, args ) {
		this.log('_onFlowActionCastUrl');

		let device = this.getDevice( args.chromecast );
		if( device instanceof Error ) return callback( device );

		device.client.connect( device.address, ( err ) => {
			if( err ) return callback( err );

			this.log('Connected to Chromecast');

			device.client.launch(Web, (err, manager) => {
			    if( err ) return callback( err );

			    this.log('Connected to Web');

				manager.web.request({
					command: 'loadUrl',
					args: {
						url: args.url
					}
				});

				callback();

			});
		});

	}

}

module.exports = (new DriverChromecast());