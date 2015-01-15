/**
 * # Lazybones
 *
 * Lazybones is a modified Backbone collection that integrates with PouchDB. By combining Backbone's object-oriented approach with PouchDB's super flexible databases, Lazybones provides a highly-functional API for storing and manipulating data in the browser and Node.js.
 *
 * A deeper understanding of [Backbone](http://backbonejs.org) is recommended since many of Lazybones methods and concepts are inherited directly from Backbone Collection. Knowledge of PouchDB's API is also recommended, but not required to use Lazybones.
 */

var _ = require("underscore"),
	Backbone = require("backbone"),
	PouchDB = require("pouchdb"),
	utils = require("./utils"),
	Promise = require("bluebird");

/**
 * ## Constructor
 *
 * To use Lazybones, create a new database instance with a name:
 * 
 * ```javascript
 * var db = new Lazybones("testdb");
 * ```
 * 
 * Databases are always created with an associated PouchDB instance. If PouchDB needs to be specially initialized, instances can be created ahead of time and passed in via `options.pouch`. Otherwise, the Lazybones constructor will create a new PouchDB instance from the `name` argument.
 * 
 * #### Arguments
 * 
 * - **name** _string_ - The name of the Pouch database to connect to. This can either be a local database name (indexeddb or leveldb) or a remote CouchDB url. This argument is required and a `MISSING_ID` error is thrown when not provided.
 * - **options** _object; optional_ - An object of options to initiate the database with. This variable is passed directly to the `Backbone.Collection` constructor.
 *   - **options.pouch** _object | PouchDB_ - An instance of PouchDB or an object of options to pass to the PouchDB constructor.
 */

function Lazybones(name, opts) {
	opts = opts || {};

	// check the name variable
	if (!_.isString(name) || name === "") {
		throw new utils.LazyError("MISSING_ID", "Expecting non-empty string for database id.");
	}

	// create PouchDB instance from options
	this.pouch = opts.pouch instanceof PouchDB ? opts.pouch : new PouchDB(name, opts.pouch);

	// mimic destroyed event
	this.pouch.on("destroyed", this.trigger.bind(this, "destroyed"));

	// set the database name on the object for easy access
	Object.defineProperty(this, "name", {
		value: name,
		writeable: false,
		configurable: true,
		enumerable: true
	});

	// finish initialization as an empty collection.
	Backbone.Collection.call(this, [], opts);
}

// export immediately so recursive dependents get the correct value
module.exports = Lazybones;

// Lazybones is an extension Backbone.Collection 
Lazybones.prototype = Object.create(Backbone.Collection.prototype);

// the current version
Lazybones.VERSION = "0.1.6";
 
/**
 * ## Static Methods & Properties
 * 
 * - **Lazybones.utils** _object_ - Lazybones and PouchDB utility methods.
 * - **Lazybones.Document** _function_ - The Document constructor, which is a subclass of `Backbone.Model`.
 * - **Lazybones.sync** _function_ - The Lazybones sync method. This replaces `Backbone.sync`.
 * - **Lazybones.extend** _function_ - Creates a subclass of Lazybones. This is the same method that Backbone uses.
 */

// load in other parts before setting up class methods
Lazybones.utils = utils;
var Document = Lazybones.Document = require("./document");
Lazybones.Backbone = Backbone;
Lazybones.sync = require("./sync");
Lazybones.extend = Backbone.Collection.extend;

/**
 * ## Instance Properties
 * 
 * - **db.name** _string; non-writeable_ - The database name passed in to the constructor is set as a non-writeable property on the instance to make easy to access.
 * - **db.model** _function_ - The model constructor to use when creating documents from data. This defaults to `Lazybones.Document`, but can be any subclass of `Backbone.Model` or a function which returns new model instances.
 *
 * ## Instance Methods
 *
 * These methods are addition to methods provided by `Backbone.Collection`.
 */
