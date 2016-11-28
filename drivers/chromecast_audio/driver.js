'use strict';

const DefaultMediaReceiver  = require('castv2-client').DefaultMediaReceiver;

const Driver = require('../../lib/Driver.js');

class DriverChromecastAudio extends Driver {

	constructor() {
		super();

		this._id = 'chromecast_audio';
		this._txtMd = 'Chromecast Audio';

		Homey.manager('flow')
			.on('action.castAudio', this._onFlowActionCastAudio.bind(this) )
	}

	_onFlowActionCastAudio( callback, args ) {
		this.log('_onFlowActionCastAudio');

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


}

module.exports = (new DriverChromecastAudio());