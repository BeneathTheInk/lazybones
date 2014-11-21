var _ = require("underscore"),
	Backbone = require("backbone"),
	utils = require("./utils");

function Document (attrs, options) {
	if (options == null) options = {};
	if (attrs == null) attrs = {};

	// transfer database object
	if (options.db != null) this.db = options.db;

	// make sure there is an id
	if (attrs._id == null) attrs._id = utils.uuid();

	Backbone.Model.call(this, attrs, options);
}

// export first so any recursive dependents get correct value
module.exports = Document;

// document extends Backbone model
Document.prototype = Object.create(Backbone.Model.prototype);

// document class constructor
_.extend(Document.prototype, {
	
	idAttribute: "_id",
	parse: utils.parse,
	sync: require("./sync"),

	toJSON: function() {
		var data = Document.prototype.toJSON.apply(this, arguments);

		// omit specified keys
		var omitKeys = _.result(this, "omitKeys");
		if (_.isArray(omitKeys)) data = _.omit(data, omitKeys);

		// convert dates
		_.each(data, function(val, key) {
			if (_.isDate(val)) data[key] = val.toISOString();
		});

		return data;
	}

});

// configure symlinks
require("backbone-symlink").configure(Document);