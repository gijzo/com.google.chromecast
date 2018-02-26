'use strict';

const DefaultMediaReceiver = require('castv2-client').DefaultMediaReceiver;
const Client = require('castv2-client').Client;
const Youtube = require('castv2-athom-youtube').Youtube;
const Browser = require('castv2-athom-browser').Browser;
const Media = require('castv2-athom-media').Media;
const uuid = require('uuid');
const request = require('request');
const getYoutubeId = require('get-youtube-id');

const Homey = require('homey');

const hasHttpRegex = new RegExp(/^[a-z]*:\/\//i);

if (process.env.DEBUG) {
	console.log('[Warning] Running Debug YouTube receiver');
	Youtube.APP_ID = '0A938E83';
	console.log('[Warning] Running Debug Browser receiver');
	Browser.APP_ID = '57F7BD22';
	console.log('[Warning] Running Debug Media receiver');
	Media.APP_ID = '00F5709C';
}

module.exports = class ChromecastDevice extends Homey.Device {

	onInit() {
		super.onInit();

		if (!this.getData().id || this.getData().id.length !== 32) {
			return this.setUnavailable(Homey.__('repair'));
		}

		this.setUnavailable(Homey.__('unavailable'));

		this.registerCapabilityListener('speaker_playing', play => play ? this.play() : this.pause());
		this.registerCapabilityListener('speaker_prev', this.previous.bind(this));
		this.registerCapabilityListener('speaker_next', this.next.bind(this));
		this.registerCapabilityListener('volume_mute', (value) => this.setVolume({ muted: value }));
		this.registerCapabilityListener('volume_set', (value) => this.setVolume({ level: value }));

		// get local device
		const mdnsData = this.getDriver().getMdnsDeviceData(this);
		if (mdnsData) {
			this.setMdnsData(mdnsData);
		}
		this.getDriver().on(`device:${this.getData().id}`, this.setMdnsData.bind(this));
	}

	setMdnsData(mdnsData) {
		if (this.address !== mdnsData.address || this.port !== mdnsData.port) {
			// TODO do something when address changed
		}

		this.address = mdnsData.addresses[0];
		this.port = mdnsData.port;
		this.apps = {};
		this.mdnsData = mdnsData;

		this.setAvailable();
	}

	_connect() {
		this.log('_connect');

		if (!this.client) {
			this.client = new Client();
			this.client._connectionLock = new Set();
			this.client._closingConnections = new Set();
			this.client.client.once('close', () => this.client = null);
		}

		const lockUuid = uuid.v4();
		const client = this.client;
		let connection = client.connection;

		if (!connection) {
			return new Promise((resolve, reject) => {

				const onConnectError = (err) => {
					reject(err);
				};

				client.once('error', onConnectError);

				if (client.isConnecting) {
					client._connectionLock.add(lockUuid);
					this.log('waiting for connection', lockUuid, client._connectionLock.size);
					return client.client.on('connect', () => {
						client.removeListener('error', onConnectError);
						resolve(this._closeConnection.bind(this, lockUuid));
					});
				}

				client.isConnecting = true;
				client._connectionLock.add(lockUuid);
				this.log('creating new connection', lockUuid, client._connectionLock.size);

				const onError = (err) => {
					this.error(err);
					client.close();
					client._closingConnections.delete(connection);
					client._connectionLock.clear();
				};

				client.on('error', onError);

				client.connect({ host: this.address, port: this.port }, (err) => {
					client.removeListener('error', onConnectError);
					client.isConnecting = false;

					if (err) return reject(err);

					this.log('Connected to', this.address);

					connection = client.connection;

					let updateStateInterval;
					const updateState = () => {
						if (client.receiver) {
							client.getStatus((err, status) => {
								if (status && status.volume) {
									this.setCapabilityValue('volume_set', Math.round(status.volume.level * 100) / 100);
									this.setCapabilityValue('volume_mute', status.volume.muted);
								}
							});
						} else {
							this.error('Updating status while device disconnected');
							clearInterval(updateStateInterval);
						}
					};
					updateStateInterval = setInterval(updateState, 5000);
					updateState();

					client.once('close', () => {
						clearInterval(updateStateInterval);
						client.removeListener('error', onError);
						client._closingConnections.delete(connection);
						client._connectionLock.clear();
					});

					resolve(this._closeConnection.bind(this, client, lockUuid));
				});
			});
		} else if (client._closingConnections.has(connection)) {
			return new Promise(resolve =>
				client.once('close', () => resolve(this._connect()))
			);
		}
		client._connectionLock.add(lockUuid);
		this.log('adding new connection lock', lockUuid, client._connectionLock.size);
		return Promise.resolve(this._closeConnection.bind(this, client, lockUuid));
	}

	_closeConnection(client, lockUuid) {
		this.log('_closeConnection');
		if (!lockUuid) {
			throw new Error('Connection lock uuid should not be empty');
		}

		client._connectionLock.delete(lockUuid);
		this.log('removing connection lock', lockUuid, client._connectionLock.size);

		if (client._connectionLock.size === 0) {
			if (client.client && client.client.socket) {
				client._closingConnections.add(client.connection);
				client.close();
				this.log('Disconnected from device', this.address);
			}
		}
	}


	joinApplication(Applications) {
		this.log('joinApplication');
		// Transform Applications to an array if it is not one and filter out the Web application
		Applications = (Array.isArray(Applications) ? Applications : [Applications])
			.filter(Application => Application && Application.name !== 'Browser');
		if (!Applications.length) return Promise.reject(new Error('No (valid) application given'));

		return this._connect().then((disconnect) =>
			new Promise((resolve, reject) => {
				this.client.getSessions((err, sessions) => {
					if (err) return disconnect() & reject(err);

					const session = sessions.find(s => Applications.some(Application => s.appId === Application.APP_ID));

					if (!session) {
						disconnect();
						return reject();
					}
					const Application = Applications.find(App => App.APP_ID === session.appId);

					this.client.join(session, Application, (err, app) => {
						if (err) {
							disconnect();
							return reject(err);
						}

						app.once('close', disconnect);

						this.log('Joined', Application.name);

						// Force status to update
						if (typeof app.getStatus === 'function') {
							app.getStatus((() => null));
						}

						resolve({ app, disconnect });
					});
				});
			})
		);
	}

	getApplication(Application) {
		this.log('getApplication');
		if (!this.apps[Application.APP_ID] || Application.name === 'Browser') {
			const appPromise = this.apps[Application.APP_ID] = this._connect().then((disconnect) =>
				new Promise((resolve, reject) => {

					this.joinApplication(Application).then((result) => {
						const app = result.app;
						const _disconnect = () => {
							disconnect();
							result.disconnect();
						};


						app.once('close', () => {
							if (this.apps[Application.APP_ID] === appPromise) {
								this.apps[Application.APP_ID] = null;
							}
							_disconnect();
						});

						resolve({
							app,
							disconnect: _disconnect,
						});
					}).catch(() => {

						this.client.launch(Application, (err, app) => {
							if (err) {
								if (this.apps[Application.APP_ID] === appPromise) {
									this.apps[Application.APP_ID] = null;
								}
								disconnect();
								return reject(err);
							}

							app.once('close', () => {
								if (this.apps[Application.APP_ID] === appPromise) {
									this.apps[Application.APP_ID] = null;
								}
								disconnect();
							});

							this.log('Launched', Application.name);

							resolve({ app, disconnect });
						});
					});
				})
			).catch((err) => {
				this.error('getApllication error', err);
				if (this.apps[Application.APP_ID] === appPromise) {
					this.apps[Application.APP_ID] = null;
				}
				return Promise.reject(err);
			});
			return appPromise;
		}
		return this._connect().then(disconnect =>
			this.apps[Application.APP_ID].then(result =>
				Object.assign(result, { disconnect })
			)
		);
	}

	castMediaUrl(audioUrl) {
		this.log('castUrl');

		const url = this.sanitizeUrl(audioUrl).trim();

		// Check if we're dealing with a Youtube URL and respond accordingly
		const youtubeId = getYoutubeId(url);
		if (youtubeId) return this.castYoutube(youtubeId);

		return new Promise((resolve, reject) =>
			request(url, { method: 'HEAD', timeout: 2000 }, (err, result) => {
				if (err) return reject(err);
				if (!result.headers || result.statusCode !== 200) return reject(new Error('Invalid request from url'));

				return resolve(
					this.getApplication(DefaultMediaReceiver)
						.then(({ app: player, disconnect }) =>
							new Promise((res, rej) =>
								player.load(
									{
										contentId: url,
										contentType: result.headers['content-type'],
									},
									{
										autoplay: true,
									},
									(err) => {
										disconnect();
										if (err) return rej(err);
										res();
									}
								)
							)
						)
						.catch(err => Promise.reject(err || new Error('Could not cast url')))
				);
			})
		);
	}

	play() {
		return this.joinApplication([Youtube, DefaultMediaReceiver, Media])
			.then(({ app, disconnect }) =>
				new Promise((resolve, reject) =>
					app.play((err, result) => {
						disconnect();
						if (err) return reject(err);

						this.setCapabilityValue('speaker_playing', true)
						resolve(result);
					})
				)
			)
			.catch((err) => Promise.reject(err || new Error('Could not find application to play')));
	}

	getPlaying() {
		return this.joinApplication([Youtube, DefaultMediaReceiver, Media])
			.then(({ app, disconnect }) =>
				new Promise((resolve, reject) =>
					app.getState((err, state) => {
						disconnect();
						if (err) return reject(err);

						if (state.playerState === 'PLAYING') {  // || state.playerState === 'PAUSED') {
							resolve(true);
						} else {
							resolve(false);
						}
					})
				)
			)
			.catch((err) => {
				if (err) {
					return Promise.reject(err);
				}
				return false;
			});
	}

	pause() {
		return this.joinApplication([Youtube, DefaultMediaReceiver, Media])
			.then(({ app, disconnect }) => {

				if (app instanceof Media && this.speaker && this.speaker.queuedCallback) {
					clearTimeout(this.speaker.queuedTimeout);
					this.speaker.queuedCallback(new Error('debounced'));
					this.speaker.queuedCallback = null;
				}

				return new Promise((resolve, reject) =>
					app.pause((err, result) => {
						disconnect();
						if (err) return reject(err);
						this.setCapabilityValue('speaker_playing', false);
						resolve(result);
					})
				);
			})
			.catch((err) => Promise.reject(err || new Error('Could not find application to pause')));
	}

	previous() {
		return this.joinApplication([Youtube])
			.then(({ app, disconnect }) =>
				new Promise((resolve, reject) => {
					app.previous((err, result) => {
						disconnect();
						if (err) return reject(err);
						resolve(result);
					});
				})
			)
			.catch((err) => Promise.reject(err || new Error('Could not find application to send previous')));
	}

	next() {
		console.log('NEXT');
		return this.joinApplication([Youtube])
			.then(({ app, disconnect }) =>
				new Promise((resolve, reject) => {
					app.next((err, result) => {
						disconnect();
						if (err) return reject(err);
						resolve(result);
					});
				})
			)
			.catch((err) => Promise.reject(err || new Error('Could not find application to send next')));
	}

	setLoop(shouldLoop) {
		this.setStoreValue('loop', shouldLoop);
		return this.joinApplication([Youtube])
			.then(({ app, disconnect }) =>
				new Promise((resolve, reject) => {
					app.loop(shouldLoop, (err, result) => {
						disconnect();
						if (err) return reject(err);
						resolve(result);
					});
				})
			)
			.catch((err) => Promise.reject(err || new Error('Could not find application to set loop state for')));
	}

	setShuffle(shouldShuffle) {
		this.setStoreValue('shuffle', shouldShuffle);
		return this.joinApplication([Youtube])
			.then(({ app, disconnect }) =>
				new Promise((resolve, reject) => {
					app.shuffle(shouldShuffle, (err, result) => {
						disconnect();
						if (err) return reject(err);
						resolve(result);
					});
				})
			)
			.catch((err) => Promise.reject(err || new Error('Could not find application to set shuffle state for')));
	}

	stop() {
		return this._connect()
			.then((disconnect) =>
				new Promise((resolve, reject) =>
					this.client.getSessions((err, sessions) => {
						this.log('got sessions to stop', err, sessions);
						if (err) {
							disconnect();
							return reject(err);
						}
						if (!sessions || sessions.length === 0) {
							disconnect();
							return reject();
						}

						resolve(
							Promise.all(
								sessions.map((session) => new Promise((res, rej) =>
									this.client.receiver.stop(session.sessionId, (err) => err ? rej(err) : res())
								))
							)
								.then(() => disconnect())
								.catch((err) => {
									disconnect();
									return Promise.reject(err);
								})
						);
					})
				)
			)
			.catch((err) => Promise.reject(err || new Error('Could not find application to stop')));
	}

	setVolume(volume) {
		this.log('setVolume');
		return this._connect()
			.then((disconnect) =>
				new Promise((resolve, reject) => {
					this.client.setVolume(volume, (err, result) => {
						disconnect();
						if (err) return reject(err);

						resolve(result);
					});
				})
			)
			.catch((err) => Promise.reject(err || new Error('Could not set volume')));
	}

	getVolume() {
		this.log('getVolume');
		return this._connect()
			.then((disconnect) =>
				new Promise((resolve, reject) => {
					this.client.getVolume((err, volume) => {
						disconnect();
						if (err) return reject(err);
						this.setCapabilityValue('volume_set', volume);
						resolve(volume);
					});
				})
			)
			.catch((err) => Promise.reject(err || new Error('Could not get volume')));
	}

	sanitizeUrl(url) {
		if (hasHttpRegex.test(url)) {
			return url;
		}
		return 'http://'.concat(url);
	}

	castYoutube(youtubeId) {
		this.log('castYoutube');

		return this.getApplication(Youtube)
			.then(({ app, disconnect }) =>
				new Promise((resolve, reject) => {
					app.loadVideo(
						youtubeId,
						{
							autoplay: true,
							loop: this.getStoreValue('loop'),
						},
						(err, result) => {
							disconnect();
							if (err) return reject(err);
							resolve(result);
						}
					);
				})
			)
			.catch(err => Promise.reject(err || new Error('Could not cast youtube video')));
	}

	castYoutubePlaylist(youtubePlaylistId) {
		this.log('castYoutubePlaylist');

		return this.getApplication(Youtube)
			.then(({ app, disconnect }) =>
				new Promise((resolve, reject) => {
					app.loadPlaylist(
						youtubePlaylistId,
						{
							autoplay: true,
							shuffle: this.getStoreValue('shuffle'),
							loop: this.getStoreValue('loop'),
						},
						(err, result) => {
							disconnect();
							if (err) return reject(err);
							resolve(result);
						}
					);
				})
			)
			.catch(err => Promise.reject(err || new Error('Could not cast youtube playlist')));
	}

	castRadio(radio) {
		this.log('castUrl');

		return new Promise((resolve, reject) => {
			request(radio.url, { method: 'GET', timeout: 2000 }, (err, res) => {
				this.log(radio.url, err, res ? res.body : null);
				if (err) return reject(err);
				if (!res.headers || res.statusCode !== 200) return reject(new Error('Invalid request from url'));

				const url = res.body.split('\n')[0];

				resolve(
					this.getApplication(DefaultMediaReceiver)
						.then((result) => {
							const player = result.app;
							const disconnect = result.disconnect;

							return new Promise((resolveLoad, rejectLoad) => {
								player.load(
									{
										contentId: url,
										contentType: 'audio/mpeg',
										streamType: 'LIVE',
										metadata: {
											title: radio.name,
											images: [{
												url: radio.image,
											}],
										},
									},
									{
										autoplay: true,
									},
									(err) => {
										if (err) {
											player.load(
												{
													contentId: `${url}/;stream.mp3`,
													contentType: 'audio/mpeg',
													streamType: 'LIVE',
													metadata: {
														title: radio.name,
														images: [{
															url: radio.image,
														}],
													},
												},
												{
													autoplay: true,
												},
												(err) => {
													disconnect();
													if (err) return rejectLoad(err);
													resolveLoad();
												}
											);
										} else {
											disconnect();
											resolveLoad();
										}
									}
								);
							});
						})
				);
			});
		}).catch(err => Promise.reject(err || new Error('Could not cast radio station')));
	}

	castUrl(url) {
		this.log('castUrl', url);

		return this.getApplication(Browser)
			.then(({ app, disconnect }) =>
				new Promise((resolve, reject) => {
					app.redirect(
						this.sanitizeUrl(url.trim()),
						(err, result) => {
							disconnect();
							if (err) return reject(err);
							resolve(result);
						}
					);
				})
			)
			.catch(err => Promise.reject(err || new Error('Could not cast url')));
	}
};