_.extend(Lazybones.prototype, {

	// add externally declared methods
	model: Document,
	parse: utils.parse,
	sync: require("./sync"),

	/**
	 * ### connect()
	 *
	 * Listens to the PouchDB changes feed and replicates any changes to the in-memory documents. By default, the changes are "live" meaning that future changes will listened for. Use `db.disconnect()` to stop a live connection.
	 *
	 * `this` is returned for method chaining.
	 * 
	 * #### Arguments
	 * 
	 * - **options** _object; optional_ - An object of properties that are passed to `pouch.changes()`. All PouchDB changes properties are allowed, except for `include_docs` which is set to true. Below are the properties with default values. Please see the [PocuhDB documentation](http://pouchdb.com/api.html#changes) for the remaining options.
	 *   - **options.attachments** _boolean_ - Whether or not to include attachment data in the request. If `true`, attachments will be accessible via the `_attachments` attribute. Default value is `false`.
	 *   - **options.conflicts** _boolean_ - Whether or not to include conflicting revision ids in the `_conflicts` attribute. Default value is `true`.
	 *   - **options.returnDocs** _boolean_ - Tells PouchDB to not return all the documents on the `complete` event, preventing a lot of extra memory usage. Default value is `false`.
	 *   - **options.live** _boolean_ - The database will continuously listen for changes, keeping the in-memory documents in sync with those in the database. Setting this to `false` will result in the database disconnecting as soon as it is has been caught up. Default value is `true`.
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
		this._pouchChange = this.pouch.changes(_.extend({
			attachments: false,
			conflicts: true,
			returnDocs: false,
			live: true
		}, options, {
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
	 * ### disconnect()
	 * 
	 * Stops the database from listening to the PouchDB changes feed. This method has no effect if the database is not currently connected.
	 *
	 * `this` is returned for method chaining.
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
	 * ### load()
	 *
	 * A combination of `db.fetch()` and `db.connect()`. This will fetch from the database so all the current documents are in-memory, then it begins a live connection that starts from the current update sequence. In this way the database can catch up very quickly, but also respond to future database changes.
	 *
	 * This method returns a promise that is resolved when the database has been fetched and the live replication has started.
	 */
	load: function(options) {
		options = options || {};

		// get the database info to get the last sequence number
		return Promise.cast(this.pouch.info()).bind(this)

		// fetch the database for a super-fast catch up
		.tap(function() { return this.fetch(options); })

		// connect, starting at the last sequence
		.then(function(info) {
			return this.connect(_.extend({}, options, { since: info.update_seq }));
		});
	},

	/**
	 * ### destroy()
	 *
	 * Destroys the underlying PouchDB database. This will keep all the existing documents in-memory, so call `db.reset()` to remove those as well. The Lazybones instance should not be used after this method has been called.
	 *
	 * This method returns a promise that is resolved when the database is destroyed.
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
	},

	/**
	 * ### _pushWrite()
	 *
	 * A private method that adds a document insert, update, or delete request to the internal write queue. If the document is already in the queue, nothing happens.
	 *
	 * This method returns a promise that is resolved when the write is completed.
	 *
	 * #### Arguments
	 * 
	 * - **doc** _object_ - A plain javascript object to write to the database. This should have at least `_id` property.
	 * - **_delete** _boolean_ - A flag to mark this write as a delete instead of an insert or update. Defaults to `false`.
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
	 * ### _flushWrites()
	 *
	 * A private method that pushes the first 100 requests in the write queue to the database. When finished, this calls `db._invalidateWrites()` to continue flushing any remaining requests.
	 *
	 * This method returns a promise that is resolved when the requests pulled from the queue on this flush have all completed.
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
					docs[index][result.error ? "reject" : "resolve"](result);

					// remove from the queue if resolution was successful
					delete queue[ids[index]];
					
					// force it async so we can't lock up the browser
					return utils.asyncDefer();
				}, { concurrency: 20 })

				// after a successful write, invalidate the queue again
				.then(this._invalidateWrites);
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
	 * ### _invalidateWrites()
	 *
	 * A private method that sets up a timeout that calls `db._flushWrites()` after 200ms. If a timeout is already running, this method has no effect.
	 *
	 * `this` is returned for method chaining.
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
	 * ### _cancelWrites()
	 *
	 * A private method that waits for any current writes to finish and then cancels all pending requests in the write queue with a `WRITE_CANCELLED` error. This ensures the write queue is empty before the database is destroyed.
	 *
	 * This method returns a promise that is resolved when all writes are flushed or canceled.
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
	}

});