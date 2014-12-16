/**
 * # Utils
 *
 * These are utility methods used by Lazybones and are accessible via `Lazybones.utils`.
 */

var _ = require("underscore"),
	PouchDB = require("pouchdb"),
	Promise = require("bluebird");

/**
 * ### uuid()
 *
 * Generates a random UUID. This method is taken directly from PouchDB.
 */
exports.uuid = PouchDB.utils.uuid;

/**
 * ### Promise
 *
 * A direct reference to the Bluebird Promise object.
 */
exports.Promise = Promise;

/**
 * ### pouchOptionKeys
 *
 * Lists of option keys by method names that can be used in PouchDB requests. This allows option objects to be sanitized before being passed to PouchDB.
 */
exports.pouchOptionKeys = {
	get: [ "rev", "revs", "revs_info", "open_revs", "conflicts", "attachments", "local_seq", "ajax" ],
	allDocs: [ "include_docs", "conflicts", "attachments", "startkey", "endkey", "inclusive_end", "limit", "skip", "descending", "key", "keys" ],
	changes: [ "include_docs", "conflicts", "attachments", "filter", "doc_ids", "since", "live", "limit", "style", "view", "returnDocs", "batch_size" ]
};

/**
 * ### parse()
 *
 * Parses raw PouchDB document data by converting any ISO dates into Date objects. This method available on all Document and Lazybones instances.
 *
 * #### Arguments
 *
 * - **attrs** _object_ - A raw document object. This usually comes straight from a PouchDB `get()` request.
 */
// iso date regular expression
var iso_date_regex = /\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z)/;

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
 * ### asyncDefer()
 *
 * Creates a deferred promise that is not resolved until the next system tick.
 *
 * #### Arguments
 *
 * - **data** _mixed_ - Data to pass along through the promise.
 */
exports.asyncDefer = function(data) {
	return new Promise(function(resolve) {
		process.nextTick(resolve.bind(null, data));
	});
}

/**
 * ### LazyError()
 *
 * A custom error class that all errors thrown by Lazybones are wrapped in.
 *
 * #### Arguments
 *
 * - **code** _string_ - The specific error code. The default value is `UNKNOWN_ERROR`.
 * - **msg** _string_ - A custom error message. If this argument is not provided, the value is derived from the error code.
 *
 * #### Instance Properties
 *
 * - **code** _string_ - The error code.
 * - **message** _string_ - The error message and code.
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

/**
 * #### Error Codes
 *
 * These are the error codes used by LazyError and their default messages. Custom error codes can be created by adding to this list.
 */
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
 * ### transformPouchError()
 * 
 * Transforms a PouchError into a LazyError and then throws it. If the passed error is not a PouchError, the original error is thrown without modification.
 *
 * #### Arguments
 *
 * - **error** _Error_ - Any error object.
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