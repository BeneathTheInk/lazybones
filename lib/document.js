var _ = require("underscore"),
	Backbone = require("backbone"),
	PouchDB = require("pouchdb"),
	sync = require("./sync"),
	util = require("./util");

var Document =
module.exports = Backbone.Model.extend({
	
	idAttribute: "_id",
	parse: util.parse,
	sync: sync,

	constructor: function(attrs, options) {
		if (options == null) options = {};
		if (attrs == null) attrs = {};

		// transfer database object
		if (options.db != null) this.db = options.db;

		// make sure there is an id
		if (attrs._id == null) attrs._id = PouchDB.utils.uuid();

		Backbone.Model.call(this, attrs, options);
	}

});

// configure symlinks
require("backbone-symlink").configure(Document);