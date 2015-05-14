var merge = require("plain-merge"),
	Promise = require("pouchdb/extras/promise"),
	PouchError = require("pouchdb/lib/deps/errors");

function noop(){}

var Lazybones = module.exports = {};

var methodMap = {
	create: "post",
	update: "put",
	patch: "put",
	delete: "remove"
};

Lazybones.defaults = {
	success: noop,
	error: noop,
	changes: false,
	query: null,
	rowKey: "doc",
	options: {
		query: { include_docs: true },
		allDocs: { include_docs: true }
	},
	process: function(res, method, model, options) {
		// parse non-document responses
		if (res._id == null && res._rev == null) {
			// write result
			if (method !== "read") return { _id: res.id, _rev: res.rev };

			// view result
			if (res.rows != null) {
				if (isCollection(model)) return res.rows.map(function(row) {
					return row[options.rowKey];
				});

				// grab just the first row for models
				return res.rows.length && res.rows[0][options.rowKey];
			}
		}

		return res;
	}
};

Lazybones.sync = function(method, model, options) {
	var dbMethod, db, onChange, promise, chgopts;

	// resolve method and database
	options = merge.extend({}, Lazybones.defaults, getSyncOptions(model), options);
	iscol = isCollection(model);
	method = method.toLowerCase().trim();
	db = getDatabase(options) || getDatabase(model);
	if (db == null) throw PouchError.DB_MISSING;

	// deal with writes
	if (method !== "read") {
		promise = db[methodMap[method]](model.toJSON(), options.options[methodMap[method]]);
	}

	// deal with normal reads
	else if (!options.changes) {
		// a single model
		if (!iscol) promise = db.get(model.id, options.options.get);

		// process query requests
		else if (options.query) promise = db.query(options.query, options.options.query);

		// regular collection fetch
		else promise = db.allDocs(options.options.allDocs);
	}

	// deal with changes feed reads
	else {
		promise = db.changes(merge.defaults({
			include_docs: true
		}, options.changes, options.options.changes, {
			returnDocs: false
		}));

		onChange = function(row) {
			model.set(row.doc, merge.extend({ remove: false }, options));
		}

		promise.on("create", onChange);
		promise.on("update", onChange);

		promise.on("delete", function(row) {
			var m = !iscol ? model : model.remove(row.id, options);
			if (m) m.set(row.doc, options);
		});

		// return the changes object immediately
		return promise;
	}

	// process the result into something that backbone can use
	// and ship result to success and error callbacks
	promise.then(function(res) {
		return options.process(res, method, model, options);
	}).then(options.success, options.error);

	// trigger the request event
	model.trigger('request', model, db, options);

	// return the original promise for the original result
	return promise;
}

function getSyncOptions(m) {
	return m && (m.syncOptions || m.sync_options || getSyncOptions(m.collection));
}

function getDatabase(m) {
	return m && (m.pouch || m.pouchdb || m.db || m.database || getDatabase(m.collection));
}

function isCollection(v) {
	return v != null &&
		Array.isArray(v.models) &&
		typeof v.model === "function" &&
		typeof v.add === "function" &&
		typeof v.remove === "function";
}
