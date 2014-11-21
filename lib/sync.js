var _ = require("underscore"),
	debug = require("debug")("lazybones:sync"),
	util = require("./utils"),
	Document = require("./document"),
	Database = require("./database"),
	Promise = util.Promise;

function noop(){}

var doc_queue = [];

function flushQueue() {
	console.log(doc_queue);
	doc_queue = [];
}

Object.defineProperty(doc_queue, "invalidate", {
	value: _.debounce(flushQueue, 1000),
	configurable: true,
	enumerable: false
});

module.exports = function(method, model, options) {
	if (options == null) options = {};
	if (!_.isFunction(options.success)) options.success = noop;
	if (!_.isFunction(options.error)) options.error = noop;

	var promise = new Promise(function(resolve, reject) {
		if (!(model instanceof Document)) {
			return reject(new Error("This sync only works on Documents."));
		}

		var isdb = model instanceof Database,
			db = isdb ? model : model.database,
			id = model[isdb ? "metaid" : "id"],
			data;

		if (db == null) {
			return reject(new Error("Document is missing database reference."));
		}

		debug("%s %s (%s)", method, id, db.id);

		switch (method) {
			case "read":
				resolve(db.pouch.get(id));
				break;

			case "create":
			case "update":
				data = model.toJSON();

				resolve(db.put(data).then(function(data) {
					return _.extend(data, {
						_id: res.id,
						_rev: res.rev
					});
				}));

				break;

			case "delete":
				resolve(db.remove(model.toJSON()));
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