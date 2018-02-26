'use strict';

const Homey = require('homey');
const Driver = require('../../lib/ChromecastDriver.js');

module.exports = class ChromecastEnabledDeviceDriver extends Driver {

	onInit() {
		this._txtMd = false; // Disable whitelist and use blacklist instead.
		this._txtMdBlacklist = ['Google Cast Group', 'Chromecast Audio', 'Chromecast', 'Chromecast Ultra'];

		super.onInit();

		/*
		 Flow
		 */
		this._flowActionCastVideo = new Homey.FlowCardAction('castVideo')
			.register()
			.registerRunListener(this._onFlowActionCastVideo.bind(this));
	}

	/*
	 Flow
	 */
	_onFlowActionCastVideo(args) {
		this.log('_onFlowActionCastVideo');

		return args.chromecast.castMediaUrl(args.url.trim());
	}
};
