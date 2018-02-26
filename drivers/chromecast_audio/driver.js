'use strict';

const Homey = require('homey');
const Driver = require('../../lib/ChromecastDriver.js');

module.exports = class ChromecastAudioDriver extends Driver {

	onInit() {
		this._txtMd = ['Google Cast Group', 'Chromecast Audio'];
		// this._txtMdBlacklist = ['Chromecast', 'Chromecast Ultra'];

		super.onInit();

		/*
		 Flow
		 */
		this._flowActionCastAudio = new Homey.FlowCardAction('castAudio')
			.register()
			.registerRunListener(this._onFlowActionCastAudio.bind(this));
	}

	/*
	 Flow
	 */
	_onFlowActionCastAudio(callback, args) {
		this.log('_onFlowActionCastAudio');

		return args.chromecast.castMediaUrl(args.url.trim());
	}
};
