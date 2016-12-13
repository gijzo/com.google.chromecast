var util            = require('util');
var debug           = require('debug')('castv2-client');
var JsonController  = require('./json');

function ConnectionController(client, sourceId, destinationId) {
	JsonController.call(this, client, sourceId, destinationId, 'urn:x-cast:com.google.cast.tp.connection');

	var self = this;
	var connected = true;
	this.sourceId = sourceId;

	function onmessage(data, broadcast) {
		if(data.type === 'CLOSE') {
			connected = false;
			self.emit('disconnect');
		}
	}

	function onclose() {
		self.removeListener('message', onmessage);
		if(connected) {
			self.emit('disconnect');
		}
	}

	this.on('message', onmessage);
	this.once('close', onclose);
}

util.inherits(ConnectionController, JsonController);

ConnectionController.prototype.connect = function() {
	this.send({ type: 'CONNECT' });
};

ConnectionController.prototype.disconnect = function() {
	this.send({ type: 'CLOSE' });
};

module.exports = ConnectionController;