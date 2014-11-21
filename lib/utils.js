var _ = require("underscore"),
	PouchDB = require("pouchdb"),
	Promise = require("bluebird");

// pouchdb utils
_.extend(exports, _.pick(PouchDB.utils, "uuid"));

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
