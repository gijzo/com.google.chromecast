'use strict';

const events = require('events');

const DefaultMediaReceiver = require('castv2-client').DefaultMediaReceiver;
const Client = require('castv2-client').Client;
const uuid = require('uuid');

const hasHttpRegex = new RegExp(/^[a-z]*:\/\//i);

class Driver extends events.EventEmitter {

	constructor() {
		super();

		Homey.app.on('mdns_device', this._onMdnsDevice.bind(this));

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

			callback(
				null,
				Object.keys(this._mdnsDevices).map(id => ({
					name: this._mdnsDevices[id].txtObj.fn,
					data: { id }
				}))
			);

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
		Applications = Array.isArray(Applications) ? Applications : [Applications];
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
		if (!device.apps[Application.APP_ID]) {
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
					}).catch(() => {
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
		this.getApplication(device, DefaultMediaReceiver).then((app) => {
			app.play(callback)
		}).catch((err) => {
			console.log(err);
			callback(err || new Error('Could not find application to play'));
		});
	}

	pause(device, cb) {
		const callback = (err, result) => {
			console.log('callback', err, result);
			cb(err, result);
		};
		this.getApplication(device, DefaultMediaReceiver).then((app) => {
			app.pause(callback)
		}).catch((err) => {
			console.log(err);
			callback(err || new Error('Could not find application to play'));
		});
	}

	stop(device, callback) {
		this.getApplication(device, DefaultMediaReceiver).then((app) => {
			app.stop(callback);
			app.close();
		}).catch((err) => {
			console.log(err);
			callback(err || new Error('Could not find application to play'));
		});
	}

	setVolume(device, volume, callback) {
		this.log('setVolume');
		callback = typeof callback === 'function' ? callback : (() => null);

		this._connect(device, (err, disconnect) => {
			if (err) return callback(err);

			device.client.setVolume(volume, (err, result) => {
				// disconnect();
				if (err) return callback(err);

				callback(null, result);
			});
		});
	}

	getVolume(device, callback) {
		this.log('getVolume');
		callback = typeof callback === 'function' ? callback : (() => null);

		this._connect(device, (err, disconnect) => {
			if (err) return callback(err);

			device.client.getVolume((err, volume) => {
				disconnect();
				if (err) return callback(err);

				callback(null, volume);
			});
		});
	}

	_connect(device, callback) {
		this.log('_connect');
		callback = typeof callback === 'function' ? callback : (() => null);

		if (!device.client) {
			device.client = new Client();
			device.client.client.once('close', () => device.client = null);
		}

		const lockUuid = new uuid.v4();
		const client = device.client;
		let connection = client.connection;

		if (!connection) {
			return new Promise((resolve, reject) => {
				this._connectionLock.add(lockUuid);

				const onConnectError = (err) => {
					if (callback) callback(err, (() => null));
					reject();
					callback = null;
				};

				client.once('error', onConnectError);

				if (client.isConnecting) {
					return client.client.on('connect', () => {
						client.removeListener('error', onConnectError);
						if (callback) {
							callback(null, () => this._closeConnection.bind(this, device, lockUuid));
						}
						resolve(() => this._closeConnection.bind(this, device, lockUuid));
					});
				}

				client.isConnecting = true;

				const onError = (err) => {
					console.error(err);
					client.close();
					this._closingConnections.delete(connection);
					this._connectionLock.clear();
				};

				client.on('error', onError);

				client.connect(device.address, (err) => {
					client.removeListener('error', onConnectError);
					client.isConnecting = false;

					if (err) return reject & (callback ? callback(err, (() => null)) : null);

					this.log('Connected to', device.address);

					connection = client.connection;

					client.getSessions((sessions) => console.log('STATUS', require('util').inspect(sessions, { depth: 9 })));
					client.on('status', (status) => console.log('ONSTATUS', require('util').inspect(status, { depth: 9 })));

					client.once('close', () => {
						this.log('Disconnected from', device.address);
						client.removeListener('error', onError);
						this._closingConnections.delete(connection);
						this._connectionLock.clear();
					});

					if (callback) {
						callback(null, () => this._closeConnection.bind(this, device, lockUuid));
					}
					callback = null;
					resolve(() => this._closeConnection.bind(this, device, lockUuid));
				});
			});
		} else if (this._closingConnections.has(connection)) {
			client.once('close', () => this._connect(device, callback));
		} else {
			this._connectionLock.add(lockUuid);

			callback(null, () => this._closeConnection.bind(this, device, lockUuid));
			return Promise.resolve(() => this._closeConnection.bind(this, device, lockUuid));
		}
	}

	_closeConnection(device, uuid) {
		this.log('_closeConnection');
		if (!uuid) {
			throw new Error('Connection lock uuid should not be empty');
		}

		console.log('closing connection for uuid', uuid);
		this._connectionLock.delete(uuid);

		if (this._connectionLock.size === 0) {
			this._closingConnections.add(device.client.connection);
			device.client.close();

			this.log('Disconnected from', device.address);
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
}

module.exports = Driver;