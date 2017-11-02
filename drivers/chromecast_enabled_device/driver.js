'use strict';

const Driver = require('../../lib/Driver.js');

class DriverChromecastEnabledDevice extends Driver {

	constructor() {
		super();

		this._id = 'chromecast_enabled_device';
		this._txtMd = false; // Disable whitelist and use blacklist instead.
		this._txtMdBlacklist = ['Google Cast Group', 'Chromecast Audio', 'Chromecast', 'Chromecast Ultra'];

		/*
		 Flow
		 */
		Homey.manager('flow')
			.on('action.castVideo', this._onFlowActionCastVideo.bind(this));
	}

	/*
	 Flow
	 */
	_onFlowActionCastVideo(callback, args) {
		this.log('_onFlowActionCastVideo');

		const device = this.getDevice(args.chromecast);
		if (device instanceof Error) return callback(device);

		this.castMediaUrl(device, args.url.trim(), callback);
	}
}

module.exports = (new DriverChromecastEnabledDevice());
