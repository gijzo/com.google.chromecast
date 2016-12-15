'use strict';

const request = require('request');

const DefaultMediaReceiver = require('castv2-client').DefaultMediaReceiver;

const Driver = require('../../lib/Driver.js');

class DriverChromecastAudio extends Driver {

	constructor() {
		super();

		this._id = 'chromecast_audio';
		this._txtMd = ['Chromecast Audio'];

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