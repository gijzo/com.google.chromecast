'use strict';

const events 				= require('events');

const mdns 					= require('mdns-js');
const Client				= require('castv2-client').Client;
const Web					= require('castv2-web').Web;
const DefaultMediaReceiver  = require('castv2-client').DefaultMediaReceiver;

Web.APP_ID 	= '909CFFC5';
Web.APP_URN = 'com.athom.chromecast';

class Driver extends events.EventEmitter {

	constructor() {
		super();

		/*
			Variables
		*/
		this._devices = {};
		this._mdnsDevices = {};

		/*
			Exports
		*/
		this.init 		= this._onInit.bind(this);
		this.added 		= this._onAdded.bind(this);
		this.deleted 	= this._onDeleted.bind(this);
		this.pair 		= this._onPair.bind(this);

		/*
			Discovery
		*/
		this._browser = mdns.createBrowser( mdns.tcp('googlecast') );
		this._browser
			.on('ready', this._onBrowserReady.bind(this))
			.on('update', this._onBrowserUpdate.bind(this))

		/*
			Flow
		*/
		Homey.manager('flow')
			.on('action.castYouTube', this._onFlowActionCastYouTube.bind(this) )
			.on('action.castUrl', this._onFlowActionCastUrl.bind(this) )
			.on('action.castVideo', this._onFlowActionCastVideo.bind(this) )

	}

	/*
		Helper methods
	*/
	log() {
		console.log.bind( null, '[log]' ).apply( null, arguments );
	}

	error() {
		console.error.bind( null, '[err]' ).apply( null, arguments );
	}

	/*
		Discovery
	*/
	_onBrowserReady() {
		this.log('_onBrowserReady');

		this._browser.discover();
	}

	_onBrowserUpdate( device ) {

		if( !Array.isArray(device.txt) ) return;

		// convert txt array to object
		let txtObj = {};
		device.txt.forEach((entry) => {
			entry = entry.split('=');
			txtObj[ entry[0] ] = entry[1];
		});
		device.txt = txtObj;

		if( device.txt.md !== 'Chromecast' ) return;
		if( typeof this._mdnsDevices[ device.txt.id ] !== 'undefined' ) return;

		this.log('Found', device.txt.fn, '@', device.addresses[0] );

		this._mdnsDevices[ device.txt.id ] = device;

		this.emit(`device:${device.txt.id}`);
	}

	/*
		Exports
	*/
	_onInit( devices_data, callback ) {
		this.log('_onInit', devices_data);

		devices_data.forEach(( device_data ) => {
			this._initDevice( device_data );
		});

		callback();
	}

	_onAdded( device_data ) {
		this.log('_onAdded', device_data);
		this._initDevice( device_data );
	}

	_onDeleted( device_data ) {
		this.log('_onDeleted', device_data);
		this._uninitDevice( device_data );

	}

	_onPair( socket ) {

		socket.on('list_devices', ( data, callback ) => {

			let devices = [];

			for( let id in this._mdnsDevices ) {
				let device = this._mdnsDevices[ id ];

				devices.push({
					name: device.txt.fn,
					data: {
						id: id
					}
				})
			}

			callback( null, devices );

		});

	}

	/*
		Internal methods
	*/
	getDevice( device_data ) {
		return this._devices[ device_data.id ] || new Error('invalid_device');
	}

	_initDevice( device_data ) {
		this.log('_initDevice', device_data);

		this.setUnavailable( device_data, __('unavailable') );

		// get local device
		let device = this._mdnsDevices[ device_data.id ];
		if( device ) {
			this._devices[ device_data.id ] = {
				client	: new Client(),
				address	: device.addresses[0],
				state	: {}
			}
			this.setAvailable( device_data );
		} else {
			this.once(`device:${device_data.id}`, () => {
				this._initDevice( device_data );
			})
		}

	}

	_uninitDevice( device_data ) {
		this.log('_uninitDevice', device_data);

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

module.exports = Driver;