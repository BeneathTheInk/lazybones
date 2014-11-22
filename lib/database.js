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

	_pushWrite: function(doc) {
		if (this._writeQueue == null) this._writeQueue = {};

		// must have an id
		if (!doc._id) throw new util.LazyError("MISSING_ID");

		// we only overwrite if the existing isn't marked as deleted
		var existing = this._writeQueue[doc._id];
		if (existing && existing._deleted && !doc._deleted) {
			throw new util.LazyError("ILLEGAL_UPDATE", "Refusing to update a queued deleted document.");
		}
		
		// add to the queue
		this._writeQueue[doc._id] = doc;

		// invalidate the queue
		this._invalidateWrites();
		return this;
	},

	_flushWrites: function() {
		if (this._writeQueue == null) this._writeQueue = {};

		// extract first 20 ids in write queue
		var ids = Object.keys(this._writeQueue).slice(0, 20);
		var docs = ids.map(function() { return this._writeQueue[ids]; }, this);
		this._writeQueue = _.omit(this._writeQueue, ids);

		console.log(docs);
		// this.pouch.bulkDocs(docs).then(function(result) {

		// });
	},

	// basic debounce
	_invalidateWrites: function() {
		var self = this;

		// remove existing timeout
		if (this._writesTimeout) clearTimeout(this._writesTimeout);
		
		// create new timeout
		this._writesTimeout = setTimeout(function() {
			delete self._writesTimeout;
			self._flushWrites();
		}, 1000);
		
		return this;
	}

});