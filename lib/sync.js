var debug = require("debug")("lazybones:sync"),
	util = require("./util");

function noop(){}

module.exports = function(method, model, options) {
	if (options == null) options = {};
	if (!_.isFunction(options.success)) options.success = noop;
	if (!_.isFunction(options.error)) options.error = noop;

	debug("%s %s (%s)", method, model.id, model.cid);

	// var promise = new Promise(function(resolve, reject) {
	// 	var project, db;

	// 	if (!(model instanceof DocumentCollection || model instanceof Document))
	// 		return reject(new Error("This sync only works on Documents."));

	// 	if ((project = model.project) == null)
	// 		return reject(new Error("Model is missing project reference."));

	// 	options.project = project;

	// 	if ((db = project.db) == null)
	// 		return reject(new Error("Missing PouchDB."));

	// 	switch (method) {
	// 		case "read":
	// 			if (model instanceof DocumentCollection) {
	// 				var doctype = model.doctype;
	// 				if (_.isEmpty(doctype)) return reject(new Error("Missing Doctype."));

	// 				db.allDocs({ include_docs: true })
	// 					.then(function(res) {
	// 						return _.chain(res.rows)
	// 						.filter(function(row) { return row.doc.doctype === doctype; })
	// 						.pluck("doc")
	// 						.value();
	// 					})
	// 					.then(resolve, reject);
	// 			} else {
	// 				db.get(model.id).then(resolve, reject);
	// 			}
	// 			break;

	// 		case "create":
	// 			var data = model.toJSON();

	// 			db.post(data)
	// 				.then(function(data) {
	// 					return _.extend(data, { _id: res.id, _rev: res.rev });
	// 				})
	// 				.then(resolve, reject);

	// 			break;
				
	// 		case "update":
	// 			var data = model.toJSON();

	// 			db.put(data)
	// 				.then(function(res) {
	// 					return _.extend(data, { _rev: res.rev });
	// 				})
	// 				.then(resolve, reject);

	// 			break;

	// 		case "delete":
	// 			db.remove(model.toJSON()).then(resolve, reject);
	// 			break;
	// 	}
	// });

	// promise = promise.catch(util.throwPouchError);
	// promise.catch(options.error);
	// promise = promise.then(options.success);
	// model.trigger('request', model, null, options);
	// return promise.bind(this).then(function() { return model; });
}