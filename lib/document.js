var _ = require("underscore"),
	Backbone = require("backbone"),
	utils = require("./utils");

function Document (attrs, options) {
	if (options == null) options = {};
	if (attrs == null) attrs = {};

	// transfer database object
	if (options.database != null) this.database = options.database;

	// make sure there is always an id
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

	// returns document without omitKeys and string dates
	toJSON: function() {
		var data = Backbone.Model.prototype.toJSON.apply(this, arguments);

		// omit specified keys
		var omitKeys = _.result(this, "omitKeys");
		if (_.isArray(omitKeys)) data = _.omit(data, omitKeys);

		// convert dates
		_.each(data, function(val, key) {
			if (_.isDate(val)) data[key] = val.toISOString();
		});

		return data;
	},

	// documents are new if they don't have a revision id
	isNew: function() { return !this.has("_rev"); }

});

// configure symlinks
require("backbone-symlink").configure(Document);