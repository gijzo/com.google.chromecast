'use strict';

const events = require('events');

const logger = require('homey-log').Log;
const DefaultMediaReceiver = require('castv2-client').DefaultMediaReceiver;
const Client = require('castv2-client').Client;
const Youtube = require('castv2-athom-youtube').Youtube;
const Browser = require('castv2-athom-browser').Browser;
const Media = require('castv2-athom-media').Media;
const uuid = require('uuid');
const request = require('request');


const settingsManager = Homey.manager('settings');

const hasHttpRegex = new RegExp(/^[a-z]*:\/\//i);
const reportedIds = new Set();

if (process.env.DEBUG) {
	console.log('[Warning] Running Debug YouTube receiver');
	Youtube.APP_ID = '0A938E83';
	console.log('[Warning] Running Debug Browser receiver');
	Browser.APP_ID = '57F7BD22';
	console.log('[Warning] Running Debug Media receiver');
	Media.APP_ID = '00F5709C';
}

class Driver extends events.EventEmitter {

	constructor() {
		super();

		Homey.app.on('mdns_device', this._onMdnsDevice.bind(this));
		this.mdnsStarted = Date.now();

		/*
		 Variables
		 */
		this._devices = {};
		this._mdnsDevices = {};
		this._connectionLock = new Set();
		this._closingConnections = new Set();

		/*
		 Exports
		 */
		this.init = this._onInit.bind(this);
		this.added = this._onAdded.bind(this);
		this.deleted = this._onDeleted.bind(this);
		this.pair = this._onPair.bind(this);

		Homey.manager('flow')
			.on('action.castYouTube', this._onFlowActionCastYouTube.bind(this))
			.on('action.castYouTubePlaylist', this._onFlowActionCastYouTubePlaylist.bind(this))
			.on('action.castRadio', this._onFlowActionCastRadio.bind(this))
			.on('action.castUrl', this._onFlowActionCastUrl.bind(this))
			.on('action.setVolume', this._onFlowActionSetVolume.bind(this))
			.on('action.mute', this._onFlowActionMute.bind(this, true))
			.on('action.unmute', this._onFlowActionMute.bind(this, false))
			.on('action.play', this._onFlowActionPlay.bind(this))
			.on('action.pause', this._onFlowActionPause.bind(this))
			.on('action.previous', this._onFlowActionPrevious.bind(this))
			.on('action.next', this._onFlowActionNext.bind(this))
			.on('action.stop', this._onFlowActionStop.bind(this))
			.on('action.loop', this._onFlowActionLoop.bind(this))
			.on('action.shuffle', this._onFlowActionShuffle.bind(this));
	}

	/*
	 Helper methods
	 */
	log() {
		console.log.bind(null, `[log][${this._id}]`).apply(null, arguments);
	}

	error() {
		console.error.bind(null, `[err][${this._id}]`).apply(null, arguments);
	}

	_onMdnsDevice(device) {
		if (!Array.isArray(device.txt)) return;

		// convert txt array to object
		const txtObj = {};
		device.txt.forEach((entry) => {
			entry = entry.split('=');
			txtObj[entry[0]] = entry[1];
		});
		device.txtObj = txtObj;

		if (!(device.txtObj && device.txtObj.md && device.txtObj.id && device.txtObj.fn)) {
			return;
		} else if (this._txtMd.indexOf(device.txtObj.md) === -1) {
			if (device.type.find(type => type.name === 'googlecast') && this._txtMdBlacklist.indexOf(device.txtObj.md) === -1) {
				const id = device.txtObj.id.replace(/-/g, '');
				if (!reportedIds.has(id)) {
					reportedIds.add(id);
					logger.captureMessage('Unknown chromecast device found', {
						extra: { device },
						tags: { md: device.txtObj.md },
						level: 'info',
					});
				}
			} else {
				return;
			}
		}

		const id = device.txtObj.id.replace(/-/g, '');

		if (
			this._mdnsDevices[id] &&
			this._mdnsDevices[id].addresses[0] === device.addresses[0] &&
			this._mdnsDevices[id].port === device.port
		) {
			return;
		}

		this.log('Found', device.txtObj.fn, '@', device.addresses[0]);

		this._mdnsDevices[id] = device;

		this.emit(`device:${id}`);
	}

	/*
	 Exports
	 */
	_onInit(devices_data, callback) {
		this.log('_onInit', devices_data);

		devices_data.forEach((device_data) => {
			this._initDevice(device_data);
		});

		callback();
	}

	_onAdded(device_data) {
		this.log('_onAdded', device_data);
		this._initDevice(device_data);
	}

	_onDeleted(device_data) {
		this.log('_onDeleted', device_data);
		this._uninitDevice(device_data);

	}

	_onPair(socket) {

		socket.on('list_devices', (data, callback) => {
			const returnDevices = () => callback(
				null,
				Object.keys(this._mdnsDevices).map(id => ({
					name: this._mdnsDevices[id].txtObj.fn,
					data: { id },
				}))
			);

			const delayUntil = this.mdnsStarted + 20 * 1000;
			if (Date.now() < delayUntil) {
				setTimeout(returnDevices, delayUntil - Date.now());
			} else {
				returnDevices();
			}
		});

	}

	_initDevice(device_data) {
		this.log('_initDevice', device_data);

		if (!device_data.id || device_data.id.length !== 32)
			return this.setUnavailable(device_data, __('repair'));

		this.setUnavailable(device_data, __('unavailable'));

		// get device object
		let oldDevice = this.getDevice(device_data);
		oldDevice = oldDevice instanceof Error ? {} : oldDevice;
		// get local device
		const mdnsDevice = this._mdnsDevices[device_data.id];
		if (mdnsDevice) {
			this._devices[device_data.id] = {
				address: mdnsDevice.addresses[0],
				port: mdnsDevice.port,
				state: {},
				apps: {},
				speaker: oldDevice.speaker,
			};
			this.setAvailable(device_data);

			// TODO add check if device does not have "speaker_playing" capability dont register the speaker
			if (!oldDevice.speaker) {
				this.registerSpeaker(device_data, {
					codecs: ['homey:codec:mp3'],
				}, (err, speaker) => {
					if (err) return Homey.error(err);
					this._devices[device_data.id].speaker = speaker;
					speaker.on('setTrack', (track, callback) => {
						const device = this._devices[device_data.id];
						console.log('@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@  set track', track);
						const artwork = (track.artwork || {});
						this.getApplication(device, Media).then((result) => {
							const player = result.app;
							const disconnect = result.disconnect;

							const onStatusListener = (status) => {
								if (status.playerState === 'PLAYING') {
									player.removeListener('status', onStatusListener);
									console.log('realtime playing true');
									this.realtime(device_data, 'speaker_playing', true);
									speaker.updateState({ track, position: 0 });
									callback(null, true);
									disconnect();
								}
							};
							const load = player.load.bind(
								player,
								{
									contentId: track.stream_url,
									contentType: 'audio/mpeg',
									metadata: {
										title: track.name,
										images: [{
											url: artwork.large || artwork.medium || artwork.small,
										}],
									},
								},
								{
									autoplay: true,
								},
								(err) => {
									if (err) {
										callback(err);
										return disconnect();
									}
									player.on('status', onStatusListener);
								}
							);
							// Initial implementation of queue
							if (track.delay) {
								setTimeout(load, track.delay);
							} else {
								load();
							}
						}).catch((err) => {
							callback(err || new Error('Could not find application to play'));
						});
					});
					speaker.on('setPosition', (position, callback) => {
						const device = this._devices[device_data.id];
						this.joinApplication(device, Media).then((result) => {
							const player = result.app;
							const disconnect = result.disconnect;

							player.seek(Math.round(position / 1000), (err, result) => {
								console.log('position set', err, result);
								callback(err, result);
								disconnect();
							});
						}).catch((err) => {
							callback(err || new Error('Could not find application to set position'));
						});
					});
					speaker.on('setActive', (isActive, callback) => {
						const device = this._devices[device_data.id];
						if (isActive) {
							console.log('SPEAKER BECAME ACTIVE');
							this.getApplication(device, Media).then((result) => {
								const player = result.app;

								console.log('player loaded', player);

								const updateStateInteval = setInterval(() => {
									player.getStatus((err, status) => {
										console.log('GOT STATUS', err, status);
										if (status) {
											if (status.playerState === 'PLAYING') {
												this.realtime(device_data, 'speaker_playing', true);
											} else if (status.playerState === 'PAUSED') {
												this.realtime(device_data, 'speaker_playing', false);
											}
											speaker.updateState({ position: Math.round(status.currentTime) });
										}
									});
								}, 5000);
								player.on('close', () => {
									console.log('app closed!!!');
									speaker.updateState(new Error('disconnected'));
									clearInterval(updateStateInteval);
								});
								callback();
							}).catch((err) => {
								callback(err);
								console.log('ERROR loading', err);
							});
						} else {
							this.stop(device, callback);
						}
					});
				});
			}
		}
		this.on(`device:${device_data.id}`, () => {
			this._initDevice(device_data);
		});

	}

	_uninitDevice(device_data) {
		this.log('_uninitDevice', device_data);

		const device = this.getDevice(device_data);
		if (device instanceof Error) return;

		delete this._devices[device_data.id];
		if (device.speaker) {
			device.speaker.removeAllListeners();
			this.unregisterSpeaker(device_data, (() => null));
		}
	}

	/*
	 Internal methods
	 */
	getDevice(device_data) {
		return this._devices[device_data.id] || new Error('invalid_device');
	}

	joinApplication(device, Applications) {
		this.log('joinApplication');
		// Transform Applications to an array if it is not one and filter out the Web application
		Applications = (Array.isArray(Applications) ? Applications : [Applications])
			.filter(Application => Application && Application.name !== 'Browser');
		if (!Applications.length) return Promise.reject(new Error('No (valid) application given'));

		return this._connect(device).then((disconnect) => {
			return new Promise((resolve, reject) => {
				device.client.getSessions((err, sessions) => {
					if (err) return disconnect() & reject(err);

					const session = sessions.find(s => Applications.some(Application => s.appId === Application.APP_ID));

					if (!session) {
						disconnect();
						return reject();
					}
					const Application = Applications.find(App => App.APP_ID === session.appId);

					device.client.join(session, Application, (err, app) => {
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
			});
		});
	}

	getApplication(device, Application) {
		this.log('getApplication');
		if (!device.apps[Application.APP_ID] || Application.name === 'Browser') {
			const appPromise = device.apps[Application.APP_ID] = this._connect(device).then((disconnect) => {
				return new Promise((resolve, reject) => {

					this.joinApplication(device, Application).then((result) => {
						const app = result.app;
						const _disconnect = () => {
							disconnect();
							result.disconnect();
						};


						app.once('close', () => {
							if (device.apps[Application.APP_ID] === appPromise) {
								device.apps[Application.APP_ID] = null;
							}
							_disconnect();
						});

						resolve({
							app,
							disconnect: _disconnect,
						});
					}).catch((err) => {

						device.client.launch(Application, (err, app) => {
							if (err) {
								if (device.apps[Application.APP_ID] === appPromise) {
									device.apps[Application.APP_ID] = null;
								}
								disconnect();
								return reject(err);
							}

							app.once('close', () => {
								if (device.apps[Application.APP_ID] === appPromise) {
									device.apps[Application.APP_ID] = null;
								}
								disconnect();
							});

							this.log('Launched', Application.name);

							resolve({ app, disconnect });
						});
					});
				});
			}).catch((err) => {
				console.log('getApllication error', err, err.stack);
				if (device.apps[Application.APP_ID] === appPromise) {
					device.apps[Application.APP_ID] = null;
				}
				return Promise.reject(err);
			});
			return appPromise;
		}
		return this._connect(device).then(disconnect =>
			device.apps[Application.APP_ID].then(result =>
				Object.assign(result, { disconnect })
			)
		);
	}

	play(device, callback) {
		this.joinApplication(device, [Youtube, DefaultMediaReceiver, Media]).then((result) => {
			const app = result.app;
			const disconnect = result.disconnect;

			app.play((err, result) => {
				disconnect();
				callback(err, result);
			});
		}).catch((err) => {
			callback(err || new Error('Could not find application to play'));
		});
	}

	getPlaying(device, callback) {
		this.joinApplication(device, [Youtube, DefaultMediaReceiver, Media]).then((result) => {
			const app = result.app;
			const disconnect = result.disconnect;

			app.getState((err, state) => {
				disconnect();
				// TODO check if this works for youtube
				callback(err, state.playerState === 'PLAYING');
			});
		}).catch((err) => {
			if (err) {
				return callback(err);
			}
			return callback(null, false);
		});
	}

	pause(device, callback) {
		this.joinApplication(device, [Youtube, DefaultMediaReceiver, Media]).then((result) => {
			const app = result.app;
			const disconnect = result.disconnect;

			app.pause((err, result) => {
				disconnect();
				callback(err, result);
			});
		}).catch((err) => {
			callback(err || new Error('Could not find application to pause'));
		});
	}

	previous(device, callback) {
		this.joinApplication(device, [Youtube]).then((result) => {
			const app = result.app;
			const disconnect = result.disconnect;

			app.previous((err, result) => {
				disconnect();
				callback(err, result);
			});
		}).catch((err) => {
			callback(err || new Error('Could not find application to previous'));
		});
	}

	next(device, callback) {
		this.joinApplication(device, [Youtube]).then((result) => {
			const app = result.app;
			const disconnect = result.disconnect;

			app.next((err, result) => {
				disconnect();
				callback(err, result);
			});
		}).catch((err) => {
			callback(err || new Error('Could not find application to next'));
		});
	}

	setLoop(device, shouldLoop, callback) {
		settingsManager.set(`device:${device.id}:loop`, shouldLoop);
		this.joinApplication(device, [Youtube]).then((result) => {
			const app = result.app;
			const disconnect = result.disconnect;

			app.loop(shouldLoop, (err, result) => {
				disconnect();
				callback(err, result);
			});
		}).catch((err) => {
			callback();
		});
	}

	setShuffle(device, shouldShuffle, callback) {
		settingsManager.set(`device:${device.id}:shuffle`, shouldShuffle);
		this.joinApplication(device, [Youtube]).then((result) => {
			const app = result.app;
			const disconnect = result.disconnect;

			app.shuffle(shouldShuffle, (err, result) => {
				disconnect();
				callback(err, result);
			});
		}).catch(() => {
			callback();
		});
	}

	stop(device, callback) {
		this._connect(device).then((disconnect) => {
			device.client.getSessions((err, sessions) => {
				this.log('got sessions to stop', err, sessions);
				if (err) return disconnect() & callback(err);
				if (!sessions || sessions.length === 0) return disconnect & callback();

				Promise.all(
					sessions.map((session) => new Promise((resolve, reject) =>
						device.client.receiver.stop(session.sessionId, (err, result) => err ? reject(err) : resolve())
					))
				).then(() => disconnect() & callback()).catch((err) => disconnect() & callback(err));
			});
			// app.stop(callback);
		}).catch((err) => {
			callback(err || new Error('Could not find application to stop'));
		});
	}

	setVolume(device, volume, callback) {
		this.log('setVolume');
		callback = typeof callback === 'function' ? callback : (() => null);

		this._connect(device).then((disconnect) => {
			device.client.setVolume(volume, (err, result) => {
				disconnect();
				if (err) return callback(err);

				callback(null, result);
			});
		}).catch(callback);
	}

	getVolume(device, callback) {
		this.log('getVolume');
		callback = typeof callback === 'function' ? callback : (() => null);

		this._connect(device).then((disconnect) => {
			device.client.getVolume((err, volume) => {
				disconnect();
				if (err) return callback(err);

				callback(null, volume);
			});
		}).catch(callback);
	}

	_connect(device) {
		this.log('_connect');

		if (!device.client) {
			device.client = new Client();
			device.client.client.once('close', () => device.client = null);
		}

		const lockUuid = uuid.v4();
		const client = device.client;
		let connection = client.connection;

		if (!connection) {
			return new Promise((resolve, reject) => {

				const onConnectError = (err) => {
					reject(err);
				};

				client.once('error', onConnectError);

				if (client.isConnecting) {
					client._connectionLock.add(lockUuid);
					console.log('waiting for connection', lockUuid, client._connectionLock.size);
					return client.client.on('connect', () => {
						client.removeListener('error', onConnectError);
						resolve(this._closeConnection.bind(this, device, client, lockUuid));
					});
				}

				client.isConnecting = true;
				client._connectionLock = new Set([lockUuid]);
				console.log('creating new connection', lockUuid, client._connectionLock.size);

				const onError = (err) => {
					console.error(err.message, err.stack);
					client.close();
					this._closingConnections.delete(connection);
					client._connectionLock.clear();
				};

				client.on('error', onError);

				client.connect({ host: device.address, port: device.port }, (err) => {
					client.removeListener('error', onConnectError);
					client.isConnecting = false;

					if (err) return reject(err);

					this.log('Connected to', device.address);

					connection = client.connection;

					client.once('close', () => {
						this.log('Disconnected from', device.address);
						client.removeListener('error', onError);
						this._closingConnections.delete(connection);
						client._connectionLock.clear();
					});

					resolve(this._closeConnection.bind(this, device, client, lockUuid));
				});
			});
		} else if (this._closingConnections.has(connection)) {
			return new Promise((resolve) => {
				client.once('close', () => resolve(this._connect(device)));
			});
		}
		client._connectionLock.add(lockUuid);
		console.log('adding new connection lock', lockUuid, client._connectionLock.size);

		return Promise.resolve(this._closeConnection.bind(this, device, client, lockUuid));
	}

	_closeConnection(device, client, lockUuid) {
		this.log('_closeConnection');
		if (!lockUuid) {
			throw new Error('Connection lock uuid should not be empty');
		}

		client._connectionLock.delete(lockUuid);
		console.log('removing connection lock', lockUuid, client._connectionLock.size);

		if (client._connectionLock.size === 0) {
			if (client.client && client.client.socket) {
				this._closingConnections.add(client.connection);
				client.close();
				this.log('Disconnected from device', device.address);
			}
		}
	}

	sanitizeUrl(url) {
		if (hasHttpRegex.test(url)) {
			return url;
		}
		return 'http://'.concat(url);
	}

	get capabilities() {
		return {
			speaker_playing: {
				get: (deviceData, callback) => {
					this.log('capabilities.speaker_playing.get');

					const device = this.getDevice(deviceData);
					if (device instanceof Error) return callback(device);

					this.getPlaying(device, callback);
				},
				set: (deviceData, value, callback) => {
					this.log('capabilities.speaker_playing.set');

					const device = this.getDevice(deviceData);
					if (device instanceof Error) return callback(device);

					if (value) {
						this.play(device, callback);
					} else {
						this.pause(device, callback);
					}
				},
			},
			speaker_prev: {
				set: (deviceData, callback) => {
					this.log('capabilities.speaker_prev.set');

					const device = this.getDevice(deviceData);
					if (device instanceof Error) return callback(device);

					this.previous(device, callback);
				},
			},
			speaker_next: {
				set: (deviceData, callback) => {
					this.log('capabilities.speaker_next.set');

					const device = this.getDevice(deviceData);
					if (device instanceof Error) return callback(device);

					this.next(device, callback);
				},
			},
			volume_mute: {
				get: (deviceData, callback) => {
					this.log('capabilities.volume_mute.get');

					const device = this.getDevice(deviceData);
					if (device instanceof Error) return callback(device);

					this.getVolume(device, (err, volume) => {
						callback(err, (volume || {}).muted);
					});
				},
				set: (deviceData, value, callback) => {
					this.log('capabilities.volume_mute.get');

					const device = this.getDevice(deviceData);
					if (device instanceof Error) return callback(device);

					this.setVolume(device, { muted: value }, (err, volume) => {
						callback(err, (volume || {}).muted);
					});
				},
			},
			volume_set: {
				get: (deviceData, callback) => {
					this.log('capabilities.volume_mute.get');

					const device = this.getDevice(deviceData);
					if (device instanceof Error) return callback(device);

					this.getVolume(device, (err, volume) => {
						if (err) return callback(err);

						callback(null, Math.round(volume.level * 100) / 100);
					});
				},
				set: (deviceData, value, callback) => {
					this.log('capabilities.volume_mute.get');

					const device = this.getDevice(deviceData);
					if (device instanceof Error) return callback(device);

					this.setVolume(device, { level: value }, (err, volume) => {
						if (err) return callback(err);

						callback(null, Math.round(volume.level * 100) / 100);
					});
				},
			},
		};
	}

	castYoutube(device, youtubeId, callback) {
		this.log('castYoutube');

		this.getApplication(device, Youtube).then((result) => {
			const player = result.app;
			const disconnect = result.disconnect;

			player.loadVideo(
				youtubeId,
				{
					autoplay: true,
					loop: settingsManager.get(`device:${device.id}:loop`),
				},
				(err, result) => {
					disconnect();
					callback(err, result);
				}
			);
		}).catch(err => {
			callback(err || new Error('Could not cast url'));
		});
	}

	castYoutubePlaylist(device, youtubePlaylistId, callback) {
		this.log('castYoutubePlaylist');

		this.getApplication(device, Youtube).then((result) => {
			const player = result.app;
			const disconnect = result.disconnect;

			player.loadPlaylist(
				youtubePlaylistId,
				{
					autoplay: true,
					shuffle: settingsManager.get(`device:${device.id}:shuffle`),
					loop: settingsManager.get(`device:${device.id}:loop`),
				},
				(err, loadResult) => {
					disconnect();
					callback(err, loadResult);
				}
			);
		}).catch(err => {
			callback(err || new Error('Could not cast url'));
		});
	}

	castRadio(device, radio, callback) {
		this.log('castUrl');

		request(radio.url, { method: 'GET', timeout: 2000 }, (err, res) => {
			console.log(radio.url, err, res ? res.body : null);
			if (err) return callback(err);
			if (!res.headers || res.statusCode !== 200) return callback(new Error('Invalid request from url'));

			const url = res.body.split('\n')[0];

			this.getApplication(device, DefaultMediaReceiver).then((result) => {
				const player = result.app;
				const disconnect = result.disconnect;

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
						console.log('castUrl', err);
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

	castUrl(device, url, callback) {
		this.log('_onFlowActionStop');

		this.getApplication(device, Browser).then((result) => {
			const browser = result.app;
			const disconnect = result.disconnect;

			browser.redirect(this.sanitizeUrl(url), callback);
		}).catch(err => {
			callback(err || new Error('Could not cast url'));
		});
	}

	/*
	 Flow
	 */
	_onFlowActionCastYouTube(callback, args) {
		this.log('_onFlowActionCastYouTube');

		const device = this.getDevice(args.chromecast);
		if (device instanceof Error) return;

		this.castYoutube(device, args.youtube_id.id, callback);
	}

	_onFlowActionCastYouTubePlaylist(callback, args) {
		this.log('_onFlowActionCastYouTubePlaylist');

		const device = this.getDevice(args.chromecast);
		if (device instanceof Error) return;

		this.castYoutubePlaylist(device, args.youtube_playlist_id.id, callback);
	}

	_onFlowActionCastRadio(callback, args) {
		this.log('_onFlowActionCastRadio');

		const device = this.getDevice(args.chromecast);
		if (device instanceof Error) return;

		this.castRadio(device, args.radio_url, callback);
	}

	_onFlowActionCastUrl(callback, args) {
		this.log('_onFlowActionCastUrl');

		const device = this.getDevice(args.chromecast);
		if (device instanceof Error) return;

		this.castUrl(device, args.url, callback);

	}

	_onFlowActionSetVolume(callback, args) {
		this.log('_onFlowActionSetVolume');

		const device = this.getDevice(args.chromecast);
		if (device instanceof Error) return;

		this.setVolume(device, { level: args.level }, callback);
	}

	_onFlowActionMute(muted, callback, args) {
		this.log('_onFlowActionMute');

		const device = this.getDevice(args.chromecast);
		if (device instanceof Error) return;

		this.setVolume(device, { muted }, callback);
	}

	_onFlowActionPlay(callback, args) {
		this.log('_onFlowActionPlay');

		const device = this.getDevice(args.chromecast);
		if (device instanceof Error) return;

		this.play(device, callback);
	}

	_onFlowActionPause(callback, args) {
		this.log('_onFlowActionPause');

		const device = this.getDevice(args.chromecast);
		if (device instanceof Error) return;

		this.pause(device, callback);
	}

	_onFlowActionPrevious(callback, args) {
		this.log('_onFlowActionPause');

		const device = this.getDevice(args.chromecast);
		if (device instanceof Error) return;

		this.previous(device, callback);
	}

	_onFlowActionNext(callback, args) {
		this.log('_onFlowActionPause');

		const device = this.getDevice(args.chromecast);
		if (device instanceof Error) return;

		this.next(device, callback);
	}

	_onFlowActionStop(callback, args) {
		this.log('_onFlowActionStop');

		const device = this.getDevice(args.chromecast);
		if (device instanceof Error) return;

		this.stop(device, callback);
	}

	_onFlowActionLoop(callback, args) {
		this.log('_onFlowActionLoop', this._txtMd);

		const device = this.getDevice(args.chromecast);
		if (device instanceof Error) return;

		this.setLoop(device, args.state === 'on', callback);
	}

	_onFlowActionShuffle(callback, args) {
		this.log('_onFlowActionShuffle');

		const device = this.getDevice(args.chromecast);
		if (device instanceof Error) return;

		this.setShuffle(device, args.state === 'on', callback);
	}
}

module.exports = Driver;