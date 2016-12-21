'use strict';

const request = require('request');

const DefaultMediaReceiver = require('castv2-client').DefaultMediaReceiver;

const Driver = require('../../lib/Driver.js');

class DriverChromecastAudio extends Driver {

	constructor() {
		super();

		this._id = 'chromecast_audio';
		this._txtMd = ['Google Cast Group', 'Chromecast Audio'];
		this._txtMdBlacklist = ['Chromecast', 'Chromecast Ultra'];

		Homey.manager('flow')
			.on('action.castAudio', this._onFlowActionCastAudio.bind(this));
	}

	/*
	 Flow
	 */
	_onFlowActionCastAudio(callback, args) {
		this.log('_onFlowActionCastAudio');

		let device = this.getDevice(args.chromecast);
		if (device instanceof Error) return callback(device);

		this.castUrl(device, args.url, callback);
	}

	castUrl(device, audioUrl, callback) {
		this.log('castUrl');

		const url = this.sanitizeUrl(audioUrl);

		request(url, { method: 'HEAD', timeout: 2000 }, (err, res) => {
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

	_onFlowActionCastAudio(callback, args) {
		this.log('_onFlowActionCastAudio');

		let device = this.getDevice(args.chromecast);
		if (device instanceof Error) return;

		this.castUrl(device, args.url, callback);
	}
}

module.exports = (new DriverChromecastAudio());