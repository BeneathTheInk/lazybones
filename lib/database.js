// Dependencies
var _ = require("underscore"),
	Backbone = require("backbone"),
	PouchDB = require("pouchdb"),
	utils = require("./utils"),
	Promise = require("bluebird");

/**
 * The Lazybones database constructor. This returns an instance of Lazybones, which is a subclass of `Backbone.Collection`.
 *
 * @class
 * @extends Backbone.Collection
 * @param {string} name - The name of the Pouch database to connect tp. This can either be a local database name (indexeddb or leveldb) or a remote CouchDB url.
 * @param {object} [options] - An object of options to initiate the database with. This variable is passed directly to the `Backbone.Collection` constructor.
 * @param {(object|PouchDB)} [options.pouch] - An instance of PouchDB or an object of options to pass to the PouchDB constructor.
 */
function Lazybones(name, opts) {
	opts = opts || {};

	// verify database id
	if (!_.isString(name) || name === "") {
		throw new utils.LazyError("MISSING_ID", "Expecting non-empty string for database id.");
	}

	// load the pouch database
	this.pouch = opts.pouch instanceof PouchDB ? opts.pouch : new PouchDB(name, opts.pouch);

	// set the name on the database for easy access
	Object.defineProperty(this, "name", {
		value: name,
		writeable: false,
		configurable: true,
		enumerable: true
	});

	// collection constructor
	Backbone.Collection.call(this, [], opts);
}

// export first so any recursive dependents get correct value
module.exports = Lazybones;

// load document after setting exports
var Document = require("./document");

// database extends backbone collection
Lazybones.prototype = Object.create(Backbone.Collection.prototype);

/**
 * Creates a subclass of Lazybones.
 *
 * @function extend
 * @memberof Lazybones
 * @static
 * @param {object} instance_props - An object of instance methods and properties that are copied onto the new class's prototype object.
 * @param {object} [class_props] - An object of static methods and properties attached directly to the class variable
 * @returns A constructor for a new class that extends Lazybones.
 */
Lazybones.extend = Backbone.Collection.extend;

