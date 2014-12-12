/**
 * @module lazybones/utils
 */

var _ = require("underscore"),
	PouchDB = require("pouchdb"),
	Promise = require("bluebird");

/**
 * Generates a random UUID.
 *
 * @function uuid
 * @returns {string}
 */
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

/**
 * Parses raw PouchDB document data by converting any ISO dates into Date objects. This method available on all Document and Lazybones instances.
 *
 * @function parse
 * @param {object} attrs - A raw PouchDB document.
 * @returns {object}
 */
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

/**
 * Creates a deferred promise that is not resolved until the next system tick.
 *
 * @function asyncDefer
 * @param {mixed} data - Data to pass along through the promise.
 * @returns {Promise}
 */
exports.asyncDefer = function(data) {
	return new Promise(function(resolve) {
		process.nextTick(resolve.bind(null, data));
	});
}

/**
 * A custom error class that all errors thrown by Lazybones are wrapped in.
 *
 * @class LazyError
 * @param {string} code - The specific error code. The default value is `UNKNOWN_ERROR`.
 * @param {string} [msg] - A custom error message. If this argument is not provided, the value is derived from the error code.
 * @property {string} code - The error code.
 * @property {string} message - The error message and code.
 */
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

/**
 * Transforms a PouchError into a LazyError and then throws it. If the passed error is not a PouchError, the original error is thrown without modification.
 *
 * @function transformPouchError
 * @param {Error} error - Any error object.
 * @throws {LazyError}
 */
exports.transformPouchError = function(e) {
	// make sure this is a real pouch error
	if (!(e || e.error)) throw e;

	var nerr = new LazyError("POUCH_ERROR", e.message);
	nerr.error = true; // keep it consistent
	nerr.status = e.status;
	nerr.pouch_name = e.name;
	throw nerr;
}