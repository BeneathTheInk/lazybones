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

	var promise = Promise.bind(this).then(function() {
		var isdoc, isdb, db, data;

		isdoc = model instanceof Document;
		isdb = model instanceof Database;

		if (!(isdoc || isdb)) {
			throw new util.LazyError("UNKNOWN_ERROR", "Sync is expecting a valid document or database.");
		}

		db = options.database != null ? options.database :
			isdb ? model : model.collection;

		if (!(db instanceof Database)) {
			throw new util.LazyError("MISSING_DATABASE");
		}

		if (isdoc) debug("%s %s (%s)", method, model.id, db.name);
		else debug("%s %s", method, db.name);

		switch (method) {
			case "read":
				data = model.toJSON();

				// fetch single if document
				if (isdoc) {
					return Promise.cast(db.pouch.get(model.id, {
						conflicts: true
					})).tap(options.success);
				}

				// or all if it's a database
				else {
					return Promise.cast(db.pouch.allDocs({
						include_docs: true,
						conflicts: true,
						attachments: false
					})).tap(function(res) {
						options.success(_.pluck(res.rows, "doc"));
					});
				}

			case "create":
			case "update":
			case "delete":
				// create, update and delete only work on documents
				if (!isdoc) {
					throw new util.LazyError("INVALID_DOCUMENT", "Sync can only " + method + " documents.");
				}

				return db._pushWrite(model.toJSON(), method === "delete").tap(function(res) {
					// update revision
					options.success({ _rev: res.rev });
				});

		}
	});

	// catch errors with error function
	// no promise chaining so it's guaranteed to return
	promise.catch(options.error);

	// trigger the request event
	model.trigger('request', model, promise, options);

	// return the promise and model
	return promise;
}