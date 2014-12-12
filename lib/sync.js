var _ = require("underscore"),
	debug = require("debug")("lazybones:sync"),
	utils = require("./utils"),
	Document = require("./document"),
	Database = require("./database"),
	Promise = require("bluebird");

function noop(){}

/**
 * Makes requests to PouchDB instance to create, update and delete documents. This method is also available on instances of Document and Lazybones.
 *
 * @function sync
 * @memberof Lazybones
 * @static
 * @param {string} method - The CRUD action to perform on the document or database. Must be one of `create`, `read`, `update` or `delete`.
 * @param {(Document|Lazybones)} model - The document or database to perform the database action on.
 * @param {object} [options] - An object of options to use while syncing. These options are available on any `.fetch()`, `.save()`, or `.destroy()` calls. The options are also passed directly to the PouchDB instance, so depending on the method, additional options are available.
 * @param {object} [options.database] - An instance of Lazybones to use for the request. If this is not provided, `.collection` is used instead. Sync will produce an error if no database can be found.
 * @param {object} [options.success] - A function that called when the sync completes successfully.
 * @param {object} [options.error] - A function that called when the sync cannot complete.
 * @returns {Promise} - The promise is resolved when the request is complete.
 */
module.exports = function sync(method, model, options) {
	if (options == null) options = {};
	if (!_.isFunction(options.success)) options.success = noop;
	if (!_.isFunction(options.error)) options.error = noop;

	var promise = Promise.bind(this).then(function() {
		var isdoc, isdb, db, data, id, pouch_opts;

		isdoc = model instanceof Document;
		isdb = model instanceof Database;

		if (!(isdoc || isdb)) {
			throw new utils.LazyError("UNKNOWN_ERROR", "Sync is expecting a valid document or database.");
		}

		db = options.database != null ? options.database :
			isdb ? model : model.collection;

		if (!(db instanceof Database)) {
			throw new utils.LazyError("MISSING_DATABASE");
		}

		data = model.toJSON();
		id = data._id;

		if (isdoc) debug("%s %s (%s)", method, id, db.name);
		else debug("%s %s", method, db.name);

		switch (method) {
			case "read":
				// fetch single if document
				if (isdoc) {
					pouch_opts = _.defaults(_.pick(options, utils.pouchOptionKeys.get), {
						conflicts: true,
						attachments: false
					});

					return Promise.cast(db.pouch.get(id, pouch_opts)).tap(options.success);
				}

				// or all if it's a database
				else {
					pouch_opts = _.extend({
						conflicts: true,
						attachments: false
					}, _.pick(options, utils.pouchOptionKeys.allDocs), {
						include_docs: true // always must include the full document
					});

					return Promise.cast(db.pouch.allDocs(pouch_opts)).tap(function(res) {
						options.success(_.pluck(res.rows, "doc"));
					});
				}

			case "create":
			case "update":
			case "delete":
				// create, update and delete only work on documents
				if (!isdoc) {
					throw new utils.LazyError("INVALID_DOCUMENT", "Sync can only " + method + " documents.");
				}

				return db._pushWrite(data, method === "delete").tap(function(res) {
					// update revision
					options.success({ _rev: res.rev });
				});

		}
	});

	// transform any pouch errors
	promise = promise.catch(utils.transformPouchError)

	// catch errors with error function
	// no promise chaining so it's guaranteed to return
	promise.catch(options.error);

	// trigger the request event
	model.trigger('request', model, promise, options);

	// return the promise and model
	return promise;
}