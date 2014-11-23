var _ = require("underscore"),
	debug = require("debug")("lazybones:sync"),
	util = require("./utils"),
	Document = require("./document"),
	Database = require("./database"),
	Promise = require("bluebird");

function noop(){}

module.exports = function(method, model, options) {
	if (options == null) options = {};
	if (!_.isFunction(options.success)) options.success = noop;
	if (!_.isFunction(options.error)) options.error = noop;

	var promise = Promise.try(function() {
		if (!(model instanceof Document)) {
			throw new util.LazyError("INVALID_DOCUMENT", "Sync is expecting a valid document or database.");
		}

		var isdb = model instanceof Database,
			db = isdb ? model : model.database,
			id = model[isdb ? "metaid" : "id"],
			data;

		if (db == null) {
			throw new util.LazyError("MISSING_DATABASE");
		}

		debug("%s %s (%s)", method, id, db.id);

		switch (method) {
			case "read":
				return db.pouch.get(id);

			case "create":
			case "update":
				data = model.toJSON();

				// transform document on result
				return db._pushWrite(data).then(function(result) {
					var rev = { _rev: result.rev };
					return isdb ? rev : _.extend({}, data, rev);
				});

			case "delete":				
				// if database, cancel all writes and destroy pouchdb
				if (isdb) return db._cancelAllWrites().then(function() {
					return db.pouch.destroy();
				});

				// otherwise just push normal delete
				return db._pushWrite(model.toJSON(), true);
		}
	});

	// pass results to options functions
	// no promise chaining so it's guaranteed to return on both
	promise.then(options.success, options.error);

	// trigger the request event
	model.trigger('request', model, promise, options);

	// return the promise, bound to the model
	return promise.bind(model);
}