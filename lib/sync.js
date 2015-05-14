var _ = require("underscore"),
	Promise = require("pouchdb/extras/promise"),
	PouchError = require("pouchdb/lib/deps/errors");

function noop(){}

module.exports = Lazybones = {};

var methodMap = {
	create: "post",
	update: "put",
	patch: "put"
	delete: "remove"
}

Lazybones.defaults = {
	success: noop,
	error: noop,
	live: false,
	query: null,
	rowKey: "value",
	options: {},
	process: function(res, method, model, options) {
		if (method !== "read") return { _id: res.id, _rev: res.rev };
		var data = res;

		// convert view results into an array of model data
		if (res.rows != null && res.total_rows != null) {
			data = _.pluck(res.rows, options.rowKey);

			// grab just the first row for model
			if (model.id) data = data[0];
		}

		return data;
	}
};

Lazybones.sync = function(defaults) {
	defaults = _.extend({}, Lazybones.defaults, defaults);

	return function(method, model, options) {
		options = _.extend({}, defaults, getPouchOptions(model), options);

		var promise = new Promise(function(resolve, reject) {
			var dbMethod, db;

			// resolve method and database
			method = method.toLowerCase().trim();
			db = getDatabase(options) || getDatabase(model);
			if (db == null) throw PouchError.DB_MISSING;

			// deal with writes
			if (method !== "read") {
				return db[methodMap[method]](model.toJSON(), options.options[methodMap[method]]);
			}

			// deal with non-live reads
			if (!options.live) {
				// a single model
				if (model.id) return db.get(model.id, options.options.get);

				// process query requests
				if (options.query) return db.query(options.query, options.options.query);

				// regular collection fetch
				return db.allDocs(options.options.allDocs);
			}

			// var changes = db.changes(options.options.changes);

		});

		// process the result into something that backbone can use
		promise.then(function(res) {
			return options.process(res, method, model, options);
		})

		// ship result to success and error callbacks
		// no promise chaining so it's guaranteed to return
		.then(options.success, options.error);

		// trigger the request event
		model.trigger('request', model, db, options);

		// return the original promise for the original result
		return promise;
	}
}

function getPouchOptions(m) {
	return m && (m.pouchOptions || m.pouch_options || getPouchOptions(m.collection));
}

function getDatabase(m) {
	return m && (m.pouch || m.pouchdb || m.db || m.database || getDatabase(m.collection));
}
