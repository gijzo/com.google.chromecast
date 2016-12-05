'use strict';

const DefaultMediaReceiver = require('castv2-client').DefaultMediaReceiver;

const Driver = require('../../lib/Driver.js');

class DriverChromecastAudio extends Driver {

	constructor() {
		super();

		this._id = 'chromecast_audio';
		this._txtMd = 'Chromecast Audio';

		Homey.manager('flow')
			.on('action.castAudio', this._onFlowActionCastAudio.bind(this))
			.on('action.setVolume', this._onFlowActionSetVolume.bind(this))
			.on('action.mute', this._onFlowActionMute.bind(this, true))
			.on('action.unmute', this._onFlowActionMute.bind(this, false))
			.on('action.play', this._onFlowActionPlay.bind(this))
			.on('action.pause', this._onFlowActionPause.bind(this))
			.on('action.stop', this._onFlowActionStop.bind(this));
	}

	_onFlowActionCastAudio(callback, args) {
		this.log('_onFlowActionCastAudio');

		let device = this.getDevice(args.chromecast);
		if (device instanceof Error) return callback(device);

		this.castUrl(device, args.url, callback);
	}

	_onFlowActionSetVolume(callback, args) {
		this.log('_onFlowActionSetVolume');

		let device = this.getDevice(args.chromecast);
		if (device instanceof Error) return callback(device);

		this.setVolume(device, { level: args.level }, (err, result) => callback());
	}

	_onFlowActionMute(muted, callback, args) {
		this.log('_onFlowActionMute');

		let device = this.getDevice(args.chromecast);
		if (device instanceof Error) return callback(device);

		this.setVolume(device, { muted }, (err, result) => callback(err, result));
	}

	_onFlowActionPlay(callback, args) {
		this.log('_onFlowActionPlay');

		let device = this.getDevice(args.chromecast);
		if (device instanceof Error) return callback(device);

		this.play(device, (err, result) => callback(err, result));
	}

	_onFlowActionPause(callback, args) {
		this.log('_onFlowActionPause');

		let device = this.getDevice(args.chromecast);
		if (device instanceof Error) return callback(device);

		this.pause(device, (err, result) => callback(err, result));
	}

	_onFlowActionStop(callback, args) {
		this.log('_onFlowActionStop');

		let device = this.getDevice(args.chromecast);
		if (device instanceof Error) return callback(device);

		this.stop(device, (err, result) => callback(err, result));
	}

	castUrl(device, url, callback) {
		this.getApplication(device, DefaultMediaReceiver, (err, player) => {
			if (err) return callback(err);

			player.load({
				contentId: this.sanitizeUrl(url)
			}, {
				autoplay: true
			}, (err, status) => {
				if (err) return callback(err);
				callback();
			});
		});
	}

}

module.exports = (new DriverChromecastAudio());