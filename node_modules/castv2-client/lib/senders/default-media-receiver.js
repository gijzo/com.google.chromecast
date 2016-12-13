var util        = require('util');
var debug       = require('debug')('castv2-client');
var Application = require('./application');
var MediaController = require('../controllers/media');

function DefaultMediaReceiver(client, session) {
  Application.apply(this, arguments);

  this.media = this.createController(MediaController, session);

  this.media.on('status', onstatus);
  this.media.once('disconnect', onmediadisconnect);

  this.once('disconnect', ondisconnect);
  this.once('close', onclose);

  var self = this;

  function onstatus(status) {
    self.emit('status', status);
  }

  function onmediadisconnect() {
    self.emit('disconnect');
    self.emit('close');
  }

  function ondisconnect() {
    self.removeListener('close', onclose);
    self.media.removeListener('disconnect', ondisconnect);
    self.media.removeListener('status', onstatus);
    self.media = null;
  }

  function onclose() {
    self.removeListener('disconnect', ondisconnect);
    self.media.removeListener('disconnect', onmediadisconnect);
    self.media.removeListener('status', onstatus);
    self.media.close();
    self.media = null;
  }
}

DefaultMediaReceiver.APP_ID = 'CC1AD845';

util.inherits(DefaultMediaReceiver, Application);

DefaultMediaReceiver.prototype.getStatus = function(callback) {
  this.media.getStatus.apply(this.media, arguments);
};

DefaultMediaReceiver.prototype.load = function(media, options, callback) {
  this.media.load.apply(this.media, arguments);
};

DefaultMediaReceiver.prototype.play = function(callback) {
  this.media.play.apply(this.media, arguments);
};

DefaultMediaReceiver.prototype.pause = function(callback) {
  this.media.pause.apply(this.media, arguments);
};

DefaultMediaReceiver.prototype.stop = function(callback) {
  this.media.stop.apply(this.media, arguments);
};

DefaultMediaReceiver.prototype.seek = function(currentTime, callback) {
  this.media.seek.apply(this.media, arguments);
};

module.exports = DefaultMediaReceiver;