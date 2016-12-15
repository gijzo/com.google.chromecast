'use strict';

const request = require('request');

const DefaultMediaReceiver = require('castv2-client').DefaultMediaReceiver;
const Browser = require('castv2-athom-browser').Browser;

const Driver = require('../../lib/Driver.js');

if (Homey.env.DEBUG) {
	console.log('[Warning] Running Debug Browser receiver');
	Browser.APP_ID = '57F7BD22';
}

class DriverChromecast extends Driver {

	constructor() {
		super();

		this._id = 'chromecast';
		this._txtMd = ['Chromecast', 'Chromecast Ultra'];

		/*
		 Flow
		 */
		Homey.manager('flow')
			.on('action.castUrl', this._onFlowActionCastUrl.bind(this))
			.on('action.castVideo', this._onFlowActionCastVideo.bind(this));
	}

	/*
	 Flow
	 */
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

	castVideo(device, videoUrl, callback) {
		this.log('castVideo');

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
						if (err) return callback(err);
						callback();
					}
				);
			}).catch(err => {
				callback(err || new Error('Could not cast url'));
			});
		});

	}

	castUrl(device, url, callback) {
		this.log('_onFlowActionStop');

		this.getApplication(device, Browser).then((browser) => {
			browser.redirect(this.sanitizeUrl(url), callback);
		}).catch(err => {
			callback(err || new Error('Could not cast url'));
		});
	}
}

module.exports = (new DriverChromecast());