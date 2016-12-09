'use strict';

const request = require('request');

const DefaultMediaReceiver = require('castv2-client').DefaultMediaReceiver;
const Youtube = require('castv2-youtube').Youtube;

const Driver = require('../../lib/Driver.js');

class DriverChromecastAudio extends Driver {

	constructor() {
		super();

		this._id = 'chromecast_audio';
		this._txtMd = ['Chromecast Audio', 'Google Cast Group'];

		Homey.manager('flow')
			.on('action.castYouTube', this._onFlowActionCastYouTube.bind(this))
			.on('action.castAudio', this._onFlowActionCastAudio.bind(this))
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

	castYoutube(device, youtubeId, callback) {
		this.log('castYoutube');

		this.getApplication(device, Youtube).then((player) => {
			player.load(
				youtubeId,
				{
					targetAudioBitrate: 192,
					contentType: 'audio/',
					autoplay: true,
				},
				callback
			);
		}).catch(err => {
			callback(err || new Error('Could not cast url'));
		});
	}

	castUrl(device, videoUrl, callback) {
		this.log('castUrl');

		const url = this.sanitizeUrl(videoUrl);

		request(url, { method: 'HEAD' }, (err, res) => {
			if (err) return callback(err);
			if (!res.headers || res.statusCode !== 200) return callback(new Error('Invalid request from url'));

			this.getApplication(device, DefaultMediaReceiver).then((player) => {
				player.load(
					{
						contentId: url,
						contentType: res.headers['content-type'],
					},
					{
						autoplay: true,
					},
					(err) => {
						console.log('castUrl', err);
						if (err) return callback(err);
						callback();
					}
				);
			}).catch(err => {
				callback(err || new Error('Could not cast url'));
			});
		});
	}

}

module.exports = (new DriverChromecastAudio());