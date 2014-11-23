var _ = require("underscore"),
	PouchDB = require("pouchdb"),
	Promise = require("bluebird");

// pouchdb utils
_.extend(exports, _.pick(PouchDB.utils, "uuid"));

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

// exports.asyncWhile = function (condition, action, ctx) {
// 	function whilst(data) {
// 		if (!condition.call(ctx, data)) return Promise.resolve(data);
// 		return Promise.resolve(action.call(ctx, data)).then(whilst);
// 	}
 
// 	return whilst();
// }

exports.asyncDefer = function (data) {
	return new Promise(function(resolve) {
		process.nextTick(resolve.bind(null, data));
	});
}

function LazyError(code, msg) {
	Error.call(this);

	var code = _.isString(code) ? code.toUpperCase() : null;
	if (!code || LazyError.errors[code] == null) code = "UNKNOWN_ERROR";

	this.code = code;
	this.message = msg || LazyError.errors[code];
}

exports.LazyError = LazyError;
LazyError.prototype = Object.create(Error.prototype);

LazyError.prototype.name = "LazyError";

LazyError.prototype.toString = function() {
	return this.name + ": " + this.message + " (" + this.code + ")";
}

LazyError.errors = {
	POUCH_ERROR: "PouchDB had an error.",
	INVALID_DOCUMENT: "Expecting a valid document.",
	MISSING_ID: "Document is missing '_id' attribute.",
	MISSING_REVISION: "Document is missing '_rev' attribute.",
	MISSING_DATABASE: "Document is missing database reference.",
	ILLEGAL_UPDATE: "Refusing to update this document.",
	WRITE_CANCELLED: "Database write was cancelled.",
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