'use strict';

const Driver = require('../../lib/Driver.js');

class DriverChromecastAudio extends Driver {

	constructor() {
		super();

		this._id = 'chromecast_audio';
		this._txtMd = ['Google Cast Group', 'Chromecast Audio'];
		// this._txtMdBlacklist = ['Chromecast', 'Chromecast Ultra'];

		Homey.manager('flow')
			.on('action.castAudio', this._onFlowActionCastAudio.bind(this));
	}

	/*
	 Flow
	 */
	_onFlowActionCastAudio(callback, args) {
		this.log('_onFlowActionCastAudio');

		const device = this.getDevice(args.chromecast);
		if (device instanceof Error) return callback(device);

		this.castMediaUrl(device, args.url, callback);
	}
}

module.exports = (new DriverChromecastAudio());
