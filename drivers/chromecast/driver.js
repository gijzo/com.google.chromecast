'use strict';

const request = require('request');

const DefaultMediaReceiver = require('castv2-client').DefaultMediaReceiver;

const Driver = require('../../lib/Driver.js');

const getYoutubeId = require('get-youtube-id');

class DriverChromecast extends Driver {

	constructor() {
		super();

		this._id = 'chromecast';
		this._txtMd = ['Chromecast', 'Chromecast Ultra'];
		this._txtMdBlacklist = ['Google Cast Group', 'Chromecast Audio'];

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

		this.castVideo(device, args.url, callback);
	}

	castVideo(device, videoUrl, callback) {
		this.log('castVideo');

		const url = this.sanitizeUrl(videoUrl);

		// Check if we're dealing with a Youtube URL and respond accordingly
		let youtubeId = getYoutubeId(url);

		if (youtubeId) {
			this.castYoutube(device, youtubeId, callback);
		} else {
			request(url, { method: 'HEAD', timeout: 2000 }, (err, res) => {
				if (err) return callback(err);
				if (!res.headers || res.statusCode !== 200) return callback(new Error('Invalid request from url'));

				this.getApplication(device, DefaultMediaReceiver).then((result) => {
					const player = result.app;
					const disconnect = result.disconnect;

					player.load(
						{
							contentId: url,
							contentType: res.headers['content-type'],
						},
						{
							autoplay: true,
						},
						(err) => {
							disconnect();
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
}

module.exports = (new DriverChromecast());
