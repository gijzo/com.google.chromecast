'use strict';

const request = require('request');
const Homey = require('homey');

module.exports = class Driver extends Homey.Driver {

	onInit() {
		super.onInit();

		this.mdnsStarted = Date.now();
		Homey.app.on('mdns_device', this._onMdnsDevice.bind(this));

		/*
		 Variables
		 */
		this._mdnsDevices = {};
		this._closingConnections = new Set();

		this._flowActionCastYouTube = new Homey.FlowCardAction('castYouTube')
			.register()
			.registerRunListener(this._onFlowActionCastYouTube.bind(this));
		this._flowActionCastYouTube.getArgument('youtube_id')
			.registerAutocompleteListener(Homey.app.onFlowActionCastYouTubeAutocomplete);

		this._flowActionCastYouTubePlaylist = new Homey.FlowCardAction('castYouTubePlaylist')
			.register()
			.registerRunListener(this._onFlowActionCastYouTubePlaylist.bind(this));
		this._flowActionCastYouTubePlaylist.getArgument('youtube_playlist_id')
			.registerAutocompleteListener(Homey.app.onFlowActionCastYouTubePlaylistAutocomplete);

		this._flowActionCastRadio = new Homey.FlowCardAction('castRadio')
			.register()
			.registerRunListener(this._onFlowActionCastRadio.bind(this));
		this._flowActionCastRadio.getArgument('radio_url')
			.registerAutocompleteListener(Homey.app.onFlowActionCastRadioAutocomplete);

		this._flowActionCastUrl = new Homey.FlowCardAction('castUrl')
			.register()
			.registerRunListener(this._onFlowActionCastUrl.bind(this));

		this._flowActionStop = new Homey.FlowCardAction('stop')
			.register()
			.registerRunListener(this._onFlowActionStop.bind(this));

		this._flowActionLoop = new Homey.FlowCardAction('loop')
			.register()
			.registerRunListener(this._onFlowActionLoop.bind(this));

		this._flowActionShuffle = new Homey.FlowCardAction('shuffle')
			.register()
			.registerRunListener(this._onFlowActionShuffle.bind(this));
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
		} else if (!this._txtMd) {
			if (
				!(device.type.some(type => type.name === 'googlecast') && this._txtMdBlacklist.indexOf(device.txtObj.md) === -1)
			) {
				return;
			}
		} else if (this._txtMd.indexOf(device.txtObj.md) === -1) {
			return;
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

		this.emit(`device:${id}`, device);
	}

	getMdnsDeviceData(device) {
		return this._mdnsDevices[device.getData().id];
	}

	onPair(socket) {
		socket.on('list_devices', async (data, callback) => {
			const delayUntil = this.mdnsStarted + 20 * 1000;
			if (Date.now() < delayUntil) {
				await new Promise(res => setTimeout(res, delayUntil - Date.now()));
			}

			callback(
				null,
				Object.keys(this._mdnsDevices).map(id => ({
					name: this._mdnsDevices[id].txtObj.fn,
					data: { id },
				}))
			);
		});

	}

	/*
	 Flow
	 */
	_onFlowActionCastYouTube(args) {
		this.log('_onFlowActionCastYouTube');

		return args.chromecast.castYoutube(args.youtube_id.id);
	}

	_onFlowActionCastYouTubePlaylist(args) {
		this.log('_onFlowActionCastYouTubePlaylist');

		return args.chromecast.castYoutubePlaylist(args.youtube_playlist_id.id);
	}

	_onFlowActionCastRadio(args) {
		this.log('_onFlowActionCastRadio');

		return args.chromecast.castRadio(args.radio_url);
	}

	_onFlowActionCastUrl(args) {
		this.log('_onFlowActionCastUrl');

		return args.chromecast.castUrl(args.url);

	}

	_onFlowActionStop(args) {
		this.log('_onFlowActionStop');

		return args.chromecast.stop();
	}

	_onFlowActionLoop(args) {
		this.log('_onFlowActionLoop');

		return args.chromecast.setLoop(args.state === 'on');
	}

	_onFlowActionShuffle(args) {
		this.log('_onFlowActionShuffle');

		return args.chromecast.setShuffle(args.state === 'on');
	}
};
