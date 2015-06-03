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
		query: { include_docs: true, returnDocs: false },
		allDocs: { include_docs: true },
		changes: { returnDocs: false }
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
	if (db == null) throw new Error("Missing PouchDB database.");

	// deal with writes
	if (method !== "read") {
		promise = db[methodMap[method]](model.toJSON(), options.options[methodMap[method]]);
	}

	// deal with normal reads
	else if (!options.changes) {
		promise = options.fetch.call(self, model, db, options);
		if (promise == null || typeof promise.then !== "function") {
			promise = Promise.resolve(promise);
		}
	}

	// deal with changes feed reads
	else {
		promise = db.changes(merge.defaults({
			include_docs: true
		}, options.changes, options.options.changes));

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
	processPromise = new Promise(function(resolve, reject) {
		var success = options.success,
			error = options.error;

		options.success = function() {
			success.apply(this, arguments);
			resolve();
		};

		options.error = function(err) {
			error.apply(this, arguments);
			reject(err);
		};
	});

	// process the result into something that backbone can use
	// and ship result to success and error callbacks
	promise.then(function(res) {
		return options.process.call(self, res, method, model, options);
	}).then(options.success, options.error);

	// trigger the request event
	model.trigger('request', model, db, options);

	// return the original promise with the original result
	return Promise.all([ promise, processPromise ])
	.then(function(res) { return res[0]; });
}

var isCollection =
Lazybones.isCollection = function(v) {
	return v != null &&
		Array.isArray(v.models) &&
		typeof v.model === "function" &&
		typeof v.add === "function" &&
		typeof v.remove === "function";
}

Lazybones.isModel = function(val) {
	return val != null &&
		typeof val.cid === "string" &&
		typeof val.attributes === "object" &&
		typeof val.get === "function" &&
		typeof val.set === "function";
}

function getSyncOptions(m) {
	return m && (lookup(m, ["syncOptions","sync_options"]) || getSyncOptions(m.collection));
}

function getDatabase(m) {
	return m && (lookup(m, ["pouch","pouchdb","db","database"]) || getDatabase(m.collection));
}

function lookup(o, keys) {
	var v, i;
	for (i in keys) {
		v = o[keys[i]];
		if (typeof v === "function") {
			return v.call(o, Array.prototype.slice.call(arguments, 2));
		}
		if (typeof v !== "undefined") return v;
	}
}
