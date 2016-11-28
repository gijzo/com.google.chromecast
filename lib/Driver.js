'use strict';

const events 				= require('events');

const Client				= require('castv2-client').Client;

class Driver extends events.EventEmitter {

	constructor() {
		super();

		Homey.app.on('mdns_device', this._onMdnsDevice.bind(this));

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

	}

	/*
		Helper methods
	*/
	log() {
		console.log.bind( null, `[log][${this._id}]` ).apply( null, arguments );
	}

	error() {
		console.error.bind( null, `[err][${this._id}]` ).apply( null, arguments );
	}

	_onMdnsDevice( device ) {
		if( !Array.isArray(device.txt) ) return;

		// convert txt array to object
		let txtObj = {};
		device.txt.forEach((entry) => {
			entry = entry.split('=');
			txtObj[ entry[0] ] = entry[1];
		});
		device.txtObj = txtObj;

		if( device.txtObj.md !== this._txtMd ) return;
		if( typeof this._mdnsDevices[ device.txtObj.id ] !== 'undefined' ) return;

		this.log('Found', device.txtObj.fn, '@', device.addresses[0] );

		this._mdnsDevices[ device.txtObj.id ] = device;

		this.emit(`device:${device.txtObj.id}`);
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
					name: device.txtObj.fn,
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

		if( !device_data.id || device_data.id.length !== 32 )
			return this.setUnavailable( device_data, __('repair') );

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

}

module.exports = Driver;