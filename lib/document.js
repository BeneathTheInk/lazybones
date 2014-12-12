var _ = require("underscore"),
	Backbone = require("backbone"),
	utils = require("./utils");

/**
 * The class representing a single document in PouchDB. This extends `Backbone.Model` and only modifies a few methods to ensure it works with Lazybones.
 *
 * @class
 * @extends Backbone.Model
 * @param {object} attr - An object of initial properties for the document.
 * @param {object} [options] - An object of options to initiate the document with. This variable is passed directly to the `Backbone.Model` constructor.
 */
function Document(attrs, options) {
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

/**
 * Creates a subclass of Document.
 *
 * @function extend
 * @memberof Document
 * @static
 * @param {object} instance_props - An object of instance methods and properties that are copied onto the new class's prototype object.
 * @param {object} [class_props] - An object of static methods and properties attached directly to the class variable
 * @returns A constructor for a new class that extends Document.
 */
Document.extend = Backbone.Model.extend;

// document class constructor
_.extend(Document.prototype, {
	
	idAttribute: "_id",
	parse: utils.parse,
	sync: require("./sync"),

	/**
	 * Produces a plain JavaScript object that can be saved directly to PouchDB. Date values are converted to ISO strings. Any keys found in the `omitKeys` array are removed from the output.
	 *
	 * @function toJSON
	 * @memberof Document
	 * @instance
	 * @returns {object} A object of document properties.
	 */
	toJSON: function() {
		var data = Backbone.Model.prototype.toJSON.apply(this, arguments);

		// omit specified keys
		var omitKeys = _.result(this, "omitKeys");
		if (_.isArray(omitKeys)) data = _.omit(data, omitKeys);

		// convert dates
		Object.keys(data).forEach(function(key) {
			if (_.isDate(data[key])) {
				data[key] = data[key].toISOString();
			}
		});

		return data;
	},

	/**
	 * Determines if the document has ever been saved to the database by checking if `_rev` property exists.
	 *
	 * @function isNew
	 * @memberof Document
	 * @instance
	 * @returns {boolean} `true` if the document has never been saved.
	 */
	isNew: function() { return !this.has("_rev"); },

	// passes collection through options since backbone removes
	// the model from the collection before calling sync
	destroy: function(options) {
		options = options || {};
		options.database = this.collection;
		return Backbone.Model.prototype.destroy.call(this, options);
	}

});