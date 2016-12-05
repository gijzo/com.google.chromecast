'use strict';

const events = require('events');

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

		if (device.txtObj.md !== this._txtMd) return;
		if (typeof this._mdnsDevices[device.txtObj.id] !== 'undefined') return;

		this.log('Found', device.txtObj.fn, '@', device.addresses[0]);

		this._mdnsDevices[device.txtObj.id] = device;

		this.emit(`device:${device.txtObj.id}`);
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

	/*
	 Internal methods
	 */
	getDevice(device_data) {
		return this._devices[device_data.id] || new Error('invalid_device');
	}

	getApplication(device, Application, callback) {
		this.log('getApplication');
		this._connect(device, (err, disconnect) => {
			if (err) return callback(err);

			this.log('Connected to Chromecast');

			device.client.launch(Application, (err, app) => {
				if (err) {
					disconnect();
					return callback(err);
				}

				if (device.app && device.app.connection) {
					device.app.close();
				}
				this.log('Launched', Application.name);
				device.app = app;

				callback(err, app);

				app.once('close', () => {
					device.app = null;
					disconnect();
				});
			});
		});
	}

	play(device, callback) {
		console.log(device.app);
		if (device.app && device.app.channel && device.app.play) {
			device.app.play(callback);
		} else {
			callback(new Error('Cannot call play on chromecast'));
		}
	}

	pause(device, callback) {
		if (device.app && device.app.channel && device.app.pause) {
			device.app.pause(callback);
		} else {
			callback(new Error('Cannot call pause on chromecast'));
		}
	}

	stop(device, callback) {
		if (device.app && device.app.channel && device.app.stop) {
			device.app.stop(callback);
		} else {
			callback(new Error('Cannot call stop on chromecast'));
		}
	}

	setVolume(device, volume, callback) {
		this.log('setVolume');
		callback = typeof callback === 'function' ? callback : (() => null);

		this._connect(device, (err, disconnect) => {
			if (err) return callback(err);

			device.client.setVolume(volume, (err, result) => {
				disconnect();
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

	sanitizeUrl(url) {
		if (hasHttpRegex.test(url)) {
			return url;
		}
		return 'http://'.concat(url);
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
				app: null,
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
			this._connectionLock.add(lockUuid);

			const onError = (err) => {
				if (callback) callback(err, (() => null));
				console.error(err);
				client.close();
				this._closingConnections.delete(connection);
				this._connectionLock.clear();
			};

			client.on('error', onError);

			client.connect(device.address, (err) => {
				if (err) return callback(err, (() => null));

				connection = client.connection;

				client.once('close', () => {
					console.log('onclose!');
					client.removeListener('error', onError);
					this._closingConnections.delete(connection);
					this._connectionLock.clear();
				});

				callback(null, () => this._closeConnection.bind(this, device, lockUuid));
				callback = null;
			});
		} else if (this._closingConnections.has(connection)) {
			client.once('close', () => this._connect(device, callback));
		} else {
			this._connectionLock.add(lockUuid);

			callback(null, () => this._closeConnection.bind(this, device, lockUuid));
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
			console.log('closing connection');
			this._closingConnections.add(device.client.connection);
			device.client.close();
		}
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