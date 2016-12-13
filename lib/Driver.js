'use strict';

const events = require('events');

const DefaultMediaReceiver = require('castv2-client').DefaultMediaReceiver;
const Client = require('castv2-client').Client;
const Youtube = require('castv2-athom-youtube').Youtube;
const uuid = require('uuid');

const settingsManager = Homey.manager('settings');

const hasHttpRegex = new RegExp(/^[a-z]*:\/\//i);

class Driver extends events.EventEmitter {

	constructor() {
		super();

		this.DEVELOPMENT = true; // FIXME comment

		if (this.DEVELOPMENT) {
			Youtube.APP_ID = '0A938E83';
		}

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

		this.i = 0;
		this.j = 0;

		Homey.manager('flow')
			.on('action.castYouTube', this._onFlowActionCastYouTube.bind(this))
			.on('action.castYouTubePlaylist', this._onFlowActionCastYouTubePlaylist.bind(this))
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
		let txtObj = {};
		device.txt.forEach((entry) => {
			entry = entry.split('=');
			txtObj[entry[0]] = entry[1];
		});
		device.txtObj = txtObj;

		if (this._txtMd.indexOf(device.txtObj.md) === -1) return;

		const id = device.txtObj.id.replace(/-/g, '');

		if (typeof this._mdnsDevices[id] !== 'undefined') return;

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
					data: { id }
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

		// get local device
		let device = this._mdnsDevices[device_data.id];
		if (device) {
			this._devices[device_data.id] = {
				address: device.addresses[0],
				state: {},
				apps: {},
			};
			this.setAvailable(device_data);
		} else {
			this.once(`device:${device_data.id}`, () => {
				this._initDevice(device_data);
			});
		}

	}

	_uninitDevice(device_data) {
		this.log('_uninitDevice', device_data);
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

					console.log('sessions', sessions);
					const session = sessions.find((session) =>
						Applications.some(Application => session.appId === Application.APP_ID)
					);
					if (!session) return disconnect() & reject();
					const Application = Applications.find(App => App.APP_ID === session.appId);

					device.client.join(session, Application, (err, app) => {
						if (err) return disconnect() & reject(err);

						app.once('close', disconnect);

						this.log('Joined', Application.name);

						// Force status to update
						if (typeof app.getStatus === 'function') {
							app.getStatus((() => null));
						}

						resolve(app);
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

					this.joinApplication(device, Application).then((app) => {
						app.once('close', () => {
							if (device.apps[Application.APP_ID] === appPromise) {
								device.apps[Application.APP_ID] = null;
							}
							disconnect();
						});

						app.on('status', console.log.bind(null, 'MEDIA STATUS'));
						resolve(app);
					}).catch((err) => {
						console.log('unable to join application, launching new application', err);

						device.client.launch(Application, (err, app) => {
							if (err) {
								if (device.apps[Application.APP_ID] === appPromise) {
									device.apps[Application.APP_ID] = null;
								}
								disconnect();
								return reject(err);
							}

							app.on('status', console.log.bind(null, 'MEDIA STATUS'));

							app.once('close', () => {
								console.log('APPLICATION CLOSE EVENT IN DRIVER');
								if (device.apps[Application.APP_ID] === appPromise) {
									device.apps[Application.APP_ID] = null;
								}
								disconnect();
							});

							this.log('Launched', Application.name);

							resolve(app);
						});
					});
				});
			}).catch((err) => {
				console.error(err);
				if (device.apps[Application.APP_ID] === appPromise) {
					device.apps[Application.APP_ID] = null;
				}
				return Promise.reject(err);
			});
		}
		return device.apps[Application.APP_ID];
	}

	play(device, cb) {
		const callback = (err, result) => {
			if (err) {
				console.log('callback', err.message, err.stack, result);
			}
			cb(err, result);
		};
		this.joinApplication(device, [Youtube, DefaultMediaReceiver]).then((app) => {
			app.play(callback)
		}).catch((err) => {
			callback(err || new Error('Could not find application to play'));
		});
	}

	pause(device, cb) {
		const callback = (err, result) => {
			console.log('callback', err, result);
			cb(err, result);
		};
		this.joinApplication(device, [Youtube, DefaultMediaReceiver]).then((app) => {
			app.pause(callback)
		}).catch((err) => {
			callback(err || new Error('Could not find application to pause'));
		});
	}

	previous(device, cb) {
		const callback = (err, result) => {
			console.log('callback', err, result);
			cb(err, result);
		};
		this.joinApplication(device, [Youtube]).then((app) => {
			app.previous(callback)
		}).catch((err) => {
			callback(err || new Error('Could not find application to previous'));
		});
	}

	next(device, cb) {
		const callback = (err, result) => {
			console.log('callback', err, result);
			cb(err, result);
		};
		this.joinApplication(device, [Youtube]).then((app) => {
			app.next(callback)
		}).catch((err) => {
			callback(err || new Error('Could not find application to next'));
		});
	}

	setLoop(device, shouldLoop, cb) {
		const callback = (err, result) => {
			console.log('callback', err, result);
			cb(err, result);
		};
		settingsManager.set(`device:${device.id}:loop`, shouldLoop);
		this.joinApplication(device, [Youtube]).then((app) => {
			app.loop(shouldLoop, callback)
		}).catch((err) => {
			callback();
		});
	}

	setShuffle(device, shouldShuffle, cb) {
		const callback = (err, result) => {
			console.log('callback', err, result);
			cb(err, result);
		};
		settingsManager.set(`device:${device.id}:shuffle`, shouldShuffle);
		this.joinApplication(device, [Youtube]).then((app) => {
			app.shuffle(shouldShuffle, callback)
		}).catch(() => {
			callback();
		});
	}

	stop(device, cb) {
		const callback = (err, result) => {
			console.log('callback', err, result);
			cb(err, result);
		};
		this._connect(device).then((dc) => {
			const disconnect = () => {
				console.log('STOP IS DISCONNECTING!');
				dc();
			};
			device.client.getSessions((err, sessions) => {
				console.log('got sessions to stop', err, sessions);
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

		const lockUuid = new uuid.v4();
		const client = device.client;
		let connection = client.connection;

		if (!connection) {
			return new Promise((resolve, reject) => {
				client._connectionLock = new Set([lockUuid]);
				console.log('creating new connection', lockUuid, client._connectionLock.size);

				const onConnectError = (err) => {
					reject(err);
				};

				client.once('error', onConnectError);

				if (client.isConnecting) {
					return client.client.on('connect', () => {
						client.removeListener('error', onConnectError);
						resolve(this._closeConnection.bind(this, device, client, lockUuid));
					});
				}

				client.isConnecting = true;

				const onError = (err) => {
					console.error(err);
					client.close();
					this._closingConnections.delete(connection);
					client._connectionLock.clear();
				};

				client.on('error', onError);

				client.connect(device.address, (err) => {
					client.removeListener('error', onConnectError);
					client.isConnecting = false;

					if (err) return reject(err);

					this.log('Connected to', device.address);

					connection = client.connection;

					client.getSessions((sessions) => console.log('STATUS', require('util').inspect(sessions, { depth: 9 })));
					client.on('status', (status) => console.log('ONSTATUS', require('util').inspect(status, { depth: 9 })));

					client.once('close', () => {
						this.log('Disconnected from', device.address);
						client.removeListener('error', onError);
						this._closingConnections.delete(connection);
						client._connectionLock.clear();
					});

					resolve(this._closeConnection.bind(this, device, client, lockUuid));
				});
			});
		} else if (this._closingConnections.has(client)) {
			client.once('close', () => this._connect(device));
		} else {
			client._connectionLock.add(lockUuid);
			console.log('adding new connection lock', lockUuid, client._connectionLock.size);

			return Promise.resolve(this._closeConnection.bind(this, device, client, lockUuid));
		}
	}

	_closeConnection(device, client, lockUuid) {
		this.log('_closeConnection');
		if (!lockUuid) {
			throw new Error('Connection lock uuid should not be empty');
		}

		client._connectionLock.delete(lockUuid);
		console.log('removing connection lock', lockUuid, client._connectionLock.size);

		if (client._connectionLock.size === 0) {
			if (client.socket) {
				this._closingConnections.add(client);
				client.close();
			}

			this.log('Disconnected from device', device.address);
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
			volume_mute: {
				get: (deviceData, callback) => {
					this.log('capabilities.volume_mute.get');

					let device = this.getDevice(deviceData);
					if (device instanceof Error) return callback(device);

					this.getVolume(device, (err, volume) => {
						callback(err, (volume || {}).muted);
					});
				},
				set: (deviceData, value, callback) => {
					this.log('capabilities.volume_mute.get');

					let device = this.getDevice(deviceData);
					if (device instanceof Error) return callback(device);

					this.setVolume(device, { muted: value }, (err, volume) => {
						callback(err, (volume || {}).muted);
					});
				},
			},
			volume_set: {
				get: (deviceData, callback) => {
					this.log('capabilities.volume_mute.get');

					let device = this.getDevice(deviceData);
					if (device instanceof Error) return callback(device);

					this.getVolume(device, (err, volume) => {
						if (err) return callback(err);

						callback(null, Math.round(volume.level * 100) / 100);
					});
				},
				set: (deviceData, value, callback) => {
					this.log('capabilities.volume_mute.get');

					let device = this.getDevice(deviceData);
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

		this.getApplication(device, Youtube).then((player) => {
			player.loadVideo(
				youtubeId,
				{
					autoplay: true,
					loop: settingsManager.get(`device:${device.id}:loop`),
				},
				callback
			);
		}).catch(err => {
			callback(err || new Error('Could not cast url'));
		});
	}

	castYoutubePlaylist(device, youtubePlaylistId, callback) {
		this.log('castYoutubePlaylist');

		this.getApplication(device, Youtube).then((player) => {
			player.loadPlaylist(
				youtubePlaylistId,
				{
					autoplay: true,
					shuffle: settingsManager.get(`device:${device.id}:shuffle`),
					loop: settingsManager.get(`device:${device.id}:loop`),
				},
				callback
			);
		}).catch(err => {
			callback(err || new Error('Could not cast url'));
		});
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

	_onFlowActionCastYouTubePlaylist(callback, args) {
		this.log('_onFlowActionCastYouTubePlaylist');

		let device = this.getDevice(args.chromecast);
		if (device instanceof Error) return callback(device);

		this.castYoutubePlaylist(device, args.youtube_playlist_id.id, callback);
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

	_onFlowActionPrevious(callback, args) {
		this.log('_onFlowActionPause');

		let device = this.getDevice(args.chromecast);
		if (device instanceof Error) return callback(device);

		this.previous(device, (err, result) => callback(err, result));
	}

	_onFlowActionNext(callback, args) {
		this.log('_onFlowActionPause');

		let device = this.getDevice(args.chromecast);
		if (device instanceof Error) return callback(device);

		this.next(device, (err, result) => callback(err, result));
	}

	_onFlowActionStop(callback, args) {
		this.log('_onFlowActionStop');

		let device = this.getDevice(args.chromecast);
		if (device instanceof Error) return callback(device);

		this.stop(device, (err, result) => callback(err, result));
	}

	_onFlowActionLoop(callback, args) {
		this.log('_onFlowActionLoop');

		let device = this.getDevice(args.chromecast);
		if (device instanceof Error) return callback(device);

		this.setLoop(device, args.state === 'on', (err, result) => callback(err, result));
	}

	_onFlowActionShuffle(callback, args) {
		this.log('_onFlowActionShuffle');

		let device = this.getDevice(args.chromecast);
		if (device instanceof Error) return callback(device);

		this.setShuffle(device, args.state === 'on', (err, result) => callback(err, result));
	}
}

module.exports = Driver;