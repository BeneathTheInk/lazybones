var _ = require("underscore"),
	Backbone = require("backbone"),
	PouchDB = require("pouchdb"),
	utils = require("./utils");

function Database(attrs, opts) {
	var id;

	opts = opts || {};

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
		throw new Error("Expecting non-empty string for database id.");
	}

	// extract metaid
	if (_.isString(opts.metaid) && opts.metaid !== "") this.metaid = opts.metaid;

	// load a new pouch database
	this.pouch = opts.pouch instanceof PouchDB ? opts.pouch : new PouchDB(id, opts.pouch);

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
	load: function() {},

	// unloads the project from memory
	unload: function() {},

	// replaces database id with meta id
	toJSON: function() {
		var data = Document.prototype.toJSON.apply(this, arguments);
		data._id = this.metaid;
		return data;
	}

});