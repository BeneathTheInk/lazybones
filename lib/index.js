var _ = require("underscore");

// load the database
var Database = module.exports = require("./database");

// current version
Database.VERSION = "0.1.4";

// load other parts
Database.sync = require("./sync");
Database.utils = require("./utils");
Database.Document = require("./document");