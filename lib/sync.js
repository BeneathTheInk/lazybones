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
 * - **model** _Model | Collction_ - The Backbone model or collection instance to perform the database action on.
 * - **options** _object; optional_ - An object of options to use while syncing. These options are available on any `.fetch()`, `.save()`, or `.destroy()` calls. The options are also passed directly to the PouchDB instance, so depending on the method, additional options are available.
 *   - **options.pouch** _PouchDB_ - An instance of PouchDB to use for the request. If this is not provided, the database is inferred from the model provided. Sync will produce an error if no database can be located.
 *   - **options.success** _function_ - A function that called when the sync completes successfully.
 *   - **options.error** _function_ - A function that called when the sync cannot complete.
 */

var _ = require("underscore"),
	debug = require("debug")("lazybones:sync"),
	PouchDB = require("pouchdb"),
	Promise = require("bluebird"),
	utils = require("./utils");

function noop(){}

var FETCH_DOC_OPTS = [ "ajax", "conflicts", "attachments", "rev", "revs" ],
	FETCH_BULK_OPTS = [ "startkey", "endkey", "inclusive_end", "limit", "skip", "descending", "key", "keys", "stale", "conflicts", "attachments" ];

module.exports = function sync(method, model, options) {
	if (options == null) options = {};
	if (!_.isFunction(options.success)) options.success = noop;
	if (!_.isFunction(options.error)) options.error = noop;

	var promise = Promise.bind(this).then(function() {
		var ismodel, iscol, db, data, id, pouch_opts;

		method = method.toLowerCase();
		ismodel = utils.isBackboneModel(model);
		iscol = utils.isBackboneCollection(model);

		if (!(ismodel || iscol)) {
			throw new utils.LazyError("UNKNOWN_ERROR", "Sync is expecting a Backbone model or collection.");
		}

		db = options.database != null ? options.database :
			model.pouch != null ? model.pouch : 
			model.collection ? model.collection.pouch : null;

		if (!(db instanceof PouchDB)) {
			throw new utils.LazyError("MISSING_DB");
		}

		if (ismodel) {
			data = model.toJSON();
			id = data._id;
			debug("%s %s (%s)", method, id, db._db_name);
		} else {
			debug("%s %s", method, db._db_name);
		}

		switch (method) {
			case "read":
				// fetch single if document
				if (ismodel) {
					return Promise.cast(db.get(id, _.pick(options, FETCH_DOC_OPTS))).tap(options.success);
				}

				pouch_opts = _.extend(_.pick(options, FETCH_BULK_OPTS), {
					include_docs: true // always must include the full document
				});

				return Promise.cast(
					options.query != null ?
					db.query(options.query, pouch_opts) :
					db.allDocs(pouch_opts)
				).tap(function(res) {
					options.success(_.pluck(res.rows, "doc"));
				});

			case "create":
			case "update":
			case "delete":
				// create, update and delete only work on documents
				if (!ismodel) {
					throw new utils.LazyError("INVALID_DOC", method);
				}

				return Promise.cast(db[method === "delete" ? "remove" : "put"](data)).tap(function(res) {
					// update revision
					options.success({ _rev: res.rev });
				});

			default:
				throw new utils.LazyError("INVALID_METHOD", method);

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