/**
 * # Utils
 *
 * These are utility methods used by Lazybones and are accessible via `Lazybones.utils`.
 */

var _ = require("underscore"),
	PouchDB = require("pouchdb"),
	Promise = require("bluebird"),
	Symlink = require("backbone-symlink"),
	sprintf = require("sprintf-js").vsprintf,
	extend = require("backbone").Model.extend;

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

/* Expose Backbone Symlink and attach two specific utility methods: `isBackboneModel()` and `isBackboneCollection()`. These methods are used instead of `instanceof` because they test the features of an object, not the inheritance. */
exports.Symlink = Symlink;
exports.isBackboneModel = Symlink.isBackboneModel;
exports.isBackboneCollection = Symlink.isBackboneCollection;

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
var LazyError =
exports.LazyError = extend.call(Error, {
	constructor: function(msg) {
		Error.call(this);
		
		var msgvars = Array.prototype.slice.call(arguments, 1);
		var errors = this.constructor.errors;
		var code = typeof msg === "string" ? msg.toUpperCase() : null;
		
		if (code && errors[code]) msg = null;
		else code = "UNKNOWN_ERROR";

		this.code = code;

		Object.defineProperty(this, "_message", {
			value: sprintf(msg || errors[code], msgvars),
			writeable: false,
			enumerable: false,
			configurable: false
		});
	},

	name: "LazyError",

	toString: function() {
		return this.name + ": " + this.message;
	}
}, {
	extend: extend,

	errors: {
		POUCH_ERROR: "%s",
		INVALID_POUCH: "Expecting an instance of PouchDB.",
		INVALID_DOC: "Sync can only %s documents.",
		INVALID_METHOD: "Sync does not support method '%s'",
		MISSING_DB: "Could not locate a PouchDB instance to sync with.",
		DESTROY_DB: "Database is already in the process of being destroyed.",
		UNKNOWN_ERROR: "An unknown error occurred."
	}
});

Object.defineProperty(LazyError.prototype, "message", {
	get: function() {
		return this._message + " (" + this.code + ")";
	},
	enumerable: true,
	configurable: false
});

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
	if (!e) throw new LazyError;
	if (!e.error || e instanceof LazyError) throw e;

	var nerr = new LazyError("POUCH_ERROR", e.message);
	nerr.error = true; // keep it consistent
	nerr.status = e.status;
	nerr.pouch_name = e.name;
	throw nerr;
}