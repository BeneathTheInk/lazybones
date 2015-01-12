/**
 * # Sync
 *
 * Backbone puts all database requests under a single function, `Backbone.sync`. Lazybones overwrites this method to add support for PouchDB.
 *
 * This method returns a promise that is fulfilled with the exact PouchDB result. This is very different from `Backbone.sync`, which returns the XHR object used to make the request. Since there is no XHR involved in a PouchDB request, we return the promise from PouchDB instead. This means that `doc.fetch()`, `doc.save()` and `doc.destroy()` all return promises as well.
 *
 * This function is accessible directly via `Lazybones.sync`.
 *
 * #### Arguments
 *
 * - **method** _string_ - The CRUD action to perform on the document or database. Must be `create`, `read`, `update` or `delete`.
 * - **model** _Document | Lazybones_ - The document or database to perform the database action on.
 * - **options** _object; optional_ - An object of options to use while syncing. These options are available on any `.fetch()`, `.save()`, or `.destroy()` calls. The options are also passed directly to the PouchDB instance, so depending on the method, additional options are available.
 *   - **options.database** _Lazybones_ - An instance of Lazybones to use for the request. If this is not provided, `doc.collection` is used instead. Sync will produce an error if no database is provided.
 *   - **options.success** _function_ - A function that called when the sync completes successfully.
 *   - **options.error** _function_ - A function that called when the sync cannot complete.
 */

var _ = require("underscore"),
	debug = require("debug")("lazybones:sync"),
	utils = require("./utils"),
	Document = require("./document"),
	Database = require("./"),
	Promise = require("bluebird");

function noop(){}

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
					pouch_opts = _.extend({
						conflicts: true,
						attachments: false
					}, options);

					return Promise.cast(db.pouch.get(id, pouch_opts)).tap(options.success);
				}

				// or all if it's a database
				else {
					pouch_opts = _.extend({
						conflicts: true,
						attachments: false
					}, options, {
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