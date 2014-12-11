var _ = require("underscore"),
	Backbone = require("backbone"),
	PouchDB = require("pouchdb"),
	utils = require("./utils"),
	Promise = require("bluebird");

function Database(name, opts) {
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
module.exports = Database;

// load document after setting exports
var Document = require("./document");

// database extends backbone collection
Database.prototype = Object.create(Backbone.Collection.prototype);

// database class extends document
_.extend(Database.prototype, {

	model: Document,
	parse: utils.parse,
	sync: require("./sync"),

	// listens for changes to pouch
	connect: function(options) {
		var self = this;

		// always disconnect first
		this.disconnect();

		// create/update function
		function onChange(row) {
			self.add(row.doc, { merge: true, database: this });
		}

		// the listener
		this._pouchChange = this.pouch.changes(_.defaults({
			include_docs: true,
			conflicts: true,
			live: true,
			returnDocs: false
		}, options, {
			attachments: false
		}))

		// creates and updates are handled the same
		.on("create", onChange)
		.on("update", onChange)

		// remove everything marked as a delete
		.on("delete", function(row) {
			self.remove(row.id);
		})

		// catch errors
		Promise.cast(this._pouchChange.catch(function(e) {
			self.trigger("error", e);
			throw e;
		}))

		// always disconnect when changes stop
		.finally(function() {
			self.disconnect();
		});

		// annouce the connection
		this.trigger("connect", this._pouchChange);

		return this;
	},

	// unloads the project from memory
	disconnect: function() {
		// only disconnect if connected
		if (this._pouchChange) {
			// disable changes feed
			this._pouchChange.cancel();
			delete this._pouchChange;

			// announce disconnect
			this.trigger("disconnect");
		}

		return this;
	},

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

				// extract first 20 ids
				ids = Object.keys(queue).slice(0, 20);
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
				}, { concurrency: 5 })

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

	// waits 1/2 second before flushing writes
	_invalidateWrites: function() {
		var self = this;

		// only set timeout if doesn't exist
		if (this._writesTimeout == null) {
			this._writesTimeout = setTimeout(function() {
				delete self._writesTimeout;
				self._flushWrites();
			}, 500);
		}
		
		return this;
	},

	// cleans up write state
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

	// normal model destroy + plus some state setup
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