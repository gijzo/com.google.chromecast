'use strict';

const DefaultMediaReceiver = require('castv2-client').DefaultMediaReceiver;
const Web = require('castv2-web').Web;

Web.APP_ID = '909CFFC5';
Web.APP_URN = 'com.athom.chromecast';

const Driver = require('../../lib/Driver.js');

class DriverChromecast extends Driver {

	constructor() {
		super();

		this._id = 'chromecast';
		this._txtMd = 'Chromecast';
		this.player = null;

		/*
		 Flow
		 */
		Homey.manager('flow')
			.on('action.castYouTube', this._onFlowActionCastYouTube.bind(this))
			.on('action.castUrl', this._onFlowActionCastUrl.bind(this))
			.on('action.castVideo', this._onFlowActionCastVideo.bind(this))
			.on('action.setVolume', this._onFlowActionSetVolume.bind(this))
			.on('action.mute', this._onFlowActionMute.bind(this, true))
			.on('action.unmute', this._onFlowActionMute.bind(this, false))
			.on('action.play', this._onFlowActionPlay.bind(this))
			.on('action.pause', this._onFlowActionPause.bind(this))
			.on('action.stop', this._onFlowActionStop.bind(this));
	}

	/*
	 Flow
	 */
	_onFlowActionCastYouTube(callback, args) {
		this.log('_onFlowActionCastYouTube');

		let device = this.getDevice(args.chromecast);
		if (device instanceof Error) return callback(device);

		this.castYoutube(device, args.youtube_id.id, callback);
	}

	_onFlowActionCastVideo(callback, args) {
		this.log('_onFlowActionCastVideo');

		let device = this.getDevice(args.chromecast);
		if (device instanceof Error) return callback(device);

		this.castVideo(device, args.url, callback)
	}

	_onFlowActionCastUrl(callback, args) {
		this.log('_onFlowActionCastUrl');

		let device = this.getDevice(args.chromecast);
		if (device instanceof Error) return callback(device);

		this.castUrl(device, args.url, callback)

	}

	_onFlowActionSetVolume(callback, args) {
		this.log('_onFlowActionSetVolume');

		let device = this.getDevice(args.chromecast);
		if (device instanceof Error) return callback(device);

		this.setVolume(device, { level: args.level }, (err, result) => callback(null, true));
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

	castYoutube(device, youtubeId, callback) {
		this.log('castYoutube');

		this.getApplication(device, Web, (err, player) => {
			if (err) return callback(err);

			player.web.request({
				command: 'loadYoutube',
				args: {
					youtubeId: youtubeId
				}
			});

			return callback();
		});
	}

	castVideo(device, videoUrl, callback) {
		this.log('castVideo');

		this.getApplication(device, DefaultMediaReceiver, (err, player) => {
			if (err) return callback(err);

			player.load({
				contentId: this.sanitizeUrl(videoUrl),
			}, {
				autoplay: true,
			}, (err, status) => {
				if (err) return callback(err);
				callback();
			});
		});
	}

	castUrl(device, url, callback) {
		this.log('_onFlowActionStop');

		this.getApplication(device, Web, (err, player) => {
			if (err) return callback(err);

			player.web.request({
				command: 'loadUrl',
				args: {
					url: this.sanitizeUrl(url),
				},
			});

			return callback();
		});
	}
}

module.exports = (new DriverChromecast());