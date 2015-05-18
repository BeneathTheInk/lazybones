var merge = require("plain-merge"),
	Promise = require("pouchdb/extras/promise"),
	PouchError = require("pouchdb/lib/deps/errors");

function noop(){}

var Lazybones = module.exports = function(gdef) {
	return { lazybones: function(defaults) {
		var db = this;
		return function(method, model, options) {
			options = merge.defaults({}, options, defaults, gdef, { database: db });
			return Lazybones.sync.call(this, method, model, options);
		}
	} };
}

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
		get: {},
		query: { include_docs: true },
		allDocs: { include_docs: true }
	},
	fetch: function(model, db, options) {
		// a single model
		if (!isCollection(model)) return db.get(model.id, options.options.get);

		// process query requests
		if (options.query) return db.query(options.query, options.options.query);

		// regular collection fetch
		return db.allDocs(options.options.allDocs);
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
				return res.rows.length ? res.rows[0][options.rowKey] : null;
			}
		}

		return res;
	}
};

Lazybones.sync = function(method, model, options) {
	var self, dbMethod, db, onChange, promise, chgopts, processed, processPromise;

	// resolve method and database
	self = this;
	options = merge.defaults({}, options, getSyncOptions(model), Lazybones.defaults);
	method = method.toLowerCase().trim();
	db = getDatabase(options) || getDatabase(model);
	if (db == null) throw PouchError.DB_MISSING;

	// deal with writes
	if (method !== "read") {
		promise = db[methodMap[method]](model.toJSON(), options.options[methodMap[method]]);
	}

	// deal with normal reads
	else if (!options.changes) {
		promise = options.fetch.call(self, model, db, options);
		if (promise == null || typeof promise.then !== "function") return;
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
			var m = !isCollection(model) ? model : model.remove(row.id, options);
			if (m) m.set(row.doc, options);
		});

		// return the changes object immediately
		return promise;
	}

	// create a promise so sync promise waits for backbone to write to model
	processPromise = new Promise(function(resolve) {
		processed = resolve;
	});

	// process the result into something that backbone can use
	// and ship result to success and error callbacks
	promise.then(function(res) {
		return options.process.call(self, res, method, model, options);
	}).then(options.success, options.error).then(processed);

	// trigger the request event
	model.trigger('request', model, db, options);

	// return the original promise for the original result
	return promise.then(function(res) {
		return processPromise.then(function() {
			return res;
		});
	});
}

var isCollection =
Lazybones.isCollection = function(v) {
	return v != null &&
		Array.isArray(v.models) &&
		typeof v.model === "function" &&
		typeof v.add === "function" &&
		typeof v.remove === "function";
}

function getSyncOptions(m) {
	return m && (m.syncOptions || m.sync_options || getSyncOptions(m.collection));
}

function getDatabase(m) {
	return m && (m.pouch || m.pouchdb || m.db || m.database || getDatabase(m.collection));
}
