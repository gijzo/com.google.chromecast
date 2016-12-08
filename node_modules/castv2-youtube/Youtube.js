'use strict';

const util = require('util');
const ytdl = require('ytdl-core');
const castv2Cli = require('castv2-client');
const DefaultMediaReceiver = castv2Cli.DefaultMediaReceiver;
const MediaController = castv2Cli.MediaController;

function Youtube(client, session) {
	DefaultMediaReceiver.apply(this, arguments);
}

util.inherits(Youtube, DefaultMediaReceiver);

Youtube.APP_ID = DefaultMediaReceiver.APP_ID;

Youtube.prototype.load = function (videoId, options, callback) {
	options = Object.assign({ contentType: 'video/mp4' }, options);
	ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`, (err, info) => {
		if (err) return callback(err);
		if (!info || !info.formats || info.formats.length === 0) return callback(new Error('Invalid youtube url'));

		const format = info.formats
			.map(format =>
				Object.assign(format, { resolution: format.resolution ? Number(format.resolution.slice(0, -1)) : null })
			)
			.filter(format =>
				format.type && format.type.indexOf(options.contentType) !== -1 &&
				(!options.targetResolution || format.resolution && format.resolution <= options.targetResolution) &&
				(!options.targetBitrate || format.bitrate && format.bitrate <= options.targetBitrate) &&
				(!options.targetAudioBitrate || format.audioBitrate && format.audioBitrate <= options.targetAudioBitrate) &&
				(!options.audioEncoding || format.audioEncoding && (
						format.audioEncoding === options.audioEncoding ||
						(Array.isArray(options.audioEncoding) && options.audioEncoding.contains(format.audioEncoding))
					)
				)
			)
			.sort((a, b) => {
				if (options.targetResolution && b.resolution !== a.resolution) {
					return b.resolution - a.resolution;
				} else if (options.targetBitrate && b.bitrate !== a.bitRate) {
					return b.bitrate - a.bitRate;
				} else if (options.targetAudioBitrate && b.audioBitrate !== a.audioBitrate) {
					return b.audioBitrate - a.audioBitrate;
				} else {
					return 0;
				}
			})[0];

		if (!format || !format.url) return callback(new Error('No applicable video format found'));

		console.log('selected format', format);

		DefaultMediaReceiver.prototype.load.call(
			this,
			{
				contentId: format.url,
				contentType: format.type || options.contentType || 'video/mp4',
			},
			options,
			callback
		);
	})
};

module.exports = Youtube;
