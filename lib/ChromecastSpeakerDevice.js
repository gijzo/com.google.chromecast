'use strict';

const Media = require('castv2-athom-media').Media;
const Homey = require('homey');
const ChromecastDevice = require('./ChromecastDevice');

if (process.env.DEBUG) {
	console.log('[Warning] Running Debug Media receiver');
	Media.APP_ID = '00F5709C';
}

module.exports = class ChromecastSpeakerDevice extends ChromecastDevice {

	onInit() {
		this.speaker = new Homey.Speaker(this);

		super.onInit();

		this.speaker.on('setActive', (isActive, callback) =>
			this._setSpeakerActive(isActive)
				.then(res => callback(null, res))
				.catch(err => callback(err || new Error('Could not load speaker app')))
		);
		this.speaker.on('setTrack', (track, callback) =>
			this._setTrack(track)
				.then(res => callback(null, res))
				.catch(err => callback(err || new Error('Could not play track')))
		);
		this.speaker.on('setPosition', (position, callback) =>
			this._setPosition(position)
				.then(res => callback(null, res))
				.catch(err => callback(err || new Error('Could not set position')))
		);
	}

	setMdnsData(mdnsData) {
		super.setMdnsData(mdnsData);
		if (!this.speaker.isRegistered) {
			this.registerSpeaker();
		}
	}

	registerSpeaker() {
		return this.speaker.register({
			codecs: [Homey.Codec.MP3],
		});
	}

	unregisterSpeaker() {
		this.speaker.unregister();
	}

	_setTrack({ track, opts = {} }) {
		const artwork = (track.artwork || {});

		return this.getApplication(Media)
			.then(({ app, disconnect }) =>
				new Promise((resolve, reject) => {
					const onStatusListener = (status) => {
						if (status.playerState === (opts.startPlaying ? 'PLAYING' : 'PAUSED')) {
							app.removeListener('status', onStatusListener);
							this.setCapabilityValue('speaker_playing', opts.startPlaying);
							this.speaker.updateState({ track: track, position: opts.position });
							disconnect();
							resolve(track);
						}
					};

					const load = () => {
						app.load(
							{
								contentId: track.stream_url,
								contentType: 'audio/mpeg',
								metadata: {
									title: track.title,
									subtitle: (track.artist || []).map(artist => artist.name).join(', '),
									images: [{
										url: artwork.large || artwork.medium || artwork.small,
									}],
								},
							},
							{
								autoplay: opts.startPlaying,
								currentTime: Math.round(opts.position / 1000),
							},
							(err) => {
								this.log('load result', err);
								if (err) {
									disconnect();
									return reject(err);
								}
								app.on('status', onStatusListener);
							}
						);
					};
					// Initial implementation of queue
					if (this.speaker.queuedCallback) {
						this.speaker.queuedCallback(new Error('setTrack debounced'));
						this.speaker.queuedCallback = null;
						clearTimeout(this.speaker.queuedTimeout);
					}
					if (opts.delay) {
						this.speaker.queuedCallback = (e, r) => {
							disconnect();
							if (e) return reject(e);
							resolve(r);
						};
						this.speaker.queuedTimeout = setTimeout(() => {
							this.speaker.queuedCallback = null;
							this.speaker.queuedTimeout = null;
							load();
						}, opts.delay);
					} else {
						load();
					}
				})
			)
			.catch((err) => {
				this.error('getApplication error', err);
				return Promise.reject(err || new Error('Could not find application to play'));
			});
	}

	_setPosition(position) {
		return this.joinApplication(Media)
			.then(({ app, disconnect }) =>
				new Promise((resolve, reject) =>
					app.seek(Math.round(position / 1000), (err, result) => {
						disconnect();
						this.log('position set', err, result);
						if (err) return reject(err);
						resolve(position);
					})
				)
			)
			.catch((err) => Promise.reject(err || new Error('Could not find application to set position')));
	}

	_setSpeakerActive(isActive) {
		if (isActive) {
			return this.getApplication(Media)
				.then((res) => {
					const app = res.app;

					Promise.all([
						Homey.ManagerCloud.getLocalAddress(),
						new Promise(
							(resolve, reject) =>
								Homey.ManagerPersonalization.getSystemWallpaper((err, result) =>
									err ? reject(err) : resolve(result)
								)
						),
					]).then((result) => {
						if (result[1] === 'default') return;

						this.log('set wallpapaer', `http://${result[0]}${result[1]}`);
						app.setWallpaperUrl(`http://${result[0]}${result[1]}`, () => null);
					});

					// Disabled Base64 wallpaper since chromecast doesnt allow long messages
					// const client = http.createClient(8000, 'localhost');
					// const req = client.request('GET', path, { host: 'localhost' });
					// req.end();
					// req.on('response', (res) => {
					// 	const prefix = `data:${res.headers['content-type']};base64,`;
					// 	let body = '';
					//
					// 	res.setEncoding('binary');
					// 	res.on('end', () => {
					// 		const data = new Buffer(body, 'binary').toString('base64').slice(0, 100);
					// 		console.log(data);
					// 		player.setWallpaperUrl(prefix + data, console.log.bind(null, 'wallpaper pushed'));
					// 	});
					// 	res.on('data', (chunk) => {
					// 		if (res.statusCode === 200) {
					// 			body += chunk;
					// 		}
					// 	});
					// });

					this.log('player loaded', app);

					const updateStateInteval = setInterval(() => {
						app.getStatus((err, status) => {
							// console.log('GOT STATUS', err, require('util').inspect(status, { depth: 9 }));
							if (status) {
								if (status.playerState === 'PLAYING') {
									this.setCapabilityValue('speaker_playing', true);
								} else {  // } if (status.playerState === 'PAUSED') {
									this.setCapabilityValue('speaker_playing', false);
								}
								this.speaker.updateState({ position: Math.round(status.currentTime * 1000) });
							}
						});
					}, 5000);
					app.on('close', () => {
						this.log('app closed!');
						this.speaker.setInactive(new Error('disconnected'));
						clearInterval(updateStateInteval);
					});
					return isActive;
				})
				.catch((err) => {
					this.error('ERROR loading', err);
					return Promise.reject(err);
				});
		}

		return new Promise((resolve) => this.stop(() => resolve(false)));
	}
};
