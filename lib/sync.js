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

	var promise = new Promise(function(resolve, reject) {
		if (!(model instanceof Document)) {
			return reject(new util.LazyError("INVALID_DOCUMENT", "Sync is expecting a valid document or database."));
		}

		var isdb = model instanceof Database,
			db = isdb ? model : model.database,
			id = model[isdb ? "metaid" : "id"],
			data;

		if (db == null) {
			return reject(new util.LazyError("MISSING_DATABASE"));
		}

		debug("%s %s (%s)", method, id, db.id);

		switch (method) {
			case "read":
				resolve(db.pouch.get(id));
				break;

			case "create":
			case "update":
				db._pushWrite(model.toJSON());
				break;

			case "delete":
				// TODO: deal with database destroys
				if (isdb) throw new Error("Cannot delete databases through sync.");

				db._pushWrite(_.extend(model.pick("_id", "_rev"), {
					_deleted: true
				}));
				
				break;
		}
	});

	model.trigger('request', model, promise, options);

	promise.catch(options.error);

	return promise.then(function(result) {
		options.success(result);
		return model;
	});
}