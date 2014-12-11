var _ = require("underscore"),
	PouchDB = require("pouchdb"),
	Promise = require("bluebird");

// pouchdb utils
_.extend(exports, _.pick(PouchDB.utils, "uuid"));

// reveal promises
exports.Promise = Promise;

// pouchdb whitelist option keys
exports.pouchOptionKeys = {
	get: [ "rev", "revs", "revs_info", "open_revs", "conflicts", "attachments", "local_seq", "ajax" ],
	allDocs: [ "include_docs", "conflicts", "attachments", "startkey", "endkey", "inclusive_end", "limit", "skip", "descending", "key", "keys" ],
	changes: [ "include_docs", "conflicts", "attachments", "filter", "doc_ids", "since", "live", "limit", "style", "view", "returnDocs", "batch_size" ]
};

// iso date regular expression
var iso_date_regex = /\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z)/;

// parse raw dates in documents
var parse =
exports.parse = function(attrs) {
	// process arrays of attributes
	if (_.isArray(attrs)) {
		attrs.forEach(parse, this);
		return attrs;
	}

	// convert dates
	_.each(attrs, function(val, key) {
		if (_.isString(val) && iso_date_regex.test(val)) {
			var time = Date.parse(val);
			if (!isNaN(time)) attrs[key] = new Date(time);
		}
	});

	return attrs;
}

// basic deferred promise
exports.asyncDefer = function (data) {
	return new Promise(function(resolve) {
		process.nextTick(resolve.bind(null, data));
	});
}

// custom error class
function LazyError(code, msg) {
	Error.call(this);

	var code = _.isString(code) ? code.toUpperCase() : null;
	if (!code || LazyError.errors[code] == null) code = "UNKNOWN_ERROR";

	this.code = code;

	Object.defineProperty(this, "_message", {
		value: msg || LazyError.errors[code],
		writeable: false,
		enumerable: false,
		configurable: false
	});
}

exports.LazyError = LazyError;
LazyError.prototype = Object.create(Error.prototype);

LazyError.prototype.name = "LazyError";

Object.defineProperty(LazyError.prototype, "message", {
	get: function() {
		return this._message + " (" + this.code + ")";
	},
	enumerable: true,
	configurable: false
});

LazyError.prototype.toString = function() {
	return this.name + ": " + this.message;
}

LazyError.errors = {
	POUCH_ERROR: "PouchDB had an error.",
	INVALID_DOCUMENT: "Expecting a valid document.",
	MISSING_ID: "Document is missing '_id' attribute.",
	MISSING_REVISION: "Document is missing '_rev' attribute.",
	MISSING_DATABASE: "Document is missing database reference.",
	ILLEGAL_UPDATE: "Refusing to update this document.",
	WRITE_CANCELLED: "Database write was canceled.",
	DATABASE_DESTROYED: "Database has been destroyed.",
	UNKNOWN_ERROR: "An unknown error occurred."
}

exports.transformPouchError = function(e) {
	// make sure this is a real pouch error
	if (!(e || e.error)) throw e;

	var nerr = new LazyError("POUCH_ERROR", e.message);
	nerr.error = true; // keep it consistent
	nerr.status = e.status;
	nerr.pouch_name = e.name;
	throw nerr;
}