// database class extends document
_.extend(Lazybones.prototype, {

	/**
	 * @memberof Lazybones
	 * @member {Document} model - This defaults to the built-in Document class, but can be replaced for custom documents.
	 * @instance
	 */
	model: Document,
	parse: utils.parse,
	sync: require("./sync"),

	/**
	 * Listens to the PouchDB changes feed and replicates any changes to the in-memory documents. By default, the changes are "live" meaning that future changes will listened for. Use the `.disconnect()` to stop a live connection.
	 *
	 * @function connect
	 * @memberof Lazybones
	 * @instance
	 * @param {object} [options] - An object of properties that are passed to `pouch.changes()`. All PouchDB changes properties are allowed, except for `include_docs` which is set to true. Below are the properties with default values. Please see the [PocuhDB documentation](http://pouchdb.com/api.html#changes) for the remaining options.
	 * @param {object} [options.attachments=false] - Whether or not to include attachment data.
	 * @param {object} [options.conflicts=true] - Whether or not to include conflicting revision ids in the `_conflicts` field.
	 * @param {object} [options.returnDocs=false] - Tells PouchDB to not return all the documents on the `complete` event, preventing a lot of extra memory usage.
	 * @param {object} [options.live=true] - The database will continuously listen for changes, keeping the in-memory documents in sync with those in the database. Setting this to `false` will result in the database disconnecting as soon as it is has been caught up.
	 * @returns `this` for chaining.
	 */
	connect: function(options) {
		var self = this;

		// always disconnect first
		this.disconnect();

		// create/update function
		function onChange(row) {
			self.add(row.doc, { merge: true, database: self });
		}

		// uptodate event should only be called once per connection
		var onUpToDate = _.once(function(info) {
			self.trigger("uptodate", info);
		});

		// the listener
		var listener =
		this._pouchChange = this.pouch.changes(_.extends({
			attachments: false,
			conflicts: true,
			returnDocs: false,
			live: true
		}, _.pick(options, utils.pouchOptionKeys.changes), {
			include_docs: true
		}))

		// listen for uptodate
		.on("uptodate", onUpToDate)
		.on("complete", onUpToDate) // when live = false

		// creates and updates are handled the same
		.on("create", onChange)
		.on("update", onChange)

		// remove everything marked as a delete
		.on("delete", function(row) {
			self.remove(row.id);
		});

		// catch any terminating errors
		Promise.cast(listener.catch(function(e) {
			self.trigger("error", e);
		}))

		.then(function(resp) {
			// clean up
			self.disconnect();

			// announce disconnect
			self.trigger("disconnect", listener, resp);
		});

		// annouce the connection
		this.trigger("connect", listener);

		return this;
	},

	/**
	 * Stops the database from listening to the PouchDB changes feed. This method has no effect if the database is not currently connected.
	 *
	 * @function disconnect
	 * @memberof Lazybones
	 * @instance
	 * @returns `this` for chaining
	 */
	disconnect: function() {
		// only disconnect if connected
		if (this._pouchChange) {
			this._pouchChange.cancel();
			delete this._pouchChange;
		}

		return this;
	},

	/**
	 * Adds a document write to the queue. If the document is already in the queue, nothing happens.
	 *
	 * @function _pushWrite
	 * @memberof Lazybones
	 * @instance
	 * @private
	 * @param {object} doc - A plain javascript object to write to the database. This should have at least `_id` property.
	 * @param {boolean} _delete - A flag to mark this write as a delete instead of an insert or update.
	 * @returns {Promise} A promise that is resolved when the write is completed.
	 */
	_pushWrite: function(doc, _delete) {
		if (this._writeQueue == null) this._writeQueue = {};
		var self = this;

		return new Promise(function(resolve, reject) {
			// if the database is being destroyed we can reject with a cancel
			if (self._destroying) throw new utils.LazyError("WRITE_CANCELLED");

			// verify document
			if (!_.has(doc, "_id")) throw new utils.LazyError("MISSING_ID");

			// if deleting, transform the document
			if (_delete) {
				doc = _.pick(doc, "_id", "_rev");
				if (!doc._rev) throw new utils.LazyError("MISSING_REVISION");
				doc._deleted = true;
			}

			// we only overwrite if the existing doc isn't marked as deleted
			if (!doc._deleted) {
				var existing = self._writeQueue[doc._id];
				if (existing && existing._deleted) {
					throw new utils.LazyError("ILLEGAL_UPDATE", "Refusing to update a queued deleted document.");
				}
			}
			
			// add to the queue
			self._writeQueue[doc._id] = {
				doc: doc,
				resolve: resolve,
				reject: reject
			};

			// invalidate the queue
			self._invalidateWrites();
		})

		.bind(this)
		.catch(utils.transformPouchError);
	},

	/**
	 * Pushes the top 100 writes in the queue to the database. When finished, this calls `._invalidateWrites()` to continue the cycle.
	 *
	 * @function _flushWrites
	 * @memberof Lazybones
	 * @instance
	 * @private
	 * @returns {Promise} A promise that is resolved when the writes are completed.
	 */
	_flushWrites: function() {
		if (this._writeQueue == null) this._writeQueue = {};

		// wrapper promise for error catching
		return Promise.bind(this).then(function() {
			var queue;

			// don't flush while flushing
			if (this._flushing) {
				this._invalidateWrites();
				return Promise.bind(this);
			}

			// make sure there are items in the queue
			queue = this._writeQueue;
			if (!_.size(queue)) return;

			// promise that writes to database
			return Promise.bind(this).then(function() {
				var ids, docs;

				// enable flush state
				this._flushing = true;

				// extract first 100 ids
				ids = Object.keys(queue).slice(0, 100);
				docs = _.values(_.pick(queue, ids));

				// push all the docs at once
				return Promise.cast(this.pouch.bulkDocs(_.pluck(docs, "doc"))).bind(this)

				// catch any immediate pouch errors
				.catch(utils.transformPouchError)

				// return result async
				.map(function(result, index) {
					// resolve or reject depending on result
					docs[index][result.ok ? "resolve" : "reject"](result);

					// remove from the queue if resolution was successful
					delete queue[ids[index]];
					
					// force it async so we can't lock up the browser
					return utils.asyncDefer();
				}, { concurrency: 20 })

				// after a successful write, invalidate the queue again
				.then(this._invalidateWrites)
			})

			// always, always reset state
			.finally(function() {
				delete this._flushing;
				this.trigger("flush");
			});

		})

		// catch any major errors
		.catch(function(e) {
			console.log(e);
			this.trigger("error", e);
			throw e;
		});
	},

	/**
	 * Sets up a timeout that calls `._flushWrites()` after 200ms. If a timeout is already running, this method has no effect.
	 *
	 * @function _flushWrites
	 * @memberof Lazybones
	 * @instance
	 * @private
	 * @returns `this` for chaining
	 */
	_invalidateWrites: function() {
		var self = this;

		// only set timeout if doesn't exist
		if (this._writesTimeout == null) {
			this._writesTimeout = setTimeout(function() {
				delete self._writesTimeout;
				self._flushWrites();
			}, 200);
		}
		
		return this;
	},

	/**
	 * Cancels all pending writes with a `WRITE_CANCELLED` error. This is to ensure the database is properly cleaned when it is destroyed.
	 *
	 * @function _flushWrites
	 * @memberof Lazybones
	 * @instance
	 * @private
	 * @returns {Promise} A promise that is resolved when all writes are canceled.
	 */
	_cancelWrites: function() {
		var self = this;

		// wait for the database to finish any current writes
		return new Promise(function(resolve, reject) {
			if (!self._flushing) resolve();
			else self.once("flush", resolve);
		}).bind(this)

		// clean out all writes remaining in the queue
		.then(function() {
			_.each(this._writeQueue, function(d) {
				d.reject(new utils.LazyError("WRITE_CANCELLED"));
			});

			this._writeQueue = {};
		});
	},

	/**
	 * Destroys the PouchDB database. This will keep all the documents in-memory, so calling `.reset()` after is good idea.
	 *
	 * @function destroy
	 * @memberof Lazybones
	 * @instance
	 * @returns {Promise} A promise that is resolved when the database is destroyed.
	 */
	destroy: function() {
		// resolves immediately if currently destroying
		if (this._destroying) return Promise.bind(this);

		// set database destroying state
		this._destroying = true;

		// disconnect live connection
		this.disconnect();

		// clean up the write queue
		return this._cancelWrites()

		// destroy the pouch database
		.then(function() {
			return this.pouch.destroy();
		})

		// clean up state
		.finally(function() {
			delete this._destroying;
		});
	}

});