var _ = require("underscore"),
	Backbone = require("backbone"),
	PouchDB = require("pouchdb"),
	utils = require("./utils"),
	Promise = require("bluebird");

function Database(attrs, opts) {
	var id;

	// default options
	opts = _.defaults(opts || {}, {
		document: Document
	});

	// attach just db id or full metadata
	if (typeof attrs === "string") {
		id = attrs;
		attrs = { _id: id };
	} else {
		if (!attrs) attrs = {};
		id = attrs._id;
	}

	// verify database id
	if (!_.isString(id) || id === "") {
		throw new utils.LazyError("MISSING_ID", "Expecting non-empty string for database id.");
	}

	// extract metaid
	if (_.isString(opts.metaid) && opts.metaid !== "") this.metaid = opts.metaid;

	// load a new pouch database
	this.pouch = opts.pouch instanceof PouchDB ? opts.pouch : new PouchDB(id, opts.pouch);

	// a collection to hold all documents
	this.documents = new Backbone.Collection([], {
		model: opts.document
	});

	// document constructor
	Document.call(this, attrs, opts);
}

// export first so any recursive dependents get correct value
module.exports = Database;

// database extends document
var Document = require("./document");
Database.prototype = Object.create(Document.prototype);

// database class extends document
_.extend(Database.prototype, {

	metaid: ".meta",

	// a simple boolean state helper
	state: function(key, value) {
		this._attachState();

		// accept object of values
		if (typeof key === "object") {
			_.each(key, this.state, this);
			return;
		}

		// if value is null return the current state
		if (value == null) return !!this._state.get(key);
		
		// otherwise set the state
		this._state.set(key, !!value);
	},

	// attaches state model and listen for changes
	_attachState: function() {
		if (this._state != null) return this;

		this._state = new Backbone.Model();

		this.listenTo(this._state, "change", function(m) {
			_.each(m.changed, function(v, k) {
				this.trigger("state:" + k, v);
			}, this);
		});

		return this;
	},

	// loads the project into memory
	load: function(options) {
		var self = this;

		// always unload first
		this.unload();

		// set loading state
		this.state("loading", true);

		// default load options
		options = _.defaults(options || {}, {
			model: Document
		});

		// get the last update sequence first
		return Promise.cast(db.info()).bind(this)

		// insert existing docs
		.then(function(info) {
			return db.allDocs({
				include_docs: true,
				conflicts: true,
				attachments: false
			})

			// insert docs
			.then(function(res) {
				// async so we don't lock up the browser on large databases
				return Promise.map(res.rows, function(row) {
					return Promise.cast(self._onPouchChange("create", row)).then(util.asyncDefer);
				}, { concurrency: 100 });
			})

			// return the last update sequence
			.return(info.update_seq);
		})

		// continue listening for changes
		.then(function(last_seq) {
			this._pouchChange = db.changes({
				include_docs: true,
				conflicts: true,
				attachments: false,
				live: true,
				since: last_seq
			})

			.on("create", this._onPouchChange.bind(this, "create"))
			.on("update", this._onPouchChange.bind(this, "update"))
			.on("delete", this._onPouchChange.bind(this, "delete"))

			// TODO: deal with errors
			// .on("error", app.notify);

			this._pouchChange.then(function() {
				// TODO: deal with changes being cancelled
			}, function(e) {
				console.warn("Connection with local database has been terminated.");
				console.error(e.stack || e.toString());
			});

			// set the new state
			this.state({
				loading: false,
				memory: true
			});
		});
	},

	// the change function for pouch
	_onPouchChange: function(method, row) {
		var doc = row.doc;

		// handle document conflicts
		// basically we just delete all conflicts
		if (doc._conflicts && doc._conflicts.length) {
			// TODO: handle conflicts
		}

		// add doc to master database
		if (method === "delete") this.documents.remove(row.id);
		else this.documents.set(doc, { remove: false, database: this });
	},

	// unloads the project from memory
	unload: function() {

	},

	// replaces database id with meta id
	toJSON: function() {
		var data = Document.prototype.toJSON.apply(this, arguments);
		data._id = this.metaid;
		return data;
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

		Promise.bind(this).then(function() {
			var ids, docs, queue;

			// don't flush while flushing
			if (this._flushing) return this._invalidateWrites();
			this._flushing = true;

			// make sure there are items in the queue
			queue = this._writeQueue;
			if (!_.size(queue)) return;

			// extract first 20 ids
			ids = Object.keys(queue).slice(0, 20);
			docs = ids.map(function(i) { return queue[i]; }, this);

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

		// give a way to catch any major errors
		.catch(function(e) {
			this.trigger("error", e);
			throw e;
		})

		// always, always reset state
		.finally(function() {
			delete this._flushing;
			this.trigger("flush");
		});
	},

	// basic debounce
	_invalidateWrites: function() {
		var self = this;

		// only set timeout if doesn't exist
		if (this._writesTimeout == null) {
			this._writesTimeout = setTimeout(function() {
				delete self._writesTimeout;
				self._flushWrites();
			}, 1000);
		}
		
		return this;
	},

	// clean up database state before it gets destroyed
	_cancelAllWrites: function() {
		var self = this;

		// wait for the database to finish any current writes
		return new Promise(function(resolve, reject) {
			if (!self._flushing) resolve();
			else self.once("flush", resolve);
		}).bind(this)

		// clean out all writes in the queue
		.then(function() {
			_.each(this._writeQueue, function(d) {
				d.reject(new util.LazyError("WRITE_CANCELLED"));
			});

			this._writeQueue = {};
		});
	},

	isNew: function() {
		// a database being destroyed is never new
		if (this._destroying) return false;
		return Document.prototype.isNew.apply(this, arguments);
	},

	// normal model destroy + plus some state setup
	destroy: function() {
		// resolves immediately if currently destroying
		if (this._destroying) return Promise.bind(this);

		// set database destroying state
		this._destroying = true;

		// run normal destroy
		return Document.prototype.destroy.apply(this, arguments)

		// clean up state
		.finally(function() {
			delete this._destroying;
		});
	}

});