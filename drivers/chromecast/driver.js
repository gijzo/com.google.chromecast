'use strict';

const Driver = require('../../lib/Driver.js');

class DriverChromecast extends Driver {

	constructor() {
		super();

		this._id = 'chromecast';
		this._txtMd = ['Chromecast', 'Chromecast Ultra'];
		// this._txtMdBlacklist = ['Google Cast Group', 'Chromecast Audio'];

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
		if (device instanceof Error) return;

		this.castMediaUrl(device, args.url.trim(), callback);
	}
}

module.exports = (new DriverChromecast());
