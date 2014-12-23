(function() {
  'use strict';

  /**
   * API for WebChannel messaging. Supports HTTP verbs for point-to-point
   * socket-like communication between a browser client and a remote origin.
   * @constructor
   * @param {!lfr.Transport} opt_transport Optional transport. If not
   *   specified defaults to <code>lfr.WebSocketTransport(location.origin +
   *   location.pathname)</code>.
   * @extends {lfr.EventEmitter}
   */
  lfr.WebChannel = function(opt_transport) {
    lfr.WebChannel.base(this, 'constructor');

    if (!opt_transport) {
      if (!window.location) {
        throw new Error('WebChannel cannot resolve transport uri');
      }
      opt_transport = new lfr.WebSocketTransport(window.location.origin + window.location.pathname);
    }

    this.pendingRequests_ = [];
    this.setTransport(opt_transport);
  };
  lfr.inherits(lfr.WebChannel, lfr.EventEmitter);

  /**
   * Holds http verbs.
   * @type {Object}
   * @const
   * @static
   */
  lfr.WebChannel.HttpVerbs = {
    DELETE: 'DELETE',
    GET: 'GET',
    HEAD: 'HEAD',
    PATCH: 'PATCH',
    POST: 'POST',
    PUT: 'PUT'
  };

  /**
   * Holds status of a request message.
   * @type {Object}
   * @const
   * @static
   */
  lfr.WebChannel.MessageStatus = {
    PENDING: 0,
    SENT: 1
  };

  /**
   * Holds pending requests.
   * @type {Array}
   * @default null
   * @protected
   */
  lfr.WebChannel.prototype.pendingRequests_ = null;

  /**
   * Timeout for performed database action in milliseconds.
   * @type {number}
   * @default 30000
   * @protected
   */
  lfr.WebChannel.prototype.timeoutMs_ = 30000;

  /**
   * Holds the transport.
   * @type {lfr.Transport}
   * @default null
   * @protected
   */
  lfr.WebChannel.prototype.transport_ = null;

  /**
   * Dispatches web channel transport action with timeout support.
   * @param {!Function} handler
   * @param {!*} data Message object to the message.
   * @param {Object=} opt_config Optional configuration object with metadata
   *   about delete operation.
   * @return {Promise}
   */
  lfr.WebChannel.prototype.createDeferredRequest_ = function(method, data, opt_config) {
    var self = this;
    var nextRid = ((Math.random() * 1e9) >>> 0);
    var message = {
      id: nextRid,
      config: opt_config,
      data: data,
      _method: method
    };

    var def = new lfr.Promise(function(resolve, reject) {
      self.pendingRequests_.push({
        message: message,
        reject: reject,
        resolve: resolve,
        status: lfr.WebChannel.MessageStatus.PENDING
      });
      self.processPendingRequests_();
    });

    // Removes itself from pending requests when it's done.
    def.thenAlways(function() {
      lfr.array.removeAt(self.pendingRequests_, self.findPendingRequestById_(message.id));
    });

    this.startRequestTimer_(def);

    return def;
  };

  /**
   * Sends message with DELETE http verb.
   * @param {*=} message The value which will be used to send as request data.
   * @param {Object=} opt_config Optional message payload.
   * @return {Promise}
   */
  lfr.WebChannel.prototype.delete = function(message, opt_config) {
    return this.createDeferredRequest_(lfr.WebChannel.HttpVerbs.DELETE, message, opt_config);
  };

  /**
   * @inheritDoc
   */
  lfr.WebChannel.prototype.disposeInternal = function() {
    lfr.WebChannel.base(this, 'disposeInternal');

    this.transport_.dispose();
    this.transport_ = null;
  };

  /**
   * Finds a pending request by id.
   * @param {number} id Message random id.
   * @return {?Object} Returns pending request object, returns null if not
   *   found.
   * @protected
   */
  lfr.WebChannel.prototype.findPendingRequestById_ = function(id) {
    for (var i = 0; i < this.pendingRequests_.length; ++i) {
      if (id === this.pendingRequests_[i].message.id) {
        return this.pendingRequests_[i];
      }
    }
    return null;
  };

  /**
   * Sends message with GET http verb.
   * @param {*=} message The value which will be used to send as request data.
   * @param {Object=} opt_config Optional message payload.
   * @return {Promise}
   */
  lfr.WebChannel.prototype.get = function(message, opt_config) {
    return this.createDeferredRequest_(lfr.WebChannel.HttpVerbs.GET, message, opt_config);
  };

  /**
   * Gets timeout in milliseconds.
   * @return {number}
   */
  lfr.WebChannel.prototype.getTimeoutMs = function() {
    return this.timeoutMs_;
  };

  /**
   * Gets the transport used to send messages to the server.
   * @return {lfr.Transport} The transport used to send messages to the
   *   server.
   */
  lfr.WebChannel.prototype.getTransport = function() {
    return this.transport_;
  };

  /**
   * Sends message with HEAD http verb.
   * @param {*=} message The value which will be used to send as request data.
   * @param {Object=} opt_config Optional message payload.
   * @return {Promise}
   */
  lfr.WebChannel.prototype.head = function(message, opt_config) {
    return this.createDeferredRequest_(lfr.WebChannel.HttpVerbs.HEAD, message, opt_config);
  };

  /**
   * Event listener to transport `close` event.
   * @protected
   */
  lfr.WebChannel.prototype.onTransportClose_ = function() {
    for (var i = 0; i < this.pendingRequests_.length; ++i) {
      this.pendingRequests_[i].status = lfr.WebChannel.MessageStatus.PENDING;
    }
  };

  /**
   * Event listener to transport `error` event.
   * @protected
   */
  lfr.WebChannel.prototype.onTransportError_ = function() {
    for (var i = 0; i < this.pendingRequests_.length; ++i) {
      this.pendingRequests_[i].reject(new lfr.Promise.CancellationError('Transport error'));
    }
  };

  /**
   * Event listener to transport `open` event.
   * @protected
   */
  lfr.WebChannel.prototype.onTransportOpen_ = function() {
    this.processPendingRequests_();
  };

  /**
   * Event listener to transport `data` event.
   * @protected
   * @param {*} data
   */
  lfr.WebChannel.prototype.onTransportReceiveData_ = function(data) {
    if (!data) {
      console.warn('Malformed data arrived');
      return;
    }
    var pendingRequest = this.findPendingRequestById_(data.id);
    if (pendingRequest) {
      pendingRequest.resolve(data);
    }
  };

  /**
   * Sends message with PATCH http verb.
   * @param {*=} message The value which will be used to send as request data.
   * @param {Object=} opt_config Optional message payload.
   * @return {Promise}
   */
  lfr.WebChannel.prototype.patch = function(message, opt_config) {
    return this.createDeferredRequest_(lfr.WebChannel.HttpVerbs.PATCH, message, opt_config);
  };

  /**
   * Sends message with POST http verb.
   * @param {*=} message The value which will be used to send as request data.
   * @param {Object=} opt_config Optional message payload.
   * @return {Promise}
   */
  lfr.WebChannel.prototype.post = function(message, opt_config) {
    return this.createDeferredRequest_(lfr.WebChannel.HttpVerbs.POST, message, opt_config);
  };

  /**
   * Processes pending requests.
   * @protected
   */
  lfr.WebChannel.prototype.processPendingRequests_ = function() {
    for (var i = 0; i < this.pendingRequests_.length; ++i) {
      var pendingRequest = this.pendingRequests_[i];
      if (pendingRequest.status === lfr.WebChannel.MessageStatus.PENDING) {
        pendingRequest.status = lfr.WebChannel.MessageStatus.SENT;
        this.transport_.send(pendingRequest.message);
      }
    }
  };

  /**
   * Sends message with PUT http verb.
   * @param {*=} message The value which will be used to send as request data.
   * @param {Object=} opt_config Optional message payload.
   * @return {Promise}
   */
  lfr.WebChannel.prototype.put = function(message, opt_config) {
    return this.createDeferredRequest_(lfr.WebChannel.HttpVerbs.PUT, message, opt_config);
  };

  /**
   * Sets timeout in milliseconds.
   * @param {number} timeoutMs
   */
  lfr.WebChannel.prototype.setTimeoutMs = function(timeoutMs) {
    this.timeoutMs_ = timeoutMs;
  };

  /**
   * Sets the transport used to send pending requests to the server.
   * @param {lfr.Transport} transport
   */
  lfr.WebChannel.prototype.setTransport = function(transport) {
    if (this.transport_) {
      this.transport_.dispose();
    }
    this.transport_ = transport.open();
    this.transport_.on('close', lfr.bind(this.onTransportClose_, this));
    this.transport_.on('data', lfr.bind(this.onTransportReceiveData_, this));
    this.transport_.on('error', lfr.bind(this.onTransportError_, this));
    this.transport_.on('open', lfr.bind(this.onTransportOpen_, this));
  };

  /**
   * Starts the timer for the given request's timeout.
   * @param {!Promise} requestPromise The promise object for the request.
   */
  lfr.WebChannel.prototype.startRequestTimer_ = function(requestPromise) {
    var timer = setTimeout(function() {
      requestPromise.cancel(new lfr.Promise.CancellationError('Timeout'));
    }, this.getTimeoutMs());

    requestPromise.thenAlways(function() {
      clearTimeout(timer);
    });
  };

}